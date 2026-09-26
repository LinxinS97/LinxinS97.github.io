import { linkCatalog } from './links.mjs';

export async function profileSnapshot(page) {
  const encoded = page.match(/<script\b[^>]*\bid=["']agent-profile-snapshot["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!encoded) throw new Error('The published page has no profile snapshot.');
  const data = JSON.parse(encoded);
  if (data.schema !== 1 || typeof data.profile !== 'string' || data.profile.length > 100000 || !data.profile.includes('Linxin Song') || !data.profile.includes('# About Me')) throw new Error('Invalid profile snapshot.');
  const links = linkCatalog(data.profile, page);
  const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const pageHTML = links.map(link => '<a href="' + escape(link.url) + '">' + escape(link.title) + '</a>').join('\n');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.profile + '\n' + pageHTML)));
  const snapshot = { PROFILE: data.profile, PAGE_HTML: pageHTML, PROFILE_VERSION: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''), updatedAt: String(data.updatedAt || '').slice(0, 40) };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 120000) throw new Error('Profile snapshot exceeds storage budget.');
  return snapshot;
}

async function boundedHTML(response) {
  if (!response.ok) { await response.body?.cancel(); throw new Error('Profile update unavailable.'); }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2000000) throw new Error('Published profile too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

// Fixed owner-controlled origin: visitors and model actions cannot pick a URL.
export function createProfileSource(storage, fallback, fetcher = fetch, clock = Date.now) {
  let pending;
  async function refresh(force) {
    const now = clock();
    const saved = await storage.transaction(tx => tx.get('profile:snapshot'));
    if (!force && saved?.checkedAt > now - 60000) return saved.snapshot || fallback;
    try {
      const response = await fetcher('https://linxins.net/', { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: {
        Accept: 'text/html', 'Cache-Control': 'no-cache', ...(saved?.etag ? { 'If-None-Match': saved.etag } : {})
      } });
      let snapshot;
      if (response.status === 304 && saved?.snapshot) snapshot = saved.snapshot;
      else snapshot = await profileSnapshot(await boundedHTML(response));
      await storage.transaction(tx => tx.put('profile:snapshot', { snapshot, checkedAt: now, etag: response.headers.get('etag') || saved?.etag }));
      return snapshot;
    } catch {
      // A partial/failed publish must never replace the last known good copy.
      await storage.transaction(tx => tx.put('profile:snapshot', { ...saved, checkedAt: now }));
      return saved?.snapshot || fallback;
    }
  }
  return { async get(force = false) {
    if (!pending) pending = refresh(force).finally(() => { pending = undefined; });
    return pending;
  } };
}
