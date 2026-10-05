(function (root) {
  'use strict';
  // Shared SSE framing for provider and browser streams, including split UTF-8/CRLF.
  async function* events(body) {
    if (!body) throw new Error('Missing stream body.');
    var reader = body.getReader(), decoder = new TextDecoder(), buffer = '', data = [], size = 0;
    try {
      while (true) {
        var chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        if (buffer.length > 1000000) throw new Error('Stream frame too large.');
        var newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          var line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (!line) {
            if (data.length) yield data.join('\n');
            data = []; size = 0;
          } else if (line.startsWith('data:')) {
            var value = line.slice(5).replace(/^ /, '');
            size += value.length;
            if (size > 1000000) throw new Error('Stream frame too large.');
            data.push(value);
          }
        }
        if (chunk.done) break;
      }
      if (buffer.trim() || data.length) throw new Error('Incomplete stream frame.');
    } finally { await reader.cancel().catch(function () {}); reader.releaseLock(); }
  }
  var api = { events: events };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.agentStream = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
