(function () {
  'use strict';
  var root = document.querySelector('.page-agent');
  if (!root) return;
  var content = document.querySelector('.page__content');
  var status = root.querySelector('.page-agent-status');
  var form = root.querySelector('form');
  var input = form.querySelector('textarea');
  var submit = root.querySelector('.page-agent-send');
  var stop = root.querySelector('.page-agent-stop');
  var session = root.querySelector('.page-agent-session');
  var trace = root.querySelector('.page-agent-trace');
  var answer = root.querySelector('.page-agent-answer');
  var sources = root.querySelector('.page-agent-sources');
  var returnButton = root.querySelector('.page-agent-return');
  var minimizeButton = root.querySelector('.page-agent-minimize');
  var historyElement = root.querySelector('.page-agent-history');
  var currentTurn = root.querySelector('.page-agent-current');
  var newChat = root.querySelector('.page-agent-new-chat');
  var quotaElement = root.querySelector('.page-agent-quota');
  var quotaState = null;
  var resetTimer;
  var conversation = '';
  var displayHistory = [];
  var storedVisitor = '';
  var cookieVisitor = '';
  var visitorPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  try { storedVisitor = localStorage.getItem('linxin-agent-visitor') || ''; } catch (_) {}
  try { cookieVisitor = (document.cookie.match(/(?:^|; )linxin_agent_visitor=([^;]+)/) || [])[1] || ''; } catch (_) {}
  if (!visitorPattern.test(storedVisitor)) storedVisitor = '';
  if (!visitorPattern.test(cookieVisitor)) cookieVisitor = '';
  var visitorId = storedVisitor || cookieVisitor || crypto.randomUUID();
  try { localStorage.setItem('linxin-agent-visitor', visitorId); } catch (_) {}
  if (!cookieVisitor) { try { document.cookie = 'linxin_agent_visitor=' + visitorId + '; Max-Age=31536000; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); } catch (_) {} }
  var visitorIds = Array.from(new Set([visitorId, cookieVisitor].filter(Boolean))).join(',');
  try {
    var saved = JSON.parse(sessionStorage.getItem('linxin-agent-conversation') || 'null');
    if (saved && typeof saved.token === 'string' && Array.isArray(saved.turns)) { conversation = saved.token; displayHistory = saved.turns.slice(-20); }
  } catch (_) {}
  var endpoint = root.dataset.endpoint.replace(/\/+$/, '');
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) endpoint = location.protocol + '//' + location.hostname + ':4100';
  var pendingDelivery = '';
  try { pendingDelivery = sessionStorage.getItem('linxin-agent-pending-delivery') || ''; } catch (_) {}
  function saveDelivery(value) {
    pendingDelivery = value || '';
    try { if (pendingDelivery) sessionStorage.setItem('linxin-agent-pending-delivery', pendingDelivery); else sessionStorage.removeItem('linxin-agent-pending-delivery'); } catch (_) {}
  }
  var activeController = null;
  var ready = false;
  var hasSession = false;
  var targets = new Map();
  var listedLinks = new Set();
  document.querySelectorAll('a[href]').forEach(function (link) {
    if (root.contains(link)) return;
    try {
      var url = new URL(link.href);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
      url.hash = ''; listedLinks.add(url.href);
    } catch (_) {}
  });
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var cursor = document.createElement('div');
  cursor.className = 'page-agent-pointer';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.hidden = true;
  cursor.textContent = '↖ AGENT';
  document.body.appendChild(cursor);
  var pointerTarget = null;
  var pointerFrame = 0;
  function clearPointer() {
    pointerTarget = null;
    cursor.hidden = true;
  }
  function updatePointer() {
    pointerFrame = 0;
    if (!pointerTarget || !pointerTarget.isConnected || root.classList.contains('is-minimized')) {
      cursor.hidden = true;
      return;
    }
    var chapter = pointerTarget.closest('details');
    var bounds = pointerTarget.getBoundingClientRect();
    // Follow the evidence, never pin an offscreen target to the viewport edge.
    if ((chapter && !chapter.open) || !bounds.height || bounds.bottom <= 0 || bounds.top >= innerHeight || bounds.right <= 0 || bounds.left >= innerWidth) {
      cursor.hidden = true;
      return;
    }
    cursor.hidden = false;
    cursor.style.left = Math.max(6, Math.min(bounds.right - cursor.offsetWidth - 8, document.documentElement.clientWidth - cursor.offsetWidth - 6)) + 'px';
    cursor.style.top = (bounds.top + 8) + 'px';
  }
  function schedulePointer() {
    if (!pointerFrame) pointerFrame = requestAnimationFrame(updatePointer);
  }
  // Index known public sections only; never serialize chat, forms, storage or scripts.
  var sectionNames = {
    'about-me': 'Biography & contact', 'research-interests': 'Research interests',
    'post-training': 'Post-training publications', 'agentic-ai': 'Agentic AI publications',
    'language-model-evaluation': 'Language model evaluation', 'before-phd': 'Earlier publications',
    teaching: 'Teaching', internships: 'Internships', 'professional-services': 'Professional services'
  };
  function indexSections() {
    targets.clear();
    Object.keys(sectionNames).forEach(function (id) {
      var nodes = [];
      {
        var heading = document.getElementById(id);
        if (!heading || !content.contains(heading)) return;
        nodes.push(heading);
        var next = heading.nextElementSibling;
        while (next && !/^H[1-3]$/.test(next.tagName)) {
          if (!next.matches('script, style, .page-agent')) nodes.push(next);
          next = next.nextElementSibling;
        }
      }
      if (nodes.length) targets.set(id, { title: sectionNames[id], nodes: nodes });
    });
  }
  function sectionText(target) { return target.nodes.map(function (node) { return node.textContent; }).join('\n').trim().slice(0, 12000); }
  function announce(text, state) { status.textContent = text; root.dataset.state = state || 'ready'; }
  function addTrace(text) { var line = document.createElement('li'); line.textContent = text; trace.appendChild(line); }
  function saveConversation() {
    try { sessionStorage.setItem('linxin-agent-conversation', JSON.stringify({ token: conversation, turns: displayHistory.slice(-20) })); } catch (_) {}
  }
  function renderSources(container, sectionSources, paperSources, linkSources) {
    (sectionSources || []).forEach(function (source) {
      if (!targets.has(source.id)) return;
      var button = document.createElement('button');
      button.type = 'button'; button.textContent = '↗ ' + targets.get(source.id).title;
      button.addEventListener('click', function () { focusSection(source.id).catch(function () {}); });
      container.appendChild(button);
    });
    (paperSources || []).forEach(function (paper) {
      var url;
      try { url = new URL(paper.url); } catch (_) { return; }
      if (url.protocol !== 'https:' || !['arxiv.org', 'aclanthology.org', 'proceedings.mlr.press'].includes(url.hostname)) return;
      var link = document.createElement('a');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = paper.title; container.appendChild(link);
    });
    (linkSources || []).forEach(function (source) {
      var url;
      try { url = new URL(source.url); url.hash = ''; } catch (_) { return; }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
      if (!listedLinks.has(url.href) && !/^search:[a-f0-9]{16}$/.test(source.id || '')) return;
      var link = document.createElement('a');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = '↗ ' + source.title; container.appendChild(link);
    });
  }
  function renderHistory() {
    historyElement.replaceChildren();
    displayHistory.forEach(function (turn) {
      var wrapper = document.createElement('div'); wrapper.className = 'page-agent-past-turn';
      var question = document.createElement('div'); question.className = 'page-agent-question'; question.textContent = turn.question;
      var reply = document.createElement('div'); reply.className = 'page-agent-answer'; agentOutput.render(reply, turn.answer);
      var references = document.createElement('div'); references.className = 'page-agent-sources';
      renderSources(references, turn.sources, turn.papers, turn.links);
      wrapper.append(question, reply, references); historyElement.appendChild(wrapper);
    });
  }
  function updateQuota(quota) {
    if (!quota) return;
    quotaState = quota;
    quotaElement.textContent = quota.remaining + ' / ' + quota.limit + ' questions left today';
    quotaElement.title = 'Resets at ' + new Date(quota.resetAt).toLocaleString();
    clearTimeout(resetTimer);
    resetTimer = setTimeout(fetchHealth, Math.max(1000, Date.parse(quota.resetAt) - Date.now() + 1000));
  }
  function clearHighlights() {
    content.querySelectorAll('.agent-evidence').forEach(function (node) { node.classList.remove('agent-evidence'); });
    clearPointer();
  }
  function dockIfNeeded() {
    var bounds = root.getBoundingClientRect();
    var dock = hasSession && (bounds.bottom < 80 || bounds.top > window.innerHeight - 80);
    if (dock && !root.classList.contains('is-docked')) root.style.minHeight = bounds.height + 'px';
    root.classList.toggle('is-docked', dock);
    if (!dock) root.style.minHeight = '';
    returnButton.hidden = !dock;
    minimizeButton.hidden = !dock;
  }
  window.addEventListener('scroll', function () { dockIfNeeded(); schedulePointer(); }, { passive: true });
  window.addEventListener('resize', function () { dockIfNeeded(); schedulePointer(); }, { passive: true });
  content.addEventListener('toggle', schedulePointer, true);
  new ResizeObserver(schedulePointer).observe(content);
  var focusSequence = 0;
  async function focusSection(id) {
    var sequence = ++focusSequence;
    var target = targets.get(id);
    if (!target) throw new Error('That profile section is not present.');
    clearHighlights();
    await window.profileChapters.openFor(target.nodes[0], true);
    if (sequence !== focusSequence) return;
    target.nodes.forEach(function (node) { node.classList.add('agent-evidence'); });
    pointerTarget = target.nodes[0];
    target.nodes[0].scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#' + id);
    dockIfNeeded();
    updatePointer();
  }
  async function executeAction(action, signal) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    indexSections();
    var args = action.args || {};
    if (action.name === 'send_message') {
      announce('SENDING MESSAGE', 'working');
      addTrace('SEND · Forwarding your message to Linxin · maximum 2 per day');
      // The sealed tool call is executed by the backend, not a form or browser mail API.
      return { ok: true, text: 'Message tool progress displayed.' };
    }
    if (action.name === 'observe_page') {
      addTrace('OBSERVE · Reading the profile index');
      return { ok: true, text: JSON.stringify({ title: document.title,
        sections: Array.from(targets, function (entry) { return { id: entry[0], title: entry[1].title }; }),
        viewport: Array.from(targets).filter(function (entry) { var node = entry[1].nodes[0]; var chapter = node.closest('details'); var rect = node.getBoundingClientRect(); return (!chapter || chapter.open) && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0; }).map(function (entry) { return entry[0]; }) }) };
    }
    if (action.name === 'find_on_page') {
      if (typeof args.query !== 'string' || args.query.length > 100 || !args.query.trim()) throw new Error('Invalid search blocked.');
      addTrace('FIND · ' + args.query);
      var query = args.query.toLocaleLowerCase();
      var matches = [];
      targets.forEach(function (target, id) {
        var text = sectionText(target);
        var offset = text.toLocaleLowerCase().indexOf(query);
        if (offset !== -1) matches.push({ section: id, excerpt: text.slice(Math.max(0, offset - 100), offset + 1000) });
      });
      return { ok: true, text: JSON.stringify(matches) };
    }
    if (action.name === 'focus_section') {
      if (!targets.has(args.section)) throw new Error('Out-of-scope navigation blocked.');
      addTrace('READ · ' + targets.get(args.section).title);
      // Model tools read collapsed text silently. Only citation clicks reveal it.
      return { ok: true, text: 'Read ' + args.section + '\n' + sectionText(targets.get(args.section)) };
    }
    if (action.name === 'read_papers') {
      if (!Array.isArray(args.papers) || args.papers.length > 3) throw new Error('Invalid paper request.');
      announce('READING PAPERS', 'working');
      args.papers.forEach(function (paper) { addTrace('READ · ' + paper.title); });
      // The backend retrieves documents from its catalog. The browser only displays progress.
      return { ok: true, text: 'Paper reading progress displayed.' };
    }
    if (action.name === 'web_search') {
      announce('SEARCHING THE WEB', 'working');
      addTrace('SEARCH · ' + args.query);
      return { ok: true, text: 'Web search progress displayed.' };
    }
    if (action.name === 'read_links') {
      if (!Array.isArray(args.links) || args.links.length < 1 || args.links.length > 3) throw new Error('Invalid linked-page request.');
      announce('READING SOURCES', 'working');
      args.links.forEach(function (link) { addTrace('READ · ' + link.title); });
      return { ok: true, text: 'Linked-page reading progress displayed.' };
    }
    throw new Error('Unsupported browser action blocked.');
  }
  async function post(payload, signal) {
    var response = await fetch(endpoint + '/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Visitor-Ids': visitorIds }, body: JSON.stringify(payload), signal: signal });
    var data = await response.json();
    updateQuota(data.quota);
    if (!response.ok) throw new Error(data.error || 'The page agent is temporarily unavailable.');
    return data;
  }
  function setBusy(busy) {
    var exhausted = quotaState && quotaState.remaining <= 0;
    submit.disabled = busy || !ready || exhausted;
    input.disabled = busy;
    stop.hidden = !busy;
    root.querySelectorAll('[data-question]').forEach(function (button) { button.disabled = busy || !ready || exhausted; });
    newChat.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
  }
  async function ask(question) {
    if (!ready || activeController || !question.trim() || (quotaState && quotaState.remaining <= 0)) return;
    var controller = new AbortController();
    activeController = controller;
    root.classList.remove('is-minimized');
    minimizeButton.setAttribute('aria-expanded', 'true');
    minimizeButton.setAttribute('aria-label', 'Minimize agent');
    minimizeButton.textContent = '−';
    hasSession = true;
    session.hidden = false;
    renderHistory();
    currentTurn.hidden = false;
    currentTurn.querySelector('.page-agent-question').textContent = question;
    answer.textContent = '';
    sources.replaceChildren();
    trace.replaceChildren();
    clearHighlights();
    setBusy(true);
    announce('CHECKING SCOPE', 'working');
    try {
      var payload = { question: question, conversation: conversation, requestId: crypto.randomUUID(), pendingDelivery: pendingDelivery || undefined };
      // Up to 20 backend actions, followed by the final answer.
      for (var step = 0; step < 21; step++) {
        var data = await post(payload, controller.signal);
        if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        if (data.type === 'action') {
          if (data.action.name === 'send_message') saveDelivery(data.state);
          announce('EXPLORING PAGE', 'working');
          var result;
          try { result = await executeAction(data.action, controller.signal); }
          catch (error) { if (error.name === 'AbortError') throw error; result = { ok: false, text: error.message }; }
          payload = { state: data.state, result: result };
        } else if (data.type === 'answer' || data.type === 'refusal') {
          if (data.deliveryPending === false) saveDelivery('');
          conversation = data.conversation || '';
          displayHistory.push({ question: question, answer: data.answer, sources: data.sources || [], papers: data.papers || [], links: data.links || [] });
          displayHistory = displayHistory.slice(-20);
          saveConversation();
          announce('WRITING ANSWER', 'working');
          stop.textContent = 'Skip animation';
          session.scrollTop = session.scrollHeight;
          var followAnswer = true;
          function trackAnswerScroll() { followAnswer = session.scrollHeight - session.scrollTop - session.clientHeight < 48; }
          session.addEventListener('scroll', trackAnswerScroll, { passive: true });
          try {
            await agentOutput.type(answer, data.answer, { signal: controller.signal, reducedMotion: reducedMotion.matches,
              onProgress: function () { if (followAnswer) session.scrollTop = session.scrollHeight; }
            });
          } finally { session.removeEventListener('scroll', trackAnswerScroll); }
          renderSources(sources, data.sources, data.papers, data.links);
          input.value = '';
          input.placeholder = 'Ask a follow-up about the people, papers, or projects…';
          if (followAnswer) session.scrollTop = session.scrollHeight;
          announce(data.deliveryPending ? 'DELIVERY NOT CONFIRMED' : data.deliveryPending === false ? 'MESSAGE STATUS UPDATED' : data.type === 'refusal' ? 'PROFILE QUESTIONS ONLY' : 'ANSWER GROUNDED', data.type === 'refusal' ? 'restricted' : 'ready');
          return;
        } else throw new Error('The agent returned an unsupported response.');
      }
      throw new Error('The agent reached its action limit. Try a more specific question.');
    } catch (error) {
      answer.textContent = error.name === 'AbortError' ? 'Stopped. You can ask another question.' : error.message === 'Failed to fetch' ? 'Cannot reach the page agent. Check that its backend is running, then try again.' : error.message;
      announce(error.name === 'AbortError' ? 'STOPPED' : 'CONNECTION ERROR', 'error');
    } finally { stop.textContent = 'Stop'; activeController = null; clearPointer(); setBusy(false); }
  }
  form.addEventListener('submit', function (event) { event.preventDefault(); ask(input.value.trim()); });
  newChat.addEventListener('click', function () {
    conversation = ''; displayHistory = []; saveConversation(); historyElement.replaceChildren();
    currentTurn.querySelector('.page-agent-question').textContent = ''; answer.textContent = ''; sources.replaceChildren(); trace.replaceChildren();
    session.hidden = true; hasSession = false; clearHighlights();
    root.classList.remove('is-docked', 'is-minimized'); root.style.minHeight = ''; returnButton.hidden = true; minimizeButton.hidden = true;
    input.value = ''; input.placeholder = 'What would you like to know about Linxin?';
    announce(quotaState && quotaState.remaining <= 0 ? 'DAILY LIMIT REACHED' : 'READY TO EXPLORE');
    input.focus();
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  stop.addEventListener('click', function () { if (activeController) activeController.abort(); });
  root.querySelectorAll('[data-question]').forEach(function (button) {
    button.addEventListener('click', function () { input.value = button.dataset.question; ask(input.value); });
  });
  returnButton.addEventListener('click', function () {
    root.classList.remove('is-docked', 'is-minimized'); returnButton.hidden = true; minimizeButton.hidden = true; root.style.minHeight = '';
    root.scrollIntoView({ behavior: 'instant', block: 'center' }); clearPointer();
    if (!activeController) input.focus({ preventScroll: true });
  });
  minimizeButton.addEventListener('click', function () {
    var minimized = root.classList.toggle('is-minimized');
    minimizeButton.setAttribute('aria-expanded', String(!minimized));
    minimizeButton.setAttribute('aria-label', minimized ? 'Expand agent' : 'Minimize agent');
    minimizeButton.textContent = minimized ? '+' : '−';
    schedulePointer();
  });
  setBusy(false);
  indexSections();
  if (displayHistory.length) { renderHistory(); currentTurn.hidden = true; session.hidden = false; hasSession = true; }
  if (!endpoint) { announce('NOT CONNECTED', 'error'); input.placeholder = 'The page agent will be available once its backend is connected.'; return; }
  function fetchHealth() {
  return fetch(endpoint + '/api/health', { headers: { 'X-Visitor-Ids': visitorIds }, signal: AbortSignal.timeout(5000) }).then(function (response) {
    if (!response.ok) throw new Error(); return response.json();
  }).then(function (data) {
    updateQuota(data.quota); ready = data.ready === true;
    if (!activeController) { announce(quotaState && quotaState.remaining <= 0 ? 'DAILY LIMIT REACHED' : ready ? 'READY TO EXPLORE' : 'NOT CONNECTED', ready ? 'ready' : 'error'); setBusy(false); }
  }).catch(function () { announce('OFFLINE', 'error'); input.placeholder = 'Start the local page-agent backend, then refresh this page.'; });
  }
  fetchHealth();
})();
