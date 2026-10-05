import stream from '../assets/js/agent-stream.js';

export async function readModelStream(response, onDelta) {
  const message = { role: 'assistant', content: null, tool_calls: [] };
  let done = false, finished = false, size = 0;
  for await (const event of stream.events(response.body)) {
    if (event === '[DONE]') { done = true; break; }
    size += event.length;
    if (size > 2000000) throw new Error('Model stream exceeded limit.');
    const chunk = JSON.parse(event);
    if (chunk.error) throw new Error('Model stream failed.');
    const choice = chunk.choices?.find(choice => (choice.index || 0) === 0);
    if (!choice) continue; // Accounting frames may have no choices.
    if (choice.finish_reason) {
      if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw new Error('Incomplete model output.');
      finished = true;
    }
    const delta = choice.delta || {};
    for (const part of delta.tool_calls || []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index > 3) throw new Error('Invalid streamed tool index.');
      const call = message.tool_calls[part.index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (part.id) call.id += part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
    // Never forward reasoning, provider metadata, or arbitrary tool arguments.
    onDelta(message);
  }
  if (!done || !finished) throw new Error('Model stream ended early.');
  return { choices: [{ message }] };
}

// Decode only a top-level string field, without evaluating incomplete JSON.
export function partialString(json, field) {
  let depth = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (char === '{' || char === '[') { depth++; continue; }
    if (char === '}' || char === ']') { depth--; continue; }
    if (char !== '"') continue;
    const start = i++;
    for (; i < json.length; i++) {
      if (json[i] === '\\') { i++; continue; }
      if (json[i] === '"') break;
    }
    if (i >= json.length) return '';
    if (depth !== 1 || JSON.parse(json.slice(start, i + 1)) !== field) continue;
    const rest = json.slice(i + 1).match(/^\s*:\s*"/);
    if (!rest) continue;
    let value = '', offset = i + 1 + rest[0].length;
    for (; offset < json.length; offset++) {
      const letter = json[offset];
      if (letter === '"') return value;
      if (letter !== '\\') { value += letter; continue; }
      if (++offset >= json.length) break;
      const escape = json[offset];
      if (escape === 'u') {
        const hex = json.slice(offset + 1, offset + 5);
        if (!/^[0-9a-f]{4}$/i.test(hex)) break;
        value += String.fromCharCode(parseInt(hex, 16)); offset += 4;
      } else {
        const escapes = { '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        if (!(escape in escapes)) break;
        value += escapes[escape];
      }
    }
    return value.replace(/[\uD800-\uDBFF]$/, '');
  }
  return '';
}
