(function (root) {
  'use strict';
  var parser = root.marked && new root.marked.Marked({
    gfm: true, breaks: true,
    renderer: { html: function () { return ''; } }
  });
  function render(container, markdown) {
    var text = root.cleanAgentAnswer(markdown);
    container.classList.remove('is-plain-text');
    if (!parser || !root.DOMPurify || !root.DOMPurify.isSupported) {
      container.textContent = text;
      container.classList.add('is-plain-text');
      return;
    }
    var fragment = root.DOMPurify.sanitize(parser.parse(text), {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
      ALLOWED_ATTR: ['href', 'title', 'start'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
    });
    fragment.querySelectorAll('a').forEach(function (link) {
      var href = link.getAttribute('href') || '';
      try {
        var url = new URL(href, location.href);
        if (!href || !['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) throw new Error();
        if (href.charAt(0) !== '#') { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      } catch (_) { link.replaceWith(document.createTextNode(link.textContent)); }
    });
    fragment.querySelectorAll('table').forEach(function (table) {
      var scroll = document.createElement('div'); scroll.className = 'page-agent-table';
      scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Answer table');
      table.replaceWith(scroll); scroll.appendChild(table);
    });
    container.replaceChildren(fragment);
  }

  function type(container, markdown, options) {
    options = options || {};
    render(container, markdown);
    // Parse and sanitize once, then reveal text nodes. Incomplete Markdown never
    // reaches the renderer, so links, tables and code blocks keep stable markup.
    if (options.reducedMotion || options.signal && options.signal.aborted || document.hidden) return Promise.resolve();
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    var segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    var entries = [], node, total = 0;
    while ((node = walker.nextNode())) {
      var letters = segmenter ? Array.from(segmenter.segment(node.data), function (part) { return part.segment; }) : Array.from(node.data);
      entries.push({ node: node, text: node.data, letters: letters, start: total }); total += letters.length;
    }
    if (!total) return Promise.resolve();
    var elements = Array.from(container.querySelectorAll('*'));
    elements.forEach(function (element) { element.hidden = true; });
    entries.forEach(function (entry) { entry.node.data = ''; });
    container.classList.add('is-typing'); container.setAttribute('aria-busy', 'true');
    var duration = Math.max(100, Math.min(1600, total / 900 * 1000));
    return new Promise(function (resolve) {
      var frame = 0, start = performance.now(), index = 0, done = false;
      function finish() {
        if (done) return;
        done = true; cancelAnimationFrame(frame);
        entries.forEach(function (entry) { entry.node.data = entry.text; });
        elements.forEach(function (element) { element.hidden = false; });
        container.classList.remove('is-typing'); container.setAttribute('aria-busy', 'false');
        if (options.signal) options.signal.removeEventListener('abort', finish);
        document.removeEventListener('visibilitychange', visibility);
        if (options.onProgress) options.onProgress();
        resolve();
      }
      function visibility() { if (document.hidden) finish(); }
      function tick(now) {
        var count = Math.min(total, Math.ceil(total * (now - start) / duration));
        while (index < entries.length && count > entries[index].start) {
          var entry = entries[index];
          var visible = Math.min(entry.letters.length, count - entry.start);
          entry.node.data = entry.letters.slice(0, visible).join('');
          for (var parent = entry.node.parentElement; parent && parent !== container; parent = parent.parentElement) parent.hidden = false;
          if (visible < entry.letters.length) break;
          index++;
        }
        if (count >= total) { finish(); return; }
        if (options.onProgress) options.onProgress();
        frame = requestAnimationFrame(tick);
      }
      if (options.signal) options.signal.addEventListener('abort', finish, { once: true });
      document.addEventListener('visibilitychange', visibility);
      frame = requestAnimationFrame(tick);
    });
  }
  root.agentOutput = { render: render, type: type };
})(window);
