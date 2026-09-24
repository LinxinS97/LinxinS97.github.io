const chinese = question => /[\u3400-\u9fff]/.test(question);
const escapeMarkdown = value => value.replace(/([\\`*_{}\[\]()#+.!>|~-])/g, '\\$1');
export const isSendConfirmation = question => /^(?:yes(?:[,， ]+(?:please|send(?: it)?|confirm(?:ed)?))?|confirm(?:ed)?(?:[, ]+(?:please )?send(?: it)?)?|send(?: it)?|确认(?:并)?(?:发送|提交)?|确认无误(?:[，, ]*请)?发送|是的(?:[，, ]*请)?发送|可以发送|发送|提交)[.!。！\s]*$/i.test(question.trim());
export function missingContactReply(question) {
  return chinese(question)
    ? '请先提供你的姓名／身份、有效的回复邮箱，以及想给 Linxin 留下的内容。我会把这些信息列出来，请你确认后再发送。每位访客每天最多发送 2 条留言。'
    : 'Please provide your name/identity, a valid reply-to email, and your message for Linxin. I will show these details for your confirmation before sending. Each visitor can send at most 2 messages per day.';
}
export function confirmationReply(draft, question) {
  const { name, email, message } = Object.fromEntries(['name', 'email', 'message'].map(key => [key, escapeMarkdown(draft[key])]));
  return chinese(question)
    ? `发送前请确认：\n\n- 姓名／身份：${name}\n- 回复邮箱：${email}\n\n留言内容：\n\n${message}\n\n信息无误请回复“确认发送”；需要修改请直接告诉我。目前尚未发送。每位访客每天最多发送 2 条留言。`
    : `Please confirm before sending:\n\n- Name/identity: ${name}\n- Reply-to email: ${email}\n\nMessage:\n\n${message}\n\nReply “confirm send” if these details are correct, or tell me what to change. Nothing has been sent yet. Each visitor can send at most 2 messages per day.`;
}
export function deliveryReceipts(question) {
  return chinese(question) ? {
    sent_reply: '留言已提交给邮件服务。每天最多发送 2 条留言，今天还剩 {remaining} 条。',
    pending_reply: '暂时无法确认发送结果。请在 30 秒后通过本对话查询，不要重复提交。每天最多发送 2 条留言。',
    failed_reply: '留言未提交成功，今天还剩 {remaining} 条。每天最多发送 2 条留言。'
  } : {
    sent_reply: 'Submitted for email delivery. Maximum 2 messages per day; {remaining} remaining.',
    pending_reply: 'Delivery unconfirmed. Check again in this chat after 30 seconds; do not submit a duplicate. Maximum 2 messages per day.',
    failed_reply: 'Not submitted. Maximum 2 messages per day; {remaining} remaining.'
  };
}
