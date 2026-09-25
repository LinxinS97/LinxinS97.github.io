import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createScholarService, SCHOLAR_TTL_MS, scholarID, scholarDocuments } from './scholar.mjs';
import { sqliteStorage } from './local-storage.mjs';
import { runAgent } from './core.mjs';
import { linkCatalog } from './links.mjs';

const id = 'IjqXzSwAAAAJ', otherID = 'OtherIDAAAAJ';
const author = (name = 'Linxin Song') => ({ search_metadata: { status: 'Success' }, author: { name, affiliations: 'USC', interests: [{ title: 'Language models' }] },
  articles: [{ title: 'Paper one', authors: 'L Song, Collaborator', cited_by: { value: 42 } }], cited_by: { table: [{ citations: { all: 150 } }, { h_index: { all: 5 } }] } });
const discovery = () => ({ search_metadata: { status: 'Success' }, organic_results: [
  { title: 'Jieyu Zhao - Google Scholar', link: `https://scholar.google.com/citations?hl=en&user=${otherID}`, snippet: 'USC, NLP research' },
  { title: 'Jieyu Zhao - Google Scholar', link: `https://scholar.google.com/citations?user=${id}`, snippet: 'A different institution' },
  { title: 'A coauthor', link: 'https://scholar.google.com/citations?user=CoauthorAAJ', snippet: 'Coauthors: Jieyu Zhao, USC.' },
  { title: 'Duplicate', link: `https://scholar.google.com/citations?user=${otherID}` },
  { title: 'Unsafe result', link: 'https://scholar.google.com.evil.test/citations?user=AttackerAAJ' }
] });
async function database(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'linxin-scholar-'));
  const path = join(directory, 'cache.sqlite');
  let storage = sqliteStorage(path);
  try { await fn(storage, () => { storage.close(); storage = sqliteStorage(path); return storage; }); }
  finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
}

test('author ID cache persists restart, merges concurrent misses, expires in seven days and shares data across queries', async () => {
  await database(async (storage, restart) => {
    let now = Date.now(), calls = 0;
    const fetcher = async (url, options) => {
      calls++;
      assert.equal(options.redirect, 'manual'); // Cloudflare rejects redirect: 'error'.
      const parsed = new URL(url);
      assert.equal(parsed.hostname, 'serpapi.com');
      assert.equal(parsed.searchParams.get('engine'), 'google_scholar_author');
      assert.equal(parsed.searchParams.get('num'), '100');
      await new Promise(resolve => setTimeout(resolve, 10));
      return Response.json(author());
    };
    const env = { SERPAPI_API_KEY: 'test-secret' };
    let service = createScholarService(storage, env, fetcher, () => now);
    const op = { type: 'author', author_id: id, start: 0 };
    const results = await Promise.all(Array.from({ length: 8 }, () => service.execute(op)));
    assert.equal(calls, 1); assert.ok(results.every(result => result.articles[0].citations === 42));
    service = createScholarService(restart(), env, fetcher, () => now);
    assert.equal((await service.execute(op)).cache, 'hit'); assert.equal(calls, 1);
    now += SCHOLAR_TTL_MS + 1;
    assert.equal((await service.execute(op)).cache, 'miss'); assert.equal(calls, 2);
    assert.equal((await service.execute({ ...op, start: 100 })).cache, 'miss'); assert.equal(calls, 3);
    assert.equal((await service.execute(op)).cache, 'hit');
  });
});

test('name resolution caches normalized queries, keeps namesakes separate and only accepts exact Scholar URLs', async () => {
  await database(async storage => {
    let calls = 0;
    const service = createScholarService(storage, { SERPAPI_API_KEY: 'secret' }, async url => {
      calls++; const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('engine'), 'google');
      assert.ok(parsed.searchParams.get('q').startsWith('site:scholar.google.com/citations'));
      return Response.json(discovery());
    });
    const result = await service.execute({ type: 'resolve', name: ' Jieyu  Zhao ', context: 'USC' });
    assert.equal(result.candidates.length, 2); assert.equal(calls, 1);
    assert.equal((await service.execute({ type: 'resolve', name: 'jieyu zhao', context: 'usc' })).cache, 'hit');
    assert.equal(calls, 1);
    await service.execute({ type: 'resolve', name: 'jieyu zhao', context: 'another institution' });
    assert.equal(calls, 2);
    const docs = await scholarDocuments(result);
    assert.ok(docs.every(doc => doc.notes.includes('not verified author statistics')));
    for (const url of ['https://scholar.google.com.evil.test/citations?user=' + id, 'http://scholar.google.com/citations?user=' + id, 'https://scholar.google.com@127.0.0.1/citations?user=' + id, 'https://scholar.google.com/citations?user=../../secret']) assert.equal(scholarID(url), null);
  });
});

test('failed refresh serves dated stale data with cooldown and never leaks provider errors or credentials', async () => {
  await database(async storage => {
    let now = Date.now(), calls = 0, fail = false;
    const service = createScholarService(storage, { SERPAPI_API_KEY: 'secret-not-for-output' }, async () => {
      calls++;
      if (fail) return new Response('provider secret-not-for-output', { status: 429 });
      return Response.json({ ...author(), search_parameters: { api_key: 'secret-not-for-output' } });
    }, () => now);
    const op = { type: 'author', author_id: id };
    const original = await service.execute(op);
    now += SCHOLAR_TTL_MS + 1; fail = true;
    const result = await service.execute(op);
    assert.equal(result.stale, true); assert.equal(result.fetchedAt, original.fetchedAt);
    await service.execute(op); assert.equal(calls, 2);
    assert.ok(!JSON.stringify(result).includes('secret-not-for-output'));
    const failed = await service.execute({ type: 'author', author_id: otherID });
    assert.equal(failed.ok, false); assert.deepEqual(await scholarDocuments(failed), []);
    assert.ok(!JSON.stringify(failed).includes('secret-not-for-output'));
    await service.execute({ type: 'author', author_id: otherID }); assert.equal(calls, 3);
  });
});

test('listed homepages resolve IDs without paid discovery and persist the association in the name cache', async () => {
  await database(async (storage, restart) => {
    let pages = 0;
    const env = { SOURCE_FETCH: async () => {
      pages++;
      return new Response('<html><h1>Jieyu Zhao</h1><p>Assistant Professor of Computer Science at USC. Research in NLP and machine learning.</p><a href="https://scholar.google.com/citations?hl=en&amp;user=' + otherID + '">Google Scholar</a><a href="https://scholar.google.com.evil.test/citations?user=AttackerAAJ">Fake</a></html>', { headers: { 'Content-Type': 'text/html' } });
    } };
    const fetcher = async () => { throw new Error('No paid provider request expected'); };
    const op = { type: 'resolve', name: 'Jieyu Zhao', context: 'USC', homepages: [{ title: 'Jieyu Zhao', url: 'https://jieyuz.net/' }] };
    let service = createScholarService(storage, env, fetcher);
    const result = await service.execute(op);
    assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].author_id, otherID);
    assert.ok(result.candidates[0].snippet.includes('catalog-listed homepage'));
    service = createScholarService(restart(), env, fetcher);
    assert.equal((await service.execute(op)).cache, 'hit'); assert.equal(pages, 1);
  });
});

test('Unicode-heavy author pages are stored in bounded atomic chunks and survive restart', async () => {
  await database(async (storage, restart) => {
    const value = author();
    value.articles = Array.from({ length: 100 }, () => ({ title: '中文😀'.repeat(150), authors: '中文'.repeat(220), publication: '中文'.repeat(180), cited_by: { value: 1 } }));
    const service = createScholarService(storage, { SERPAPI_API_KEY: 'secret' }, async () => Response.json(value));
    const result = await service.execute({ type: 'author', author_id: id });
    assert.equal(result.ok, true); assert.equal(result.articles.length, 100); assert.equal(result.hasMore, true);
    const cached = await createScholarService(restart(), {}, async () => { throw new Error('Must not fetch'); }).execute({ type: 'author', author_id: id });
    assert.equal(cached.cache, 'hit'); assert.deepEqual(cached.articles, result.articles);
  });
});

test('paid misses share an atomic daily cap, cache hits work after exhaustion, next UTC day resets it', async () => {
  await database(async storage => {
    let now = Date.now(), calls = 0;
    const service = createScholarService(storage, { SERPAPI_API_KEY: 'secret', SERPAPI_DAILY_LIMIT: '1' }, async () => { calls++; return Response.json(author()); }, () => now);
    const results = await Promise.all([id, otherID].map(author_id => service.execute({ type: 'author', author_id })));
    assert.equal(calls, 1); assert.equal(results.filter(r => r.ok).length, 1);
    const cachedID = results[0].ok ? id : otherID, missedID = results[0].ok ? otherID : id;
    assert.equal((await service.execute({ type: 'author', author_id: cachedID })).cache, 'hit');
    now += 86400000;
    assert.equal((await service.execute({ type: 'author', author_id: missedID })).ok, true); assert.equal(calls, 2);
  });
});

test('empty discovery is cached; malformed responses and missing keys never become evidence', async () => {
  await database(async storage => {
    let calls = 0;
    const operation = { type: 'resolve', name: 'Unknown researcher', context: '' };
    const service = createScholarService(storage, { SERPAPI_API_KEY: 'secret' }, async () => { calls++; return Response.json({ search_metadata: { status: 'Success' }, organic_results: [] }); });
    assert.equal((await service.execute(operation)).candidates.length, 0);
    assert.equal((await service.execute(operation)).cache, 'hit'); assert.equal(calls, 1);
    const malformed = createScholarService(storage, { SERPAPI_API_KEY: 'secret' }, async () => Response.json({ search_metadata: { status: 'Processing' }, author: { name: 'Fake' } }));
    assert.equal((await malformed.execute({ type: 'author', author_id: id })).ok, false);
    const missing = createScholarService(storage, {}, async () => { throw new Error('Must not fetch'); });
    assert.equal((await missing.execute({ type: 'author', author_id: otherID })).ok, false);
    await assert.rejects(() => missing.execute({ type: 'author', author_id: id, start: 101 }));
  });
});

test('provider redirects are rejected without forwarding the API key to another host', async () => {
  await database(async storage => {
    let calls = 0;
    const service = createScholarService(storage, { SERPAPI_API_KEY: 'test-secret' }, async (url, options) => {
      calls++;
      assert.equal(new URL(url).hostname, 'serpapi.com'); assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example.org/' } });
    });
    const result = await service.execute({ type: 'author', author_id: id });
    assert.equal(result.ok, false); assert.equal(calls, 1); assert.deepEqual(await scholarDocuments(result), []);
  });
});

const baseEnv = { OPENROUTER_API_KEY: 'test-secret', OPENROUTER_BASE_URL: 'https://model.invalid/v1', PROFILE: '# About Me\nLinxin Song / 宋林鑫. Advisor: Jieyu Zhao. [Google Scholar](https://scholar.google.com/citations?user=' + id + ')', VISITOR_ID: 'test' };
const call = (name, args) => Response.json({ choices: [{ message: { tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const observed = { ok: true, text: 'Untrusted browser observation.' };
async function runLoop(question, env, fetcher) {
  let result = await runAgent({ question }, env, 'https://profile.example', fetcher);
  while (result.type === 'action') {
    assert.ok(['observe_page', 'web_search', 'read_links'].includes(result.action.name));
    result = await runAgent({ state: result.state, result: observed }, env, 'https://profile.example', fetcher);
  }
  return result;
}

test('owner alias skips paid discovery; server reads verified ID and returns clickable Scholar evidence', async () => {
  const operations = [];
  const env = { ...baseEnv, SCHOLAR: { execute: async operation => { operations.push(operation); return { ok: true, type: 'author', author_id: id, name: 'Linxin Song', articles: [{ title: 'Paper one', citations: 42 }], fetchedAt: '2026-09-24T00:00:00Z', hasMore: false, start: 0 }; } } };
  let step = 0;
  const fetcher = async (_, options) => {
    const body = JSON.parse(options.body);
    switch (step++) {
      case 0: return call('check_scope', { allowed: true });
      case 1: return call('observe_page', {});
      case 2: return call('search_scholar_author', { name: '宋林鑫', context: '' });
      case 3: return call('read_scholar_author', { author_id: id, start: 0 });
      default: {
        assert.ok(options.body.includes('Paper one'));
        const source = body.messages[0].content.match(/search:[a-f0-9]{16}/)[0];
        return call('answer_profile', { answer: 'Paper one has 42 citations as of September 24.', sources: [], paper_sources: [], link_sources: [source] });
      }
    }
  };
  const result = await runLoop('你引用最多的论文是什么？', env, fetcher);
  assert.deepEqual(operations, [{ type: 'author', author_id: id, start: 0 }]);
  assert.equal(result.links[0].url, 'https://scholar.google.com/citations?user=' + id);
});

test('unknown IDs cannot be fetched; discovery candidates permit a subsequent verified author read', async () => {
  for (const discover of [false, true]) {
    let step = 0, reads = 0;
    const env = { ...baseEnv, SCHOLAR: { execute: async operation => {
      if (operation.type === 'resolve') return { ok: true, type: 'resolve', candidates: [{ author_id: otherID, title: 'Jieyu Zhao', url: 'https://scholar.google.com/citations?user=' + otherID, snippet: 'USC NLP' }], fetchedAt: '2026-09-24' };
      reads++; return { ok: true, type: 'author', author_id: otherID, name: 'Jieyu Zhao', articles: [], start: 0, hasMore: false, fetchedAt: '2026-09-24' };
    } } };
    const fetcher = async (_, options) => {
      const body = JSON.parse(options.body);
      if (step++ === 0) return call('check_scope', { allowed: true });
      if (step === 2) return call('observe_page', {});
      if (step === 3 && discover) return call('search_scholar_author', { name: 'Jieyu Zhao', context: 'USC' });
      if (step <= (discover ? 4 : 3)) return call('read_scholar_author', { author_id: otherID, start: 0 });
      const source = body.messages[0].content.match(/search:[a-f0-9]{16}/)[0];
      return call('answer_profile', { answer: 'The retrieved author is Jieyu Zhao.', sources: [], paper_sources: [], link_sources: [source] });
    };
    if (!discover) { await assert.rejects(() => runLoop('导师的 Scholar 信息', env, fetcher), /unverified Scholar/); assert.equal(reads, 0); }
    else { assert.equal((await runLoop('导师的 Scholar 信息', env, fetcher)).type, 'answer'); assert.equal(reads, 1); }
  }
});

test('existing read_context Scholar links use the same cache service, never direct Google fetch', async () => {
  let step = 0, reads = 0;
  const link = linkCatalog(baseEnv.PROFILE)[0];
  const env = { ...baseEnv, SOURCE_FETCH: async () => { throw new Error('Direct Scholar fetch must not run'); }, SCHOLAR: { execute: async () => { reads++; return { ok: true, type: 'author', author_id: id, name: 'Linxin Song', articles: [], start: 0, hasMore: false, fetchedAt: '2026-09-24' }; } } };
  const fetcher = async () => {
    switch (step++) {
      case 0: return call('check_scope', { allowed: true });
      case 1: return call('observe_page', {});
      case 2: return call('read_context', { section: '', link_ids: [link.id], query: 'citations' });
      default: return call('answer_profile', { answer: 'Scholar data retrieved.', sources: [], paper_sources: [], link_sources: [link.id] });
    }
  };
  const result = await runLoop('Read Linxin Scholar', env, fetcher);
  assert.equal(reads, 1); assert.equal(result.links[0].url, link.url);
});
