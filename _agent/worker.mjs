import { handleRequest } from './core.mjs';
import profile, { pageHTML } from './profile.generated.mjs';
import { workerSourceFetch } from './source-fetch.mjs';
export { VisitorQuota } from './quota.mjs';
export default { fetch(request, env) {
  env = { ...env, PAGE_HTML: pageHTML, SOURCE_FETCH: workerSourceFetch };
  if (!env.VISITOR_QUOTA) return handleRequest(request, { ...env, PROFILE: profile });
  const stub = env.VISITOR_QUOTA.get(env.VISITOR_QUOTA.idFromName('daily-ledger-v1'));
  const LEDGER = { async execute(operation) {
    const response = await stub.fetch('https://quota.internal/', { method: 'POST', body: JSON.stringify(operation) });
    return response.json();
  } };
  return handleRequest(request, { ...env, PROFILE: profile, LEDGER });
} };
