export const MEMORY_STEPS = 5;
const encoder = new TextEncoder();

// One conversation step is a complete user/assistant exchange.
export function recentHistory(history = []) {
  const recent = history.slice(-MEMORY_STEPS * 2);
  while (recent.length > 2 && encoder.encode(JSON.stringify(recent)).length > 48000) recent.splice(0, 2);
  return recent;
}

// Keep calls and results together, including the pending call at the end.
export function recentTools(messages) {
  const steps = [];
  for (const message of messages.slice(1)) {
    if (message.role === 'assistant') steps.push([message]);
    else if (message.role === 'tool' && steps.length) steps[steps.length - 1].push(message);
  }
  return [messages[0], ...steps.slice(-MEMORY_STEPS).flat()];
}

// Paper notes and linked-page excerpts expire with the exchanges that cited them; they must not become
// an unlimited second memory outside the conversation window.
export function recentDocuments(documents = {}, history = []) {
  const references = history.filter(message => message.role === 'assistant').map(message => message.content).join('\n');
  return Object.fromEntries(Object.entries(documents).filter(([id]) => references.includes(id)).slice(-6));
}
