import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleRequest } from './core.mjs';
import { sqliteStorage } from './local-storage.mjs';
import { ledgerOperation } from './quota.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { localSourceFetch } from './local-source-fetch.mjs';
import { createScholarService } from './scholar.mjs';

function limiter(maximum) {
  const entries = new Map();
  return { async limit({ key }) {
    const now = Date.now();
    for (const [id, value] of entries) if (value.until <= now) entries.delete(id);
    const item = entries.get(key) || { count: 0, until: now + 60000 };
    item.count++;
    entries.set(key, item);
    return { success: item.count <= maximum };
  } };
}
const storage = sqliteStorage(process.env.AGENT_QUOTA_DB || join(homedir(), '.config', 'linxin-page-agent', 'quota.sqlite'));
const env = { ...process.env, RATE_LIMITER: limiter(60), GLOBAL_LIMITER: limiter(180), LEDGER: { execute: operation => ledgerOperation(storage, operation) } };
env.SCHOLAR = createScholarService(storage, { ...env, SOURCE_FETCH: localSourceFetch });
if (!env.OPENROUTER_API_KEY || !env.OPENROUTER_BASE_URL) throw new Error('Provide OPENROUTER_API_KEY and OPENROUTER_BASE_URL through an external env file.');
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 500000) { res.writeHead(413); res.end('Request too large'); return; }
      chunks.push(chunk);
    }
    const headers = new Headers(req.headers);
    headers.set('cf-connecting-ip', req.socket.remoteAddress); // Use socket identity, never forwarded/client IP headers.
    const body = Buffer.concat(chunks);
    const request = new Request('http://127.0.0.1:4100' + req.url, { method: req.method, headers,
      ...(body.length ? { body } : {}) });
    const profile = await readFile(new URL('../_includes/profile.md', import.meta.url), 'utf8');
    const page = await readFile(new URL('../_site/index.html', import.meta.url), 'utf8');
    const response = await handleRequest(request, { ...env, PROFILE: profile, PAGE_HTML: page, SOURCE_FETCH: localSourceFetch });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch { res.writeHead(500); res.end('{"error":"Local agent unavailable."}'); }
});
server.listen(4100, '127.0.0.1', () => console.log('Page agent listening on http://127.0.0.1:4100 (secrets loaded server-side).'));
