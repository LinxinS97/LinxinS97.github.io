import { MESSAGE_LIMIT } from './messages.mjs';

// Called inside the same SQLite / Durable Object transaction as question quota.
export async function messageLedger(tx, operation, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const resetAt = new Date(Math.floor(now / 86400000) * 86400000 + 86400000).toISOString();
  const keys = [...new Set(operation.keys || [])];
  if (keys.length < 2 || keys.length > 3 || keys.some(key => !/^[a-f0-9]{64}$/.test(key))) throw new Error('Invalid message identity.');
  const today = await tx.get('quota:' + day) || { counts: {}, requests: {}, steps: {} };
  today.messageCounts ||= {}; today.messages ||= {};
  const quota = () => ({ limit: MESSAGE_LIMIT, remaining: Math.max(0, MESSAGE_LIMIT - Math.max(...keys.map(key => today.messageCounts[key] || 0))), resetAt });
  const done = (extra = {}) => ({ ok: true, messageQuota: quota(), ...extra });
  if (operation.type === 'message_status') return done();
  if (!/^[a-f0-9-]{36}$/i.test(operation.id || '') || !/^[a-f0-9]{64}$/.test(operation.hash || '')) throw new Error('Invalid message operation.');
  const requestKey = keys[1] + ':' + operation.id;
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
  const previous = await tx.get('quota:' + yesterday);
  let record = today.messages[requestKey] || previous?.messages?.[requestKey];
  let owner = today.messages[requestKey] ? today : record ? previous : today;
  let ownerDay = owner === today ? day : yesterday;
  if (record && record.hash !== operation.hash) return { ok: false, status: 409, error: 'This message changed after submission. Restore the original message or start a new one.', messageQuota: quota() };
  if (operation.type === 'message_reserve') {
    if (record?.state === 'sent') return done({ state: 'sent' });
    if (record?.state === 'sending') {
      if (now - record.created >= 23 * 60 * 60 * 1000) return { ok: false, status: 409, error: 'This delivery could not be confirmed. Do not resend automatically; contact Linxin directly.', messageQuota: quota() };
      if (record.lease > now) return done({ state: 'pending' });
      record.lease = now + 30000;
      await tx.put('quota:' + ownerDay, owner);
      return done({ state: 'reserved' });
    }
    if (!quota().remaining) return { ok: false, status: 429, error: 'Daily message limit reached (2 messages). Please return after the reset.', messageQuota: quota() };
    // A failed prior attempt is a new reservation on today's quota, with the same provider key.
    owner = today; ownerDay = day;
    for (const key of keys) today.messageCounts[key] = (today.messageCounts[key] || 0) + 1;
    record = { hash: operation.hash, state: 'sending', created: now, lease: now + 30000, keys };
    today.messages[requestKey] = record;
  } else {
    if (!record) throw new Error('Message reservation missing.');
    if (operation.type === 'message_complete') record.state = 'sent';
    else if (operation.type === 'message_release' && record.state === 'sending') {
      record.state = 'failed';
      for (const key of record.keys) owner.messageCounts[key] = Math.max(0, (owner.messageCounts[key] || 0) - 1);
    } else if (operation.type !== 'message_release') throw new Error('Invalid message operation.');
  }
  await tx.put('quota:' + ownerDay, owner);
  return done({ state: record.state === 'sent' ? 'sent' : 'reserved' });
}
