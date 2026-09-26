import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from './core.mjs';
import { sourceID } from './links.mjs';
import { recentTools } from './memory.mjs';
import cleanAgentAnswer from '../assets/js/agent-text.js';

const profile = '# About Me\nLinxin Song studies agents.\n# Research Interests\nLanguage model training and evaluation.\n# Agentic AI\n' + Array.from({ length: 13 }, (_, i) => `- [Paper ${i}](https://arxiv.org/abs/2601.${String(i + 1).padStart(5, '0')})`).join('\n');
const env = { PROFILE: profile, OPENROUTER_API_KEY: 'test-placeholder', OPENROUTER_BASE_URL: 'https://model.invalid/v1' };
const origin = 'https://profile.example.org';
const observed = { ok: true, text: 'Untrusted browser observation' };
const response = calls => Response.json({ choices: [{ message: { tool_calls: calls.map(([name, args], index) => ({ id: 'call-' + index, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] });
const one = (name, args) => response([[name, args]]);
const urlID = url => sourceID(url).replace('link:', 'url:');
const html = name => `<h1>${name}</h1><p>Linxin Song researches reliable agents and language model evaluation. This official page describes public academic research and experiments.</p>`;
async function continueTurn(result, e, model) { return runAgent({ state: result.state, result: observed }, e, origin, model); }
async function initial(e, model, question = 'Explain Linxin’s research.') { return runAgent({ question, requestId: crypto.randomUUID() }, e, origin, model); }

test('independent URL reads overlap, return matching call IDs together, and isolate a failed source', async () => {
  const urls = ['https://one.example.org/profile', 'https://two.example.org/profile', 'https://blocked.example.org/profile'];
  let stage = 0, active = 0, peak = 0, charges = 0;
  const e = { ...env, BILLING: async type => { if (type === 'reserve') charges++; }, SOURCE_FETCH: async url => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, url.includes('one.') ? 25 : 5));
    active--;
    return url.includes('blocked.') ? new Response('Unavailable', { status: 403 }) : new Response(html(url), { headers: { 'Content-Type': 'text/html' } });
  } };
  const model = async (_, options) => {
    const body = JSON.parse(options.body);
    if (stage++ === 0) return one('check_scope', { allowed: true });
    if (stage === 2) return one('observe_page', {});
    if (stage === 3) {
      assert.equal(body.parallel_tool_calls, true);
      return response([['read_context', { section: 'about-me' }], ...urls.map(url => ['read_url', { url, query: 'research' }])]);
    }
    const assistant = body.messages.filter(m => m.tool_calls).at(-1);
    const results = body.messages.slice(body.messages.indexOf(assistant) + 1);
    assert.deepEqual(results.map(r => r.tool_call_id), assistant.tool_calls.map(c => c.id));
    assert.equal(results.length, 4);
    assert.equal(JSON.parse(results[3].content).ok, false);
    assert.ok(results[1].content.includes('one.example.org'));
    assert.ok(results[2].content.includes('two.example.org'));
    return one('answer_profile', { answer: 'The profile and two public sources describe his agent research.', sources: ['about-me'], link_sources: urls.slice(0, 2).map(urlID) });
  };
  let r = await initial(e, model, 'Read Linxin’s research on ' + urls.join(' and '));
  r = await continueTurn(r, e, model);
  assert.equal(r.action.args.parallel.length, 4);
  r = await continueTurn(r, e, model);
  assert.equal(r.type, 'answer'); assert.equal(r.links.length, 2); assert.equal(peak, 3); assert.equal(charges, 1);
});

test('mixed final/send calls, duplicate call IDs and oversized batches are retried before any execution', async () => {
  for (const mode of ['send', 'answer', 'duplicate', 'oversized']) {
    let stage = 0, reads = 0, invalid = false;
    const e = { ...env, SOURCE_FETCH: async () => { reads++; throw Error('Must not read'); } };
    const model = async () => {
      if (stage++ === 0) return one('check_scope', { allowed: true });
      if (stage === 2) return one('observe_page', {});
      if (!invalid) {
        invalid = true;
        if (mode === 'duplicate') {
          const payload = await response([['read_context', { section: 'about-me' }], ['read_context', { section: 'research-interests' }]]).json();
          payload.choices[0].message.tool_calls[1].id = 'call-0';
          return Response.json(payload);
        }
        if (mode === 'oversized') return response(Array.from({ length: 5 }, () => ['read_context', { section: 'about-me' }]));
        return response([['read_context', { section: 'about-me' }], [mode === 'send' ? 'send_message' : 'answer_profile', {}]]);
      }
      return one('read_context', { section: 'about-me' });
    };
    const r = await continueTurn(await initial(e, model), e, model);
    assert.equal(r.action.name, 'focus_section'); assert.equal(reads, 0); assert.equal(stage, 4);
  }
});

test('URL provenance and public-address checks block invented or private URLs before any fetch', async () => {
  for (const [question, url] of [
    ['Read Linxin’s profile', 'https://invented.example.org/private'],
    ['Read http://127.1/ about Linxin', 'http://127.1/'],
    ['Read https://alice:secret@public.example.org/ about Linxin', 'https://alice:secret@public.example.org/'],
    ['Read http://169.254.169.254/ about Linxin', 'http://169.254.169.254/']
  ]) {
    let stage = 0;
    const e = { ...env, SOURCE_FETCH: () => assert.fail('Unsafe URL must not be fetched') };
    const model = async () => stage++ === 0 ? one('check_scope', { allowed: true }) : stage === 2 ? one('observe_page', {}) : one('read_url', { url, query: '' });
    await assert.rejects(continueTurn(await initial(e, model, question), e, model), /blocked/);
  }
});

test('a URL returned by search can be read and cited without being in the profile catalog', async () => {
  const url = 'https://new-source.example.org/research';
  let stage = 0, reads = 0;
  const e = { ...env, SOURCE_FETCH: async () => { reads++; return new Response(html('Research'), { headers: { 'Content-Type': 'text/html' } }); } };
  const model = async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.plugins) return Response.json({ choices: [{ message: { content: 'Linxin research', annotations: [{ type: 'url_citation', url_citation: { url, content: 'Linxin researches agents.' } }] } }] });
    if (stage++ === 0) return one('check_scope', { allowed: true });
    if (stage === 2) return one('observe_page', {});
    if (stage === 3) return one('web_search', { query: 'Linxin research' });
    if (stage === 4) return one('read_url', { url, query: 'agents' });
    return one('answer_profile', { answer: 'The retrieved page describes agent research.', sources: [], link_sources: [urlID(url)] });
  };
  let r = await initial(e, model);
  while (r.type === 'action') r = await continueTurn(r, e, model);
  assert.equal(reads, 1); assert.equal(r.links[0].url, url);
});

test('parallel search retries share ten attempts including failures, and reserve the question once', async () => {
  let stage = 0, searches = 0, charges = 0;
  const e = { ...env, BILLING: async type => { if (type === 'reserve') charges++; } };
  const model = async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.plugins) { searches++; return new Response('Unavailable', { status: 503 }); }
    if (stage++ === 0) return one('check_scope', { allowed: true });
    if (stage === 2) return one('observe_page', {});
    if (stage === 3) return one('read_context', { section: 'about-me' });
    if (stage === 4) return response(Array.from({ length: 4 }, (_, i) => ['web_search', { query: 'Linxin research ' + i }]));
    assert.equal(searches, 10);
    assert.ok(!body.tools.some(t => t.function.name === 'web_search'));
    const last = body.messages.filter(m => m.tool_calls).at(-1);
    assert.equal(body.messages.slice(body.messages.indexOf(last) + 1).length, 4);
    return one('answer_profile', { answer: 'The local profile describes agent research; external searches were unavailable.', sources: ['about-me'] });
  };
  let r = await initial(e, model);
  while (r.type === 'action') r = await continueTurn(r, e, model);
  assert.equal(r.type, 'answer'); assert.equal(charges, 1); assert.equal(searches, 10);
});

test('parallel paper batches share twelve reads and exact listed URLs cannot bypass the paper budget', async () => {
  let stage = 0, reads = 0;
  const e = { ...env, PAPER_FETCH: async () => new Response('', { status: 404 }) };
  const model = async (_, options) => {
    const body = JSON.parse(options.body);
    if (!body.tools) { reads++; return Response.json({ choices: [{ message: { content: 'Factual research notes about the method, results, experiments and limitations.' } }] }); }
    if (stage++ === 0) return one('check_scope', { allowed: true });
    if (stage === 2) return one('observe_page', {});
    if (stage === 3) return response(Array.from({ length: 4 }, (_, i) => ['read_paper', { paper_ids: Array.from({ length: 3 }, (_, j) => 'arxiv:2601.' + String(i * 3 + j + 1).padStart(5, '0')) }]));
    if (stage === 4) { assert.equal(reads, 12); return one('read_url', { url: 'https://arxiv.org/abs/2601.00013', query: 'method' }); }
    assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
    return one('answer_profile', { answer: 'Comparison of twelve papers.', sources: [], paper_sources: ['arxiv:2601.00001'] });
  };
  let r = await initial(e, model);
  while (r.type === 'action') r = await continueTurn(r, e, model);
  assert.equal(reads, 12); assert.equal(r.type, 'answer');
});

test('memory drops complete parallel rounds without leaving orphan tool results', () => {
  const messages = [{ role: 'user', content: 'Research?' }];
  for (let i = 0; i < 8; i++) {
    const calls = Array.from({ length: 4 }, (_, j) => ({ id: `${i}-${j}` }));
    messages.push({ role: 'assistant', tool_calls: calls }, ...calls.map(c => ({ role: 'tool', tool_call_id: c.id, content: 'source' })));
  }
  const recent = recentTools(messages);
  assert.equal(recent.filter(m => m.role === 'assistant').length, 5);
  for (let i = 1; i < recent.length; i += 5) assert.deepEqual(recent.slice(i + 1, i + 5).map(m => m.tool_call_id), recent[i].tool_calls.map(c => c.id));
  assert.equal(cleanAgentAnswer('Research [url:1234567890abcdef; about-me].'), 'Research.');
});

test('twenty-call cap counts each parallel operation and narrows the final batch to available slots', async () => {
  let admitted = 0, stage = 0;
  const model = async (_, options) => {
    const body = JSON.parse(options.body);
    if (stage++ === 0) return one('check_scope', { allowed: true });
    if (stage === 2) { admitted++; return one('observe_page', {}); }
    if (admitted === 20) {
      assert.equal(body.parallel_tool_calls, false);
      assert.equal(body.tool_choice.function.name, 'answer_profile');
      return one('answer_profile', { answer: 'An overview of the profile.', sources: ['about-me'] });
    }
    const count = Math.min(4, 20 - admitted); admitted += count;
    return response(Array.from({ length: count }, () => ['read_context', { section: 'about-me' }]));
  };
  let r = await initial(env, model), rounds = 0;
  while (r.type === 'action' && rounds++ < 10) r = await continueTurn(r, env, model);
  assert.equal(r.type, 'answer'); assert.equal(admitted, 20); assert.equal(rounds, 6);
});
