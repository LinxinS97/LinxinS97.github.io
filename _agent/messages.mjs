export const MESSAGE_LIMIT = 2;
export class MessageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const emailPattern = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
export function messageReady(env) {
  const from = (env.MESSAGE_FROM || '').match(/^(?:[^<>\r\n]+ <)?([^<>\r\n]+)>?$/)?.[1];
  return Boolean(env.RESEND_API_KEY && from && emailPattern.test(from) && emailPattern.test(env.MESSAGE_TO || '') && !/[\r\n]/.test(env.MESSAGE_FROM));
}
export function validateMessage(input) {
  const limits = { name: 100, email: 254, subject: 120, message: 5000 };
  const draft = {};
  for (const [key, limit] of Object.entries(limits)) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || (key !== 'message' && /[\r\n]/.test(value))) throw new MessageError(400, 'Please check the message fields and their length.');
    draft[key] = value.trim();
  }
  if (!draft.message) throw new MessageError(400, 'Please write a message for Linxin.');
  if (draft.email && !emailPattern.test(draft.email)) throw new MessageError(400, 'Please enter a valid reply-to email, or leave it blank.');
  draft.subject ||= 'Website visitor message';
  return draft;
}
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function sendVisitorMessage(input, env, fetcher = fetch) {
  if (!messageReady(env)) throw new MessageError(503, 'Email delivery is not connected yet. Please try again later.');
  if (!env.MESSAGE_LEDGER) throw new MessageError(503, 'Message quota storage is unavailable.');
  if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) throw new MessageError(400, 'Invalid message request.');
  const draft = validateMessage(input);
  // The recipient and sender are server configuration, never tool/client arguments.
  const payload = { from: env.MESSAGE_FROM, to: [env.MESSAGE_TO], subject: '[Website message] ' + draft.subject,
    text: 'A visitor left a message through Linxin’s personal agent.\n\nName (visitor supplied): ' + (draft.name || 'Not provided') +
      '\nReply-to (visitor supplied, unverified): ' + (draft.email || 'Not provided') + '\n\n' + draft.message,
    ...(draft.email ? { reply_to: draft.email } : {}) };
  const hash = await digest(JSON.stringify(payload));
  const operation = { id: input.requestId, hash };
  const reservation = await env.MESSAGE_LEDGER('message_reserve', operation);
  if (reservation.state === 'sent') return { sent: true, messageQuota: reservation.messageQuota };
  if (reservation.state === 'pending') return { sent: false, pending: true, messageQuota: reservation.messageQuota };
  const idempotency = 'visitor-message/' + await digest(env.VISITOR_ID + '/' + input.requestId);
  let response;
  try {
    response = await fetcher('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': idempotency }, body: JSON.stringify(payload) });
  } catch {
    // The provider may have accepted the email. Keep its reservation and retry the SAME key.
    return { sent: false, pending: true, messageQuota: reservation.messageQuota };
  }
  if (!response.ok) {
    if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
      await env.MESSAGE_LEDGER('message_release', operation);
      throw new MessageError(502, 'Email could not be submitted. Your message allowance was restored; please retry later.');
    }
    return { sent: false, pending: true, messageQuota: reservation.messageQuota };
  }
  const data = await response.json().catch(() => null);
  if (!data?.id || typeof data.id !== 'string') return { sent: false, pending: true, messageQuota: reservation.messageQuota };
  const completed = await env.MESSAGE_LEDGER('message_complete', operation);
  return { sent: true, messageQuota: completed.messageQuota };
}
