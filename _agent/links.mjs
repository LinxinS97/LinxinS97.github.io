import { buildProfileIndex, searchProfileIndex } from './profile-index.mjs';

function decode(text) {
  return text.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(Math.min(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n), 0x10ffff)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name]);
}
export function publicURL(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host) ||
      /^[\d.]+$/.test(host) || host.includes(':') || host.endsWith('.')) throw new Error('Not a public web URL.');
  url.hash = '';
  return url;
}
function sourceID(url) {
  // Stable across source reordering; IDs are looked up in the server-owned catalog.
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(url)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return 'link:' + hash.toString(16);
}
export function linkCatalog(profile, page = '') {
  const entries = new Map();
  function add(label, href, section, context) {
    let url;
    try { url = publicURL(decode(href)).href; } catch { return; }
    const title = decode(label.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200) || new URL(url).hostname;
    const existing = entries.get(url);
    if (existing) { if (!existing.labels.includes(title)) existing.labels.push(title); return; }
    entries.set(url, { id: sourceID(url), title, labels: [title], url, section,
      context: decode(context.replace(/<[^>]*>/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')).replace(/\s+/g, ' ').trim().slice(0, 500) });
  }
  let section = 'about-me';
  for (const line of profile.split('\n')) {
    if (/^#{1,3} /.test(line)) section = line.replace(/^#+\s*/, '').trim().toLowerCase().replace(/\s+/g, '-');
    for (const match of line.matchAll(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g)) add(match[1], match[2], section, line);
  }
  const html = (profile + '\n' + page).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) add(match[2], match[1], 'about-me', match[2]);
  return [...entries.values()];
}
export function searchLinks(catalog, queries) {
  const titles = Object.fromEntries(catalog.map(link => [link.id, link.title]));
  const index = buildProfileIndex(catalog.map(link => '# ' + link.id + '\n' + link.labels.join(' ') + ' ' + link.url).join('\n\n'), titles);
  const contextual = buildProfileIndex(catalog.map(link => '# ' + link.id + '\n' + link.context).join('\n\n'), titles);
  const hits = [...searchProfileIndex(index, queries).matches, ...searchProfileIndex(contextual, queries).matches];
  return [...new Map(hits.map(hit => [hit.section, { id: hit.section, title: hit.title, excerpt: hit.text }])).values()].slice(0, 5);
}
export const linkDirectory = catalog => catalog.map(({ id, title, url }) => ({ id, title, url }));
export function pageText(html) {
  return decode(html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|noscript|template|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(?:p|div|section|article|h[1-6]|tr|li|nav|footer)>|<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')).replace(/[\t ]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}
async function boundedText(response) {
  if (Number(response.headers.get('content-length')) > 2000000) throw new Error('Page too large.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2000000) throw new Error('Page too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
// Cache only source text, never questions, visitor IDs or model answers.
const caches = new WeakMap();
async function fetchPage(link, fetcher) {
  let cache = caches.get(fetcher);
  if (!cache) { cache = new Map(); caches.set(fetcher, cache); }
  const previous = cache.get(link.url);
  if (previous && previous.expires > Date.now()) return previous.page;
  const signal = AbortSignal.timeout(20000);
  let url = publicURL(link.url);
  for (let hop = 0; hop <= 4; hop++) {
    const response = await fetcher(url.href, { redirect: 'manual', signal, headers: { Accept: 'text/html,text/plain;q=0.9', 'User-Agent': 'LinxinProfileAgent/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = response.headers.get('location');
      if (!next || hop === 4) throw new Error('Redirect unavailable.');
      const destination = publicURL(new URL(next, url).href);
      if (url.protocol === 'https:' && destination.protocol !== 'https:') throw new Error('Insecure redirect.');
      url = destination; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Page unavailable.'); }
    const type = response.headers.get('content-type') || '';
    if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(type)) { await response.body?.cancel(); throw new Error('No readable HTML/text.'); }
    const raw = await boundedText(response);
    const text = /html/i.test(type) ? pageText(raw) : raw.trim();
    if (text.length < 80 || /^(?:Just a moment|Access Denied|Attention Required!)/i.test(text) || /enable javascript and cookies to continue/i.test(text)) throw new Error('Page requires browser access.');
    const scholarProfiles = /html/i.test(type) ? linkCatalog('', raw).filter(link => {
      const target = new URL(link.url);
      return target.protocol === 'https:' && target.hostname === 'scholar.google.com' && target.pathname === '/citations' && /^[A-Za-z0-9_-]{6,32}$/.test(target.searchParams.get('user') || '');
    }).slice(0, 5).map(({ title, url }) => ({ title, url })) : [];
    const page = { text: text.slice(0, 160000), truncated: text.length > 160000, resolved_url: url.href, scholarProfiles };
    cache.delete(link.url);
    cache.set(link.url, { page, expires: Date.now() + 15 * 60 * 1000 });
    while (cache.size > 32) cache.delete(cache.keys().next().value);
    return page;
  }
}
export async function readLink(link, question, fetcher = fetch) {
  const page = await fetchPage(link, fetcher);
  // Send question-relevant excerpts, not a separate summarization model call or the entire site.
  const index = buildProfileIndex('# about-me\n' + page.text, { 'about-me': link.title });
  const hits = searchProfileIndex(index, [question]).matches;
  const excerpts = [...new Set([page.text.slice(0, 2200), ...hits.map(hit => hit.text)])];
  const notes = excerpts.join('\n\n[…]\n\n').slice(0, 8000);
  return { id: link.id, kind: 'webpage', title: link.title, url: link.url, resolved_url: page.resolved_url,
    format: 'HTML/text excerpts', truncated: page.truncated || page.text.length > notes.length,
    scholarProfiles: page.scholarProfiles, notes: notes + (page.scholarProfiles.length ? '\nScholar profile links found on this page (check whose profile each is): ' + JSON.stringify(page.scholarProfiles) : '') };
}
