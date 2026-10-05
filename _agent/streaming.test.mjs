import test from 'node:test';
import assert from 'node:assert/strict';
import stream from '../assets/js/agent-stream.js';
import { partialString, readModelStream } from './model-stream.mjs';
import { modelRequest } from './model-request.mjs';
import { handleRequest } from './core.mjs';

const encoder = new TextEncoder();
const origin = 'http://127.0.0.1:4000';
const env = { OPENROUTER_API_KEY: 'secret-test-key', OPENROUTER_BASE_URL: 'https://model.invalid/v1',
  VISITOR_HASH_SECRET: 'hash-secret', ALLOWED_ORIGINS: origin, PROFILE: '# About Me\nLinxin Song studies agents.',
  LEDGER: { execute: async () => ({ ok: true, quota: { remaining: 19, limit: 20 } }) },
  RATE_LIMITER: { limit: async () => ({ success: true }) }, GLOBAL_LIMITER: { limit: async () => ({ success: true }) } };
function sse(text, split = 7) {
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const frame = data => 'data: ' + JSON.stringify(data) + '\r\n\r\n';
function toolStream(name, args, truncated = false) {
  const argumentsText = JSON.stringify(args);
  let text = ': OPENROUTER PROCESSING\r\n\r\n';
  text += frame({ choices: [{ index: 0, delta: { reasoning: 'PRIVATE REASONING', tool_calls: [{ index: 0, id: 'call_test', function: { name, arguments: '' } }] } }] });
  for (let i = 0; i < argumentsText.length; i += 3) text += frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argumentsText.slice(i, i + 3) } }] } }] });
  if (!truncated) text += frame({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + frame({ choices: [], usage: {} }) + 'data: [DONE]\r\n\r\n';
  return sse(text);
}

test('SSE frames survive split UTF-8, CRLF, comments and multiline data', async () => {
  const response = sse(': heartbeat\r\n\r\ndata: 你好\r\ndata: world\r\n\r\ndata: [DONE]\r\n\r\n', 1);
  assert.deepEqual(await Array.fromAsync(stream.events(response.body)), ['你好\nworld', '[DONE]']);
  await assert.rejects(Array.fromAsync(stream.events(sse('data: {').body)), /Incomplete/);
});

test('partial JSON only returns top-level answer prose and decodes escaped text', () => {
  assert.equal(partialString('{"sources":["about-me"],"answer":"你好\\nworld\\u0021', 'answer'), '你好\nworld!');
  assert.equal(partialString('{"answer":"hello\\u00', 'answer'), 'hello');
  assert.equal(partialString('{"answer":"hi\\"there\\\\', 'answer'), 'hi"there\\');
  assert.equal(partialString('{"nested":{"answer":"secret"},"answer":"public', 'answer'), 'public');
  assert.equal(partialString('{"answer":"\\ud83d', 'answer'), '');
});

test('provider tool deltas reconstruct validated arguments without forwarding reasoning', async () => {
  const updates = [];
  const body = await readModelStream(toolStream('answer_profile', { answer: 'Hello 你好!', sources: ['about-me'] }), message => updates.push(JSON.stringify(message)));
  assert.deepEqual(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments), { answer: 'Hello 你好!', sources: ['about-me'] });
  assert.ok(updates.length > 3);
  assert.ok(!updates.join('').includes('PRIVATE REASONING'));
  await assert.rejects(readModelStream(toolStream('answer_profile', { answer: 'partial' }, true), () => {}), /ended early/);
  await assert.rejects(readModelStream(sse(frame({ error: { message: 'private error' } })), () => {}), /stream failed/);
});

test('broken streams retry generation only; attempts reset drafts and errors stay sanitized', async () => {
  let attempts = 0, resets = 0;
  const result = await modelRequest(env, {}, async (_, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return toolStream('answer_profile', { answer: ++attempts === 1 ? 'old draft' : 'new draft' }, attempts === 1);
  }, { onDelta() {}, onAttempt() { resets++; }, sleep: async () => {} });
  assert.equal(attempts, 2); assert.equal(resets, 2);
  assert.match(result.choices[0].message.tool_calls[0].function.arguments, /new draft/);
  await assert.rejects(modelRequest(env, {}, async () => sse(frame({ error: { message: env.OPENROUTER_API_KEY } })), { onDelta() {}, attempts: 1 }), error => !error.message.includes(env.OPENROUTER_API_KEY));
});

test('abort propagates to provider and never retries a cancelled request', async () => {
  const abort = new AbortController(); let attempts = 0;
  const request = modelRequest(env, {}, async (_, options) => {
    attempts++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  }, { onDelta() {}, signal: abort.signal });
  abort.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(attempts, 1);
});

test('SSE endpoint sends live answer deltas, then authoritative citations and memory, with unchanged quota admission', async () => {
  let stage = 0, reservations = 0;
  const testEnv = { ...env, LEDGER: { execute: async operation => {
    if (operation.type === 'reserve') reservations++;
    return { ok: true, quota: { remaining: 19, limit: 20 } };
  } } };
  const updates = ['MODEL_UPDATE_1: I’ll look for the relevant profile section.', 'MODEL_UPDATE_2: I’ll read his biography to check the research details.', 'MODEL_UPDATE_3: I’ll summarize the research described in his biography.'];
  const calls = [ ['check_scope', { allowed: true }], ['observe_page', { progress: updates[0] }], ['read_context', { progress: updates[1], section: 'about-me' }],
    ['answer_profile', { progress: updates[2], answer: 'Linxin studies agents.', sources: ['about-me'], paper_sources: [], link_sources: [] }] ];
  const provider = async (_, options) => {
    const [name, args] = calls[stage++];
    const body = JSON.parse(options.body);
    if (name !== 'check_scope') {
      assert.equal(body.stream, true);
      assert.equal(Object.keys(body.tools[0].function.parameters.properties)[0], 'progress');
      assert.ok(body.tools.every(tool => tool.function.parameters.required.includes('progress')));
      assert.ok(!JSON.stringify(body.messages).includes('MODEL_UPDATE_'), 'public progress must not become memory or evidence');
    }
    return body.stream ? toolStream(name, args) : Response.json({ choices: [{ message: { tool_calls: [{ id: 'gate', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  };
  let input = { question: 'What is his research?', requestId: crypto.randomUUID() };
  let final;
  for (let round = 0; round < 3; round++) {
    const response = await handleRequest(new Request('https://proxy.invalid/api/agent', { method: 'POST',
      headers: { Origin: origin, Accept: 'text/event-stream', 'Content-Type': 'application/json', 'X-Visitor-Ids': '00000000-0000-4000-8000-000000000001', 'CF-Connecting-IP': '203.0.113.1' }, body: JSON.stringify(input) }), testEnv, provider);
    assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
    const events = (await Array.fromAsync(stream.events(response.body))).map(JSON.parse);
    assert.ok(!JSON.stringify(events).includes('PRIVATE REASONING'));
    const progress = events.filter(item => item.type === 'progress');
    assert.ok(progress.length > 1, 'model progress must arrive incrementally');
    assert.equal(progress.at(-1).text, updates[round], 'UI text comes verbatim from the model progress field');
    const result = events.at(-1).result;
    assert.ok(result, JSON.stringify(events));
    if (result.type === 'action') {
      assert.equal(events.filter(item => item.type === 'delta').length, 0);
      input = { state: result.state, result: { ok: true, text: 'observed' } };
    } else {
      assert.equal(events.filter(item => item.type === 'delta').map(item => item.text).join(''), result.answer);
      assert.ok(events.findIndex(item => item.type === 'delta') < events.length - 1);
      assert.ok(events.findIndex(item => item.type === 'progress') < events.findIndex(item => item.type === 'delta'));
      final = result;
    }
  }
  assert.equal(final.answer, 'Linxin studies agents.');
  assert.equal(final.sources[0].id, 'about-me');
  assert.ok(final.conversation); assert.equal(reservations, 1);
});
