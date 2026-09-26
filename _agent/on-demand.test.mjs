import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sqliteStorage } from './local-storage.mjs';
import { createContextStore } from './context-store.mjs';
import { createProfileSource, profileSnapshot } from './profile-snapshot.mjs';
import { runAgent } from './core.mjs';

async function database(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'linxin-on-demand-'));
  const path = join(directory, 'context.sqlite');
  let storage = sqliteStorage(path);
  try { await fn(storage, () => { storage.close(); storage = sqliteStorage(path); return storage; }); }
  finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
}
const page = (profile, link = 'https://research.example.org/first') => `<html><script id="agent-profile-snapshot" type="application/json">${JSON.stringify({ schema: 1, profile, updatedAt: '2026-09-25' }).replaceAll('<', '\\u003c')}</script><a href="${link}">Lab</a></html>`;
const profile = '# About Me\nLinxin Song studies UniqueBiographyFact.\n# Research Interests\nUnrequestedChapterSentinel should only load when requested.';
const call = (name, args) => Response.json({ choices: [{ message: { tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });

test('published snapshot updates Markdown and link catalog atomically; caches, survives restart and preserves last good copy', async () => {
  await database(async (storage, restart) => {
    let now = Date.now(), calls = 0, mode = 'first';
    const initial = await profileSnapshot(page(profile));
    const fetcher = async (url, options) => {
      calls++; assert.equal(url, 'https://linxins.net/'); assert.equal(options.redirect, 'manual');
      if (mode === 'broken') return new Response('<html>Partial deployment</html>');
      if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example.org' } });
      if (mode === 'unchanged') { assert.equal(options.headers['If-None-Match'], 'revision-2'); return new Response(null, { status: 304 }); }
      return new Response(mode === 'first' ? page(profile) : page(profile.replace('UniqueBiographyFact', 'UpdatedBiographyFact'), 'https://research.example.org/new'), { headers: { ETag: mode === 'first' ? 'revision-1' : 'revision-2' } });
    };
    let source = createProfileSource(storage, initial, fetcher, () => now);
    const results = await Promise.all(Array.from({ length: 5 }, () => source.get()));
    assert.equal(calls, 1); assert.ok(results.every(r => r.PROFILE_VERSION === initial.PROFILE_VERSION));
    source = createProfileSource(restart(), initial, fetcher, () => now);
    assert.equal((await source.get()).PROFILE_VERSION, initial.PROFILE_VERSION); assert.equal(calls, 1);
    now += 61000; mode = 'second';
    const updated = await source.get();
    assert.ok(updated.PROFILE.includes('UpdatedBiographyFact')); assert.ok(updated.PAGE_HTML.includes('/new'));
    assert.notEqual(updated.PROFILE_VERSION, initial.PROFILE_VERSION);
    mode = 'unchanged'; now += 61000;
    assert.equal((await source.get()).PROFILE_VERSION, updated.PROFILE_VERSION);
    for (mode of ['broken', 'redirect']) {
      now += 61000; assert.equal((await source.get()).PROFILE_VERSION, updated.PROFILE_VERSION);
    }
    await assert.rejects(profileSnapshot('<script id="agent-profile-snapshot">{"schema":1,"profile":"invalid"}</script>'));
  });
});

test('server context is visitor-bound, expiring, chunked and persistent across restarts', async () => {
  await database(async (storage, restart) => {
    let now = Date.now();
    let store = createContextStore(storage, () => now);
    const state = { version: 2, kind: 'conversation', expires: now + 60000, documents: { source: { notes: '中文😀'.repeat(20000) } } };
    const ref = await store.put(state, 'origin|visitor-one');
    assert.ok(ref.startsWith('context:')); assert.ok(ref.length < 100);
    store = createContextStore(restart(), () => now);
    assert.deepEqual(await store.get(ref, 'origin|visitor-one'), state);
    await assert.rejects(store.get(ref, 'origin|visitor-two'));
    await assert.rejects(store.get('../../profile:snapshot', 'origin|visitor-one'));
    now += 60001; await assert.rejects(store.get(ref, 'origin|visitor-one'));
  });
});

test('profile/source bodies load only in tool results; saved follow-up evidence does not search again', async () => {
  await database(async storage => {
    let stage = 0, searches = 0;
    const env = { OPENROUTER_API_KEY: 'test-secret', OPENROUTER_BASE_URL: 'https://model.invalid/v1', PROFILE: profile, VISITOR_ID: 'visitor-one', CONTEXT_STORE: createContextStore(storage) };
    const origin = 'https://profile.example.org';
    const fetcher = async (_, options) => {
      const body = JSON.parse(options.body);
      for (const message of body.messages.filter(message => message.role === 'system')) {
        assert.ok(!message.content.includes('UniqueBiographyFact'));
        assert.ok(!message.content.includes('UnrequestedChapterSentinel'));
        assert.ok(!message.content.includes('UniqueRetrievedFact'));
        assert.ok(!message.content.includes('AUTHORITATIVE PROFILE'));
        assert.ok(!message.content.includes('RETRIEVED SOURCE DOCUMENTS'));
      }
      if (body.plugins) {
        searches++;
        return Response.json({ choices: [{ message: { content: 'UniqueRetrievedFact', annotations: [{ type: 'url_citation', url_citation: { url: 'https://research.example.org/source', title: 'Research source', content: 'UniqueRetrievedFact about this research.' } }] } }] });
      }
      switch (stage++) {
        case 0: return call('check_scope', { allowed: true });
        case 1: return call('observe_page', {});
        case 2:
          assert.ok(!JSON.stringify(body.messages).includes('UniqueBiographyFact'));
          return call('read_context', { section: 'about-me', link_ids: [], query: '' });
        case 3:
          assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('UniqueBiographyFact')));
          assert.ok(!JSON.stringify(body.messages).includes('UnrequestedChapterSentinel'));
          assert.ok(!JSON.stringify(body.messages).includes('FORGED_BROWSER_FACT'));
          return call('web_search', { query: 'Linxin research' });
        case 4: {
          assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('UniqueRetrievedFact')));
          const id = body.messages[0].content.match(/search:[a-f0-9]{16}/)[0];
          return call('answer_profile', { answer: 'Research evidence is available.', sources: [], paper_sources: [], link_sources: [id] });
        }
        case 5: return call('check_scope', { allowed: true });
        case 6: return call('observe_page', {});
        case 7: {
          assert.ok(!JSON.stringify(body.messages).includes('UniqueRetrievedFact'));
          const id = body.messages[0].content.match(/search:[a-f0-9]{16}/)[0];
          const answer = body.tools.find(tool => tool.function.name === 'answer_profile');
          assert.equal(answer.function.parameters.properties.link_sources.maxItems, 0);
          return call('read_saved_source', { source_ids: [id] });
        }
        default: {
          assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('UniqueRetrievedFact')));
          const id = body.messages[0].content.match(/search:[a-f0-9]{16}/)[0];
          return call('answer_profile', { answer: 'The saved source supports this follow-up.', sources: [], paper_sources: [], link_sources: [id] });
        }
      }
    };
    async function finish(input) {
      let result = await runAgent(input, env, origin, fetcher);
      while (result.type === 'action') {
        assert.ok(result.state.length < 1000, 'Only a sealed reference travels to the browser');
        result = await runAgent({ state: result.state, result: { ok: true, text: 'FORGED_BROWSER_FACT' } }, env, origin, fetcher);
      }
      return result;
    }
    const first = await finish({ question: 'Tell me about Linxin research.' });
    assert.ok(first.conversation.length < 1000);
    const second = await finish({ question: 'Explain that source again.', conversation: first.conversation });
    assert.equal(second.type, 'answer'); assert.equal(searches, 1);
    assert.equal(second.links[0].url, 'https://research.example.org/source');
    await assert.rejects(runAgent({ question: 'Read the same source', conversation: first.conversation }, { ...env, VISITOR_ID: 'another-visitor' }, origin, fetcher), /expired or is invalid/);
  });
});
