const encoder = new TextEncoder();
import { messageLedger } from './message-quota.mjs';
export const DAILY_LIMIT = 20;
export const SITE_DAILY_LIMIT = 1000;
export function quotaWindow(now = Date.now()) {
  return { day: new Date(now).toISOString().slice(0, 10), resetAt: new Date(Math.floor(now / 86400000) * 86400000 + 86400000).toISOString() };
}
export async function visitorKeys(secret, ip, browserIds) {
  if (!secret || !ip) throw new Error('Visitor identity is not configured.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = async value => Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
  return Promise.all(['ip:' + ip, ...browserIds.map(id => 'browser:' + id)].map(digest));
}
// The same transaction code runs against local SQLite and a Durable Object.
export async function ledgerOperation(storage, operation, now = Date.now()) {
  const window = quotaWindow(now);
  return storage.transaction(async tx => {
    if (operation.type.startsWith('message_')) return messageLedger(tx, operation, now);
    const storeKey = 'quota:' + window.day;
    const data = await tx.get(storeKey) || { counts: {}, requests: {}, steps: {} };
    const keys = [...new Set(operation.keys || [])];
    if (keys.length < 2 || keys.length > 3 || keys.some(key => !/^[a-f0-9]{64}$/.test(key))) throw new Error('Invalid quota identity.');
    for (const group of [data.requests, data.steps]) for (const [key, expires] of Object.entries(group)) if (expires < now) delete group[key];
    const quota = () => ({ limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - Math.max(...keys.map(key => data.counts[key] || 0))), resetAt: window.resetAt });
    if (operation.type === 'reserve') {
      const id = operation.id;
      if (typeof id !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(id)) throw new Error('Invalid request identity.');
      // Duplicate initial requests never invoke the model a second time.
      const requestKey = keys[1] + ':' + id;
      if (data.requests[requestKey]) return { ok: false, status: 409, error: 'This question was already submitted. Please wait for its response.', quota: quota() };
      if (quota().remaining <= 0) return { ok: false, status: 429, error: `Daily limit reached (${DAILY_LIMIT} questions). Please come back after the reset.`, quota: quota() };
      // One shared Durable Object enforces this across all IPs and Cloudflare locations.
      // Initialize from existing reservations when upgrading a live ledger.
      data.totalQuestions ??= Object.keys(data.requests).length;
      if (data.totalQuestions >= SITE_DAILY_LIMIT) return { ok: false, status: 429, error: 'The site has reached its daily question limit. Please come back after 00:00 UTC.', quota: quota() };
      data.totalQuestions++;
      for (const key of keys) data.counts[key] = (data.counts[key] || 0) + 1;
      data.requests[requestKey] = Date.parse(window.resetAt);
    } else if (operation.type === 'step') {
      if (typeof operation.id !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(operation.id)) throw new Error('Invalid step identity.');
      const previous = await tx.get('quota:' + quotaWindow(now - 86400000).day);
      if (data.steps[operation.id] || previous?.steps?.[operation.id] > now) return { ok: false, status: 409, error: 'This page action was already processed. Please ask again.', quota: quota() };
      data.steps[operation.id] = now + 20 * 60 * 1000;
    } else if (operation.type !== 'status') throw new Error('Invalid ledger operation.');
    await tx.put(storeKey, data);
    return { ok: true, quota: quota() };
  });
}

export class VisitorQuota {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    try {
      const result = await ledgerOperation(this.ctx.storage, await request.json());
      if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 86400000);
      return Response.json(result);
    } catch { return Response.json({ ok: false, status: 503, error: 'Quota storage is unavailable.' }); }
  }
  async alarm() {
    const cutoff = quotaWindow(Date.now() - 86400000).day;
    const rows = await this.ctx.storage.list({ prefix: 'quota:' });
    for (const key of rows.keys()) if (key.slice(6) < cutoff) await this.ctx.storage.delete(key);
    if ([...rows.keys()].some(key => key.slice(6) >= cutoff)) await this.ctx.storage.setAlarm(Date.now() + 86400000);
  }
}
