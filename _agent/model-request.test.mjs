import test from 'node:test';
import assert from 'node:assert/strict';
import { modelRequest, invalidModelOutput } from './model-request.mjs';
import { runAgent } from './core.mjs';

const env = { OPENROUTER_API_KEY: 'test-secret', OPENROUTER_BASE_URL: 'https://model.invalid/v1', PROFILE: '# About Me\nLinxin Song researches agents.' };
const origin = 'https://profile.example.org';
const action = (name, args) => ({ choices: [{ message: { tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const call = (name, args) => Response.json(action(name, args));
const observed = { ok: true, text: 'about-me: Linxin Song researches agents.' };

test('HTTP, transport and malformed responses share a bounded retry budget with backoff', async () => {
  for (const failure of [() => new Response('private provider error', { status: 503 }), () => { throw new TypeError('fetch failed'); }, () => { throw new DOMException('timed out', 'TimeoutError'); }, () => new Response('{'), () => Response.json({})]) {
    let calls = 0;
    const delays = [];
    const result = await modelRequest(env, { messages: [] }, async () => ++calls < 3 ? failure() : Response.json({ ok: true }), {
      sleep: async ms => delays.push(ms), validate: data => { if (!data.ok) invalidModelOutput(); return data; }
    });
    assert.equal(result.ok, true); assert.equal(calls, 3); assert.deepEqual(delays, [300, 600]);
  }
  let calls = 0;
  await assert.rejects(modelRequest(env, {}, async () => { calls++; return new Response('secret', { status: 502 }); }, { sleep: async () => {} }), /temporarily unavailable/);
  assert.equal(calls, 3);
});

test('permanent provider failures do not retry or expose provider bodies; cooldown is honored', async () => {
  for (const status of [400, 401, 402, 403, 404, 422]) {
    let calls = 0;
    await assert.rejects(modelRequest(env, {}, async () => { calls++; return new Response(env.OPENROUTER_API_KEY, { status }); }), error => !error.message.includes(env.OPENROUTER_API_KEY));
    assert.equal(calls, 1);
  }
  let calls = 0; const delays = [];
  await modelRequest(env, {}, async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '1' } }) : Response.json({}), { sleep: async ms => delays.push(ms) });
  assert.deepEqual(delays, [1000]);
  calls = 0;
  await assert.rejects(modelRequest(env, {}, async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); }), /busy/);
  assert.equal(calls, 1);
});

test('malformed tools recover before any page action and reserve only one visitor question', async () => {
  const invalid = [
    { choices: [{ message: { content: 'A plain-text response with no action.' } }] },
    { choices: [{ message: { tool_calls: [null] } }] },
    { choices: [{ message: { tool_calls: [...action('observe_page', {}).choices[0].message.tool_calls, ...action('observe_page', {}).choices[0].message.tool_calls] } }] },
    action('observe_page', []),
    action('find_on_page', { query: 42 }),
    action('read_paper', { paper_ids: [] })
  ];
  const badJson = action('observe_page', {}); badJson.choices[0].message.tool_calls[0].function.arguments = '{'; invalid.push(badJson);
  for (const malformed of invalid) {
    let requests = 0, charges = 0;
    const result = await runAgent({ question: 'His research?' }, { ...env, BILLING: async type => { if (type === 'reserve') charges++; } }, origin, async () => {
      if (++requests === 1) return call('check_scope', { allowed: true });
      if (requests === 2) return Response.json(malformed);
      return call('observe_page', {});
    });
    assert.equal(result.action.name, 'observe_page'); assert.equal(requests, 3); assert.equal(charges, 1);
  }
});

test('invalid classification and action continuations recover without replaying quota steps', async () => {
  let requests = 0; const billing = [];
  const e = { ...env, BILLING: async type => billing.push(type) };
  const provider = async () => {
    requests++;
    if (requests === 1) return call('check_scope', { allowed: 'yes' });
    if (requests === 2) return call('check_scope', { allowed: true });
    if (requests === 3) return call('observe_page', {});
    if (requests === 4) return new Response('', { status: 503 });
    if (requests === 5) return call('read_context', { section: 'about-me' });
    return call('answer_profile', { answer: 'Linxin researches agents.', sources: ['about-me'] });
  };
  let result = await runAgent({ question: 'His research?' }, e, origin, provider);
  while (result.type === 'action') result = await runAgent({ state: result.state, result: observed }, e, origin, provider);
  assert.equal(result.type, 'answer'); assert.deepEqual(billing, ['reserve', 'step', 'step']); assert.equal(requests, 6);
});

test('persistent malformed actions stop after three generations and never execute a tool', async () => {
  let requests = 0, charges = 0;
  await assert.rejects(runAgent({ question: 'His research?' }, { ...env, BILLING: async type => { if (type === 'reserve') charges++; } }, origin, async () => {
    if (++requests === 1) return call('check_scope', { allowed: true });
    return Response.json({ choices: [{ message: { content: 'No action' } }] });
  }), /valid page action/);
  assert.equal(requests, 4); assert.equal(charges, 1);
});

test('search retry consumes remaining search budget without repeating the page action or question charge', async () => {
  let searches = 0, stage = 0, charges = 0;
  const e = { ...env, BILLING: async type => { if (type === 'reserve') charges++; } };
  const provider = async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.plugins) {
      searches++;
      if (searches % 3 !== 0 && searches !== 10) return new Response('', { status: 503 });
      return Response.json({ choices: [{ message: { content: 'Linxin researches agents.', annotations: [{ type: 'url_citation', url_citation: { url: 'https://research.example.org/linxin', title: 'Research', content: 'Linxin researches agents.' } }] } }] });
    }
    if (++stage === 1) return call('check_scope', { allowed: true });
    if (stage === 2) return call('observe_page', {});
    if (stage <= 6) return call('web_search', { query: 'Linxin Song research' });
    assert.ok(!body.tools.some(tool => tool.function.name === 'web_search'));
    const id = body.tools.find(tool => tool.function.name === 'answer_profile').function.parameters.properties.link_sources.items.enum[0];
    return call('answer_profile', { answer: 'Linxin researches agents.', sources: [], link_sources: [id] });
  };
  let result = await runAgent({ question: 'Search for Linxin research.' }, e, origin, provider);
  while (result.type === 'action') result = await runAgent({ state: result.state, result: observed }, e, origin, provider);
  assert.equal(result.links.length, 1); assert.equal(searches, 10); assert.equal(charges, 1);
});
