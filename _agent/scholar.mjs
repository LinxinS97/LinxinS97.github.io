// Scholar retrieval is independent of the language model. Only these fixed SerpApi
// engines/parameters are sent upstream; raw provider responses never enter prompts.
import { readLink, publicURL } from './links.mjs';
export const SCHOLAR_TTL_MS = 7 * 86400000;
const ID = /^[A-Za-z0-9_-]{6,32}$/;
const text = (value, limit = 300) => typeof value === 'string' ? value.slice(0, limit) : '';
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
class ScholarProviderError extends Error {
  constructor(code) { super('Scholar provider unavailable.'); this.code = code; }
}
export const scholarURL = id => 'https://scholar.google.com/citations?user=' + encodeURIComponent(id);
export function scholarID(value) {
  try {
    const url = new URL(value);
    const id = url.searchParams.get('user');
    return url.protocol === 'https:' && url.hostname === 'scholar.google.com' && url.pathname === '/citations' && !url.username && !url.password && ID.test(id || '') ? id : null;
  } catch { return null; }
}
export function scholarOperation(input) {
  if (input?.type === 'author' && typeof input.author_id === 'string' && ID.test(input.author_id) && Number.isInteger(input.start ?? 0) && (input.start ?? 0) >= 0 && (input.start ?? 0) <= 900 && (input.start ?? 0) % 100 === 0) {
    const start = input.start ?? 0;
    return { type: 'author', author_id: input.author_id, start, key: `scholar:v1:author:${input.author_id}:${start}` };
  }
  if (input?.type === 'resolve' && typeof input.name === 'string' && input.name.trim() && input.name.length <= 120 && typeof input.context === 'string' && input.context.length <= 160) {
    const name = normalize(input.name), context = normalize(input.context);
    const homepages = Array.isArray(input.homepages) ? input.homepages.slice(0, 1).map(link => ({ title: text(link.title), url: publicURL(link.url).href })) : [];
    return { type: 'resolve', name, context, homepages, key: 'scholar:v2:name:' + JSON.stringify([name, context]) };
  }
  throw new Error('Invalid Scholar lookup.');
}
async function jsonResponse(response) {
  if (!response.ok) { await response.body?.cancel(); throw new ScholarProviderError('http_' + response.status); }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2000000) throw new Error('Scholar response too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data.error || data.search_metadata?.status !== 'Success') throw new ScholarProviderError('invalid_provider_result');
  return data;
}
function authorData(data, op) {
  if (!text(data.author?.name) || !Array.isArray(data.articles)) throw new Error('Invalid Scholar author response.');
  return {
    type: 'author', author_id: op.author_id, name: text(data.author.name), affiliations: text(data.author.affiliations, 500),
    interests: (data.author.interests || []).slice(0, 12).map(item => text(item.title)),
    metrics: (data.cited_by?.table || []).slice(0, 3).map(row => Object.fromEntries(Object.entries(row).slice(0, 1).map(([key, values]) => [text(key, 40), Object.fromEntries(Object.entries(values || {}).slice(0, 3).map(([period, value]) => [text(period, 40), number(value)]))]))),
    articles: data.articles.slice(0, 100).filter(item => text(item.title)).map(item => ({ title: text(item.title, 400), authors: text(item.authors, 400), publication: text(item.publication, 300), year: text(String(item.year || ''), 10), citations: number(item.cited_by?.value) })),
    start: op.start, hasMore: Boolean(data.serpapi_pagination?.next || data.pagination?.next || data.articles.length >= 100),
    order: 'citations descending',
    // Do not store search_parameters, API URLs, thumbnails or arbitrary provider fields.
  };
}
function candidatesData(data, op) {
  if (!Array.isArray(data.organic_results) && data.search_information?.organic_results_state !== 'Fully empty') throw new Error('Invalid Scholar discovery response.');
  const candidates = [], seen = new Set();
  for (const item of data.organic_results || []) {
    const id = scholarID(item.link);
    // A coauthor's name in a snippet does not make this that person's profile.
    const tokens = normalize(op.name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const title = normalize(text(item.title)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!id || seen.has(id) || !tokens.every(token => title.includes(token))) continue;
    seen.add(id);
    candidates.push({ author_id: id, title: text(item.title), snippet: text(item.snippet, 800), url: scholarURL(id) });
    if (candidates.length === 5) break;
  }
  return { type: 'resolve', candidates };
}
export function createScholarService(storage, env, fetcher = fetch, clock = Date.now) {
  const inflight = new Map();
  const readCache = key => storage.transaction(async tx => {
    const record = await tx.get(key);
    if (!record?.chunks) return record;
    let serialized = '';
    for (let index = 0; index < record.chunks; index++) serialized += await tx.get(key + ':chunk:' + index);
    return { ...record, data: JSON.parse(serialized) };
  });
  const writeCache = (key, record) => storage.transaction(async tx => {
    // Each DO KV value must stay below 128 KiB, including non-ASCII author data.
    const serialized = record.data ? JSON.stringify(record.data) : '';
    const chunks = Math.ceil(serialized.length / 16000);
    for (let index = 0; index < chunks; index++) await tx.put(key + ':chunk:' + index, serialized.slice(index * 16000, (index + 1) * 16000));
    const { data, ...metadata } = record;
    await tx.put(key, { ...metadata, chunks });
  });
  async function lookup(op) {
    const now = clock();
    const cached = await readCache(op.key);
    if (cached?.data && cached.expires > now) return { ok: true, ...cached.data, fetchedAt: cached.fetchedAt, cache: 'hit', stale: false };
    const fallback = () => cached?.data
      ? { ok: true, ...cached.data, fetchedAt: cached.fetchedAt, cache: 'stale', stale: true }
      : { ok: false, error: 'Google Scholar data is temporarily unavailable. Do not infer citation counts or author identity.' };
    if (cached?.retryAfter > now) return fallback();
    const save = async data => {
      const record = { data, fetchedAt: new Date(now).toISOString(), expires: now + SCHOLAR_TTL_MS };
      await writeCache(op.key, record);
      return { ok: true, ...data, fetchedAt: record.fetchedAt, cache: 'miss', stale: false };
    };
    // A catalog-listed personal homepage often identifies the right Scholar
    // account more reliably than Google snippets, and costs no SerpApi request.
    if (op.type === 'resolve' && env.SOURCE_FETCH) {
      for (const homepage of op.homepages) {
        try {
          const page = await readLink(homepage, op.name + ' ' + op.context, env.SOURCE_FETCH);
          const candidates = (page.scholarProfiles || []).map(link => ({ author_id: scholarID(link.url), title: homepage.title + ' — ' + link.title,
            url: scholarURL(scholarID(link.url)), snippet: 'Scholar link on the catalog-listed homepage ' + homepage.url + '. Homepage excerpt: ' + page.notes.slice(0, 1200) }));
          if (candidates.length) return await save({ type: 'resolve', candidates });
        } catch { /* Use indexed discovery only when the listed homepage fails. */ }
      }
    }
    if (!env.SERPAPI_API_KEY) {
      console.warn('ScholarDiagnostic', 'missing_secret');
      return fallback();
    }
    // A global persistent request ceiling bounds paid misses across all visitors.
    const admitted = await storage.transaction(async tx => {
      const day = new Date(now).toISOString().slice(0, 10);
      let budget = await tx.get('scholar:budget');
      if (budget?.day !== day) budget = { day, count: 0 };
      const configured = Number(env.SERPAPI_DAILY_LIMIT ?? 100);
      const limit = Number.isInteger(configured) && configured >= 0 ? configured : 100;
      if (budget.count >= limit) return false;
      await tx.put('scholar:budget', { day, count: budget.count + 1 });
      return true;
    });
    if (!admitted) return fallback();
    try {
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('api_key', env.SERPAPI_API_KEY);
      url.searchParams.set('hl', 'en');
      if (op.type === 'author') {
        for (const [key, value] of Object.entries({ engine: 'google_scholar_author', author_id: op.author_id, start: op.start, num: 100 })) url.searchParams.set(key, String(value));
      } else {
        url.searchParams.set('engine', 'google');
        // Profiles API was discontinued; indexed profile URLs still supply IDs.
        const quote = value => '"' + value.replace(/["\\]/g, ' ') + '"';
        url.searchParams.set('q', 'site:scholar.google.com/citations intitle:' + quote(op.name) + (op.context ? ' ' + op.context.replace(/[^\p{L}\p{N}\s-]/gu, ' ') : ''));
      }
      // Workers supports manual/follow redirects. Reject 3xx in jsonResponse;
      // never follow a provider redirect carrying the API key in its URL.
      const data = await jsonResponse(await fetcher(url.href, { redirect: 'manual', signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json' } }));
      const result = op.type === 'author' ? authorData(data, op) : candidatesData(data, op);
      // Expensive calls are not blindly retried. Failures receive a short cooldown.
      return await save(result);
    } catch (error) {
      // Never log provider URLs, bodies, keys, queries or full error messages.
      console.warn('ScholarDiagnostic', error instanceof ScholarProviderError ? error.code : ['TimeoutError', 'AbortError', 'SyntaxError', 'TypeError'].includes(error?.name) ? error.name : 'retrieval_failed');
      await writeCache(op.key, { ...cached, retryAfter: now + 300000 });
      return fallback();
    }
  }
  return { async execute(input) {
    const op = scholarOperation(input);
    if (!inflight.has(op.key)) inflight.set(op.key, lookup(op).finally(() => inflight.delete(op.key)));
    return structuredClone(await inflight.get(op.key));
  } };
}

// Only private Worker bindings can reach this object; there is no public cache API.
export class ScholarCache {
  constructor(ctx, env) { this.service = createScholarService(ctx.storage, env); }
  async fetch(request) {
    try { return Response.json(await this.service.execute(await request.json())); }
    catch (error) {
      console.warn('ScholarDiagnostic', 'storage_or_operation_failed', error instanceof TypeError ? 'TypeError' : 'Error');
      return Response.json({ ok: false, error: 'Scholar lookup unavailable.' });
    }
  }
}
async function sourceID(url) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)));
  return 'search:' + Array.from(bytes.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function scholarDocuments(result) {
  if (!result.ok) return [];
  if (result.type === 'resolve') return Promise.all(result.candidates.map(async candidate => ({
    id: await sourceID(candidate.url + '#identity'), kind: 'websearch', url: candidate.url, title: candidate.title,
    scholarAuthorId: candidate.author_id,
    notes: `Scholar identity candidate (listed homepage link or Google search snippet), retrieved ${result.fetchedAt}${result.stale ? ' (stale cache; refresh failed)' : ''}. This is identity evidence, not verified author statistics. Compare name, affiliation and research; do not assume the first result is the right person.\n${candidate.snippet}`
  })));
  const url = scholarURL(result.author_id) + (result.start ? '&cstart=' + result.start : '');
  const { ok, cache, ...evidence } = result;
  return [{ id: await sourceID(url), kind: 'websearch', title: result.name + ' — Google Scholar', url, scholarAuthorId: result.author_id,
    notes: `Google Scholar structured author data via SerpApi, retrieved ${result.fetchedAt}${result.stale ? ' (STALE CACHE: refresh failed)' : ''}. Page offset ${result.start}, ${result.articles.length} articles, hasMore=${result.hasMore}. Cite the retrieval date. Articles are a citation-sorted page, NOT necessarily the complete publication list. Do not infer total paper count from a partial list. hasMore=true allows the next 100-result page. If document.truncated=true the carried notes omit some data. Author strings may be abbreviated and cannot rule out collaborations.\n` + JSON.stringify(evidence) }];
}
