import { handleRequest } from './core.mjs';
import profile, { pageHTML } from './profile.generated.mjs';
import { workerSourceFetch } from './source-fetch.mjs';
export { VisitorQuota } from './quota.mjs';
import { ScholarCache as ScholarCacheBase } from './scholar.mjs';
export class ScholarCache extends ScholarCacheBase {
  constructor(ctx, env) { super(ctx, { ...env, SOURCE_FETCH: workerSourceFetch }); }
}
export default { fetch(request, env) {
  env = { ...env, PAGE_HTML: pageHTML, SOURCE_FETCH: workerSourceFetch };
  if (env.SCHOLAR_CACHE) {
    const scholar = env.SCHOLAR_CACHE.get(env.SCHOLAR_CACHE.idFromName('scholar-cache-v1'));
    env.SCHOLAR = { async execute(operation) {
      const response = await scholar.fetch('https://scholar.internal/', { method: 'POST', body: JSON.stringify(operation) });
      return response.json();
    } };
  }
  if (!env.VISITOR_QUOTA) return handleRequest(request, { ...env, PROFILE: profile });
  const stub = env.VISITOR_QUOTA.get(env.VISITOR_QUOTA.idFromName('daily-ledger-v1'));
  const LEDGER = { async execute(operation) {
    const response = await stub.fetch('https://quota.internal/', { method: 'POST', body: JSON.stringify(operation) });
    return response.json();
  } };
  return handleRequest(request, { ...env, PROFILE: profile, LEDGER });
} };
