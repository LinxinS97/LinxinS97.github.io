export const MEMORY_STEPS = 5;
export const TURN_DOCUMENT_LIMIT = 32; // Current tool-step bound plus up to six retained prior sources.
const encoder = new TextEncoder();

// Keep all sources from this turn available for comparison, with a fixed text budget.
export function turnDocuments(documents) {
  const entries = Object.entries(documents).slice(-TURN_DOCUMENT_LIMIT);
  const perDocumentBytes = Math.floor(96000 / Math.max(1, entries.length));
  return Object.fromEntries(entries.map(([id, document]) => {
    const bytes = encoder.encode(document.notes || '');
    if (bytes.length <= perDocumentBytes) return [id, document];
    const notes = new TextDecoder().decode(bytes.slice(0, perDocumentBytes), { stream: true });
    return [id, { ...document, notes, truncated: true }];
  }));
}

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
  const recent = steps.slice(-MEMORY_STEPS);
  while (recent.length > 1 && encoder.encode(JSON.stringify(recent)).length > 128000) recent.shift();
  return [messages[0], ...recent.flat()];
}

// Paper notes and linked-page excerpts expire with the exchanges that cited them; they must not become
// an unlimited second memory outside the conversation window.
export function recentDocuments(documents = {}, history = []) {
  const references = history.filter(message => message.role === 'assistant').map(message => message.content).join('\n');
  return Object.fromEntries(Object.entries(documents).filter(([id]) => references.includes(id)).slice(-6));
}
