import { handleRequest } from './core.mjs';
import profile, { pageHTML, profileVersion } from './profile.generated.mjs';
import { createProfileSource } from './profile-snapshot.mjs';
export { AgentContext } from './context-store.mjs';
import { workerSourceFetch } from './source-fetch.mjs';
export { VisitorQuota } from './quota.mjs';
import { ScholarCache as ScholarCacheBase } from './scholar.mjs';
export class ScholarCache extends ScholarCacheBase {
  constructor(ctx, env) { super(ctx, { ...env, SOURCE_FETCH: workerSourceFetch }); }
}
export class ProfileSnapshot {
  constructor(ctx) { this.source = createProfileSource(ctx.storage, { PROFILE: profile, PAGE_HTML: pageHTML, PROFILE_VERSION: profileVersion }); }
  async fetch(request) { return Response.json(await this.source.get(new URL(request.url).pathname === '/refresh')); }
}
export default { scheduled(_controller, env, ctx) {
  const source = env.PROFILE_SNAPSHOT.get(env.PROFILE_SNAPSHOT.idFromName('published-profile-v1'));
  ctx.waitUntil(source.fetch('https://profile.internal/refresh').then(response => response.arrayBuffer()));
}, fetch(request, env) {
  env = { ...env, PAGE_HTML: pageHTML, SOURCE_FETCH: workerSourceFetch };
  if (env.PROFILE_SNAPSHOT) {
    const source = env.PROFILE_SNAPSHOT.get(env.PROFILE_SNAPSHOT.idFromName('published-profile-v1'));
    env.PROFILE_SOURCE = { async get() { return (await source.fetch('https://profile.internal/')).json(); } };
  }
  if (env.AGENT_CONTEXT) {
    // Keep conversation/source data separate from the public profile and Scholar cache.
    const context = env.AGENT_CONTEXT.get(env.AGENT_CONTEXT.idFromName('conversation-context-v1'));
    const execute = async operation => {
      const result = await (await context.fetch('https://context.internal/', { method: 'POST', body: JSON.stringify(operation) })).json();
      if (!result.ok) throw new Error('Context unavailable.');
      return result;
    };
    env.CONTEXT_STORE = {
      async put(state, scope) { return (await execute({ type: 'put', state, scope })).ref; },
      async get(ref, scope) { return (await execute({ type: 'get', ref, scope })).state; }
    };
  }
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
