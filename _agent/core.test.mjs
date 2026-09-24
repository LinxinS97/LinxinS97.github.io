import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, handleRequest } from './core.mjs';

const origin = 'http://127.0.0.1:4000';
const env = { OPENROUTER_API_KEY: 'test-only-placeholder', OPENROUTER_BASE_URL: 'https://model.invalid/v1',
  VISITOR_HASH_SECRET: 'test-hash-secret', LEDGER: { execute: async () => ({ ok: true, quota: { remaining: 9, limit: 10 } }) },
  ALLOWED_ORIGINS: origin, PROFILE: 'Linxin Song is advised by Jieyu Zhao and Yue Wang.',
  RATE_LIMITER: { limit: async () => ({ success: true }) }, GLOBAL_LIMITER: { limit: async () => ({ success: true }) } };
function provider(calls) {
  let index = 0;
  return async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'openai/gpt-6-luna');
    assert.equal(body.reasoning.effort, 'medium');
    assert.ok(!options.body.includes(env.OPENROUTER_API_KEY));
    const [name, args] = calls[index++] || [];
    assert.ok(name, 'No unexpected model calls');
    return Response.json({ choices: [{ message: { tool_calls: [{ id: 'call_' + index, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  };
}
test('unrelated requests stop before any page action', async () => {
  const result = await runAgent({ question: 'Write a sorting algorithm' }, env, origin, provider([['check_scope', { allowed: false }]]));
  assert.equal(result.type, 'refusal');
  assert.ok(!result.state);
});
test('real tool loop requires observed evidence and emits only cited final output', async () => {
  const fetcher = provider([
    ['check_scope', { allowed: true }], ['observe_page', {}], ['read_context', { section: 'about-me' }],
    ['answer_profile', { answer: 'His advisors are Jieyu Zhao and Yue Wang.', sources: ['about-me'] }]
  ]);
  let result = await runAgent({ question: 'His advisors?' }, env, origin, fetcher);
  assert.equal(result.action.name, 'observe_page');
  result = await runAgent({ state: result.state, result: { ok: true, text: 'about-me' } }, env, origin, fetcher);
  assert.equal(result.action.args.section, 'about-me');
  result = await runAgent({ state: result.state, result: { ok: true, text: env.PROFILE } }, env, origin, fetcher);
  assert.equal(result.type, 'answer');
  assert.equal(result.sources[0].id, 'about-me');
  assert.ok(!JSON.stringify(result).includes(env.OPENROUTER_API_KEY));
});
test('forged continuation and cross-origin replay cannot call the model', async () => {
  const fetcher = provider([['check_scope', { allowed: true }], ['observe_page', {}]]);
  const result = await runAgent({ question: 'His advisors?' }, env, origin, fetcher);
  const never = () => assert.fail('Model must not be called');
  await assert.rejects(runAgent({ state: 'bad.' + result.state, result: { ok: true, text: 'hi' } }, env, origin, never), /invalid/);
  await assert.rejects(runAgent({ state: result.state, result: { ok: true, text: 'hi' } }, env, 'https://attacker.invalid', never), /invalid/);
});
test('arbitrary navigation and code tools are blocked server-side', async () => {
  for (const tool of [['read_context', { section: 'https://attacker.invalid' }], ['execute_javascript', { code: 'alert(1)' }]]) {
    const fetcher = provider([['check_scope', { allowed: true }], ['observe_page', {}], tool]);
    const initial = await runAgent({ question: 'His papers?' }, env, origin, fetcher);
    await assert.rejects(runAgent({ state: initial.state, result: { ok: true, text: 'index' } }, env, origin, fetcher), /blocked/);
  }
});
test('answer without focused evidence is rejected', async () => {
  const fetcher = provider([['check_scope', { allowed: true }], ['observe_page', {}], ['answer_profile', { answer: 'Invented.', sources: ['about-me'] }]]);
  const initial = await runAgent({ question: 'His advisors?' }, env, origin, fetcher);
  const result = await runAgent({ state: initial.state, result: { ok: true, text: 'index' } }, env, origin, fetcher);
  assert.ok(result.answer.includes('not sufficient'));
  assert.ok(!result.answer.includes('Invented'));
  assert.deepEqual(result.sources, []);
});
test('API rejects foreign origins, oversized input and rate excess before inference', async () => {
  const never = () => assert.fail('No model call expected');
  let response = await handleRequest(new Request('https://proxy.invalid/api/health', { headers: { Origin: 'https://attacker.invalid' } }), env, never);
  assert.equal(response.status, 403);
  response = await handleRequest(new Request('https://proxy.invalid/api/agent', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'x'.repeat(500001) }), env, never);
  assert.equal(response.status, 413);
  response = await handleRequest(new Request('https://proxy.invalid/api/agent', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' }), { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } }, never);
  assert.equal(response.status, 429);
});
test('provider errors never reflect upstream bodies or secrets', async () => {
  const response = await handleRequest(new Request('https://proxy.invalid/api/agent', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Visitor-Ids': crypto.randomUUID(), 'CF-Connecting-IP': '192.0.2.1' }, body: '{"question":"His advisors?"}' }), env,
    async () => new Response(env.OPENROUTER_API_KEY, { status: 401 }));
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(env.OPENROUTER_API_KEY));
});

test('health checks are limited before storage and never disclose credentials', async () => {
  const headers = { Origin: origin, 'X-Visitor-Ids': crypto.randomUUID(), 'CF-Connecting-IP': '192.0.2.1' };
  const blocked = await handleRequest(new Request('https://proxy.invalid/api/health', {headers}), {
    ...env, RATE_LIMITER: {limit: async()=>({success:false})}, LEDGER: {execute:()=>assert.fail('No storage on denied health check')}
  });
  assert.equal(blocked.status,429);
  assert.equal(blocked.headers.get('Cache-Control'),'no-store');
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'),origin);
  assert.ok(!(await blocked.text()).includes(env.OPENROUTER_API_KEY));
});
