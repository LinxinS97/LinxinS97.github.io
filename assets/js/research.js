(function () {
  'use strict';
  var root = document.querySelector('.page-agent');
  if (!root) return;
  var content = document.querySelector('.page__content');
  var status = root.querySelector('.page-agent-status');
  var form = root.querySelector('form');
  var input = form.querySelector('textarea');
  var defaultPlaceholder = input.placeholder;
  var submit = root.querySelector('.page-agent-send');
  var stop = root.querySelector('.page-agent-stop');
  var session = root.querySelector('.page-agent-session');
  var trace = root.querySelector('.page-agent-trace');
  var answer = root.querySelector('.page-agent-answer');
  var thinking = root.querySelector('.page-agent-thinking');
  var workLabel = thinking.querySelector('.page-agent-work-label');
  var workStarted = 0;
  var workDuration = 0;
  var workFinished = false;
  var progressLine = null;
  var sources = root.querySelector('.page-agent-sources');
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
  var resizeHandle = root.querySelector('.page-agent-resize');
  var inputDrag = null;
  function resizeInput(height) {
    var maximum = Math.max(34, Math.min(240, innerHeight * .4));
    var nextHeight = Math.round(Math.max(34, Math.min(maximum, height)));
    input.style.height = nextHeight + 'px';
    resizeHandle.setAttribute('aria-valuemax', String(Math.floor(maximum)));
    resizeHandle.setAttribute('aria-valuenow', String(nextHeight));
  }
  resizeHandle.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    event.preventDefault();
    inputDrag = { id: event.pointerId, y: event.clientY, height: input.getBoundingClientRect().height };
    resizeHandle.setPointerCapture(event.pointerId);
    resizeHandle.classList.add('is-dragging');
  });
  resizeHandle.addEventListener('pointermove', function (event) {
    if (inputDrag && inputDrag.id === event.pointerId) resizeInput(inputDrag.height + inputDrag.y - event.clientY);
  });
  function endInputDrag() { inputDrag = null; resizeHandle.classList.remove('is-dragging'); }
  resizeHandle.addEventListener('pointerup', endInputDrag);
  resizeHandle.addEventListener('pointercancel', endInputDrag);
  resizeHandle.addEventListener('lostpointercapture', endInputDrag);
  resizeHandle.addEventListener('keydown', function (event) {
    var height = input.getBoundingClientRect().height;
    if (event.key === 'ArrowUp') height += 16;
    else if (event.key === 'ArrowDown') height -= 16;
    else if (event.key === 'Home') height = 34;
    else if (event.key === 'End') height = 240;
    else return;
    event.preventDefault(); resizeInput(height);
  });
  function reserveComposerSpace() {
    var transcriptHeight = 0;
    if (!session.hidden) {
      var style = getComputedStyle(session);
      transcriptHeight = session.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    }
    document.body.style.setProperty('--agent-composer-height', Math.ceil(root.getBoundingClientRect().height - transcriptHeight) + 'px');
  }
  new ResizeObserver(reserveComposerSpace).observe(root);
  window.addEventListener('resize', function () { resizeInput(input.getBoundingClientRect().height); });
  resizeInput(input.getBoundingClientRect().height);
  var workAnimations = new WeakMap();
  function setWorkOpen(details, open, animate) {
    var startHeight = details.getBoundingClientRect().height;
    var previous = workAnimations.get(details);
    if (previous) { previous.animation.cancel(); workAnimations.delete(details); }
    details.style.height = ''; details.style.overflow = '';
    details.dataset.expanded = String(open);
    details.querySelector('summary').setAttribute('aria-expanded', String(open));
    if (animate === false || reducedMotion.matches || !details.animate || !startHeight) {
      details.open = open; return;
    }
    details.open = open;
    var endHeight = details.getBoundingClientRect().height;
    // Keep the content rendered until the closing animation has finished.
    details.open = true;
    details.style.overflow = 'hidden';
    var animation = details.animate([{ height: startHeight + 'px' }, { height: endHeight + 'px' }], {
      duration: 300, easing: 'cubic-bezier(.2, 0, 0, 1)', fill: 'both'
    });
    workAnimations.set(details, { animation: animation, open: open });
    animation.onfinish = function () {
      if (workAnimations.get(details)?.animation !== animation) return;
      details.open = open; details.style.height = ''; details.style.overflow = '';
      workAnimations.delete(details); animation.cancel();
    };
  }
  root.addEventListener('click', function (event) {
    var summary = event.target.closest('.page-agent-thinking-label');
    if (!summary || !root.contains(summary)) return;
    event.preventDefault();
    var details = summary.parentElement;
    var pending = workAnimations.get(details);
    setWorkOpen(details, !(pending ? pending.open : details.open));
  });
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
    if (!pointerTarget || !pointerTarget.isConnected) {
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
  function showProgress(text) {
    if (!text) return;
    var follow = session.scrollHeight - session.scrollTop - session.clientHeight < 48;
    if (!progressLine) {
      progressLine = document.createElement('li');
      progressLine.className = 'page-agent-thinking-detail';
      trace.appendChild(progressLine);
    }
    // Streaming snapshots update this sentence only; earlier steps stay in the timeline.
    progressLine.textContent = text;
    if (follow) session.scrollTop = session.scrollHeight;
  }
  function addTrace(text) {
    var follow = session.scrollHeight - session.scrollTop - session.clientHeight < 48;
    var line = document.createElement('li'); line.className = 'page-agent-tool-step'; line.textContent = text; trace.appendChild(line);
    progressLine = null;
    if (follow) session.scrollTop = session.scrollHeight;
  }
  function saveConversation() {
    try { sessionStorage.setItem('linxin-agent-conversation', JSON.stringify({ token: conversation, turns: displayHistory.slice(-20) })); } catch (_) {}
  }
  function formatWorkDuration(milliseconds) {
    var seconds = Math.max(1, Math.round(milliseconds / 1000));
    if (seconds < 60) return seconds + 's';
    var minutes = Math.floor(seconds / 60);
    if (seconds < 3600) return minutes + 'm' + (seconds % 60 ? ' ' + seconds % 60 + 's' : '');
    return Math.floor(minutes / 60) + 'h' + (minutes % 60 ? ' ' + minutes % 60 + 'm' : '');
  }
  function finishWork() {
    workDuration = performance.now() - workStarted;
    workLabel.textContent = 'Worked for ' + formatWorkDuration(workDuration);
    thinking.classList.add('is-complete');
    thinking.hidden = false;
    if (!workFinished) setWorkOpen(thinking, false);
    workFinished = true;
  }
  function progressSnapshot() {
    return Array.from(trace.children, function (line) {
      return { text: line.textContent, tool: line.classList.contains('page-agent-tool-step') };
    });
  }
  function renderPastWork(turn) {
    if (!Number.isFinite(turn.workDuration) || !Array.isArray(turn.progress)) return null;
    var details = document.createElement('details'); details.className = 'page-agent-thinking is-complete';
    var summary = document.createElement('summary'); summary.className = 'page-agent-thinking-label';
    summary.textContent = 'Worked for ' + formatWorkDuration(turn.workDuration);
    var list = document.createElement('ol'); list.className = 'page-agent-trace';
    list.setAttribute('aria-label', 'Agent progress and tool calls');
    turn.progress.forEach(function (item) {
      if (!item || typeof item.text !== 'string') return;
      var line = document.createElement('li');
      line.className = item.tool ? 'page-agent-tool-step' : 'page-agent-thinking-detail';
      line.textContent = item.text; list.appendChild(line);
    });
    details.append(summary, list); return details;
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
      if (!listedLinks.has(url.href) && !/^(?:search|url):[a-f0-9]{1,16}$/.test(source.id || '')) return;
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
      wrapper.appendChild(question);
      var work = renderPastWork(turn); if (work) wrapper.appendChild(work);
      wrapper.append(reply, references); historyElement.appendChild(wrapper);
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
  function setConversationOpen(open) {
    session.hidden = !open || !hasSession;
    minimizeButton.hidden = !hasSession;
    minimizeButton.setAttribute('aria-expanded', String(!session.hidden));
    minimizeButton.setAttribute('aria-label', session.hidden ? 'Show conversation' : 'Hide conversation');
    minimizeButton.textContent = session.hidden ? '+' : '−';
  }
  window.addEventListener('scroll', schedulePointer, { passive: true });
  window.addEventListener('resize', schedulePointer, { passive: true });
  content.addEventListener('toggle', schedulePointer, true);
  new ResizeObserver(schedulePointer).observe(content);
  var focusSequence = 0;
  async function focusSection(id) {
    var sequence = ++focusSequence;
    var target = targets.get(id);
    if (!target) throw new Error('That profile section is not present.');
    clearHighlights();
    if (sequence !== focusSequence) return;
    target.nodes.forEach(function (node) { node.classList.add('agent-evidence'); });
    pointerTarget = target.nodes[0];
    target.nodes[0].scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#' + id);
    setConversationOpen(false);
    updatePointer();
  }
  async function executeAction(action, signal) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    indexSections();
    var args = action.args || {};
    if (action.name === 'observe_page' && Array.isArray(args.parallel)) {
      if (args.parallel.length < 2 || args.parallel.length > 4 || args.parallel.some(function (item) {
        return !['observe_page', 'find_on_page', 'focus_section', 'read_papers', 'read_links', 'web_search'].includes(item.name) || item.args && item.args.parallel;
      })) throw new Error('Invalid parallel action blocked.');
      addTrace('PARALLEL · ' + args.parallel.length + ' operations');
      await Promise.all(args.parallel.map(function (item) { return executeAction(item, signal); }));
      return { ok: true, text: 'Parallel retrieval progress displayed.' };
    }
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
  async function post(payload, signal, onStream) {
    var response = await fetch(endpoint + '/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'X-Visitor-Ids': visitorIds }, body: JSON.stringify(payload), signal: signal });
    if (response.ok && (response.headers.get('Content-Type') || '').includes('text/event-stream')) {
      for await (var event of agentStream.events(response.body)) {
        var item = JSON.parse(event);
        if (item.type === 'result') { updateQuota(item.result.quota); return item.result; }
        if (item.type === 'error') { updateQuota(item.quota); throw new Error(item.error || 'The answer stream was interrupted.'); }
        if (onStream) onStream(item);
      }
      throw new Error('The answer stream was interrupted. Please try again.');
    }
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
    newChat.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
  }
  async function ask(question) {
    if (!ready || activeController || !question.trim() || (quotaState && quotaState.remaining <= 0)) return;
    var controller = new AbortController();
    activeController = controller;
    hasSession = true;
    setConversationOpen(true);
    renderHistory();
    currentTurn.hidden = false;
    currentTurn.querySelector('.page-agent-question').textContent = question;
    answer.textContent = '';
    sources.replaceChildren();
    trace.replaceChildren();
    progressLine = null;
    clearHighlights();
    setBusy(true);
    workStarted = performance.now(); workDuration = 0; workFinished = false;
    workLabel.textContent = 'Thinking'; thinking.classList.remove('is-complete'); setWorkOpen(thinking, true, false);
    thinking.hidden = false;
    session.scrollTop = session.scrollHeight;
    announce('CHECKING SCOPE', 'working');
    var preview = '';
    function onStream(event) {
      if (event.type === 'reset') {
        progressLine = null;
        workFinished = false; workLabel.textContent = 'Thinking'; thinking.classList.remove('is-complete'); setWorkOpen(thinking, true, false);
        preview = ''; answer.textContent = ''; thinking.hidden = false;
        answer.classList.remove('is-plain-text'); answer.setAttribute('aria-busy', 'false');
      } else if (event.type === 'progress' && typeof event.text === 'string' && !preview) {
        thinking.hidden = false;
        showProgress(event.text.slice(0, 240));
      } else if (event.type === 'delta' && typeof event.text === 'string') {
        var follow = session.scrollHeight - session.scrollTop - session.clientHeight < 48;
        preview += event.text;
        if (preview.length > 64000) throw new Error('The answer exceeded its display limit.');
        if (!workFinished) finishWork();
        // Plain text while incomplete; sanitized Markdown and verified sources on completion.
        answer.classList.add('is-plain-text'); answer.setAttribute('aria-busy', 'true');
        answer.textContent = cleanAgentAnswer(preview);
        announce('WRITING ANSWER', 'working');
        if (follow) session.scrollTop = session.scrollHeight;
      }
    }
    try {
      var payload = { question: question, conversation: conversation, requestId: crypto.randomUUID(), pendingDelivery: pendingDelivery || undefined };
      // Up to 20 backend actions, followed by the final answer.
      for (var step = 0; step < 21; step++) {
        progressLine = null;
        var data = await post(payload, controller.signal, onStream);
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
          finishWork();
          displayHistory.push({ question: question, answer: data.answer, sources: data.sources || [], papers: data.papers || [], links: data.links || [], workDuration: workDuration, progress: progressSnapshot() });
          displayHistory = displayHistory.slice(-20);
          saveConversation();
          var followAnswer = session.scrollHeight - session.scrollTop - session.clientHeight < 48;
          agentOutput.render(answer, data.answer);
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
    } finally { if (!workFinished) finishWork(); answer.setAttribute('aria-busy', 'false'); activeController = null; clearPointer(); setBusy(false); }
  }
  form.addEventListener('submit', function (event) { event.preventDefault(); ask(input.value.trim()); });
  newChat.addEventListener('click', function () {
    conversation = ''; displayHistory = []; saveConversation(); historyElement.replaceChildren();
    currentTurn.querySelector('.page-agent-question').textContent = ''; answer.textContent = ''; sources.replaceChildren(); trace.replaceChildren();
    session.hidden = true; hasSession = false; clearHighlights();
    setConversationOpen(false);
    input.value = ''; input.placeholder = defaultPlaceholder;
    announce(quotaState && quotaState.remaining <= 0 ? 'DAILY LIMIT REACHED' : 'READY TO EXPLORE');
    input.focus();
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  stop.addEventListener('click', function () { if (activeController) activeController.abort(); });
  minimizeButton.addEventListener('click', function () {
    setConversationOpen(session.hidden);
  });
  setBusy(false);
  indexSections();
  if (displayHistory.length) { renderHistory(); currentTurn.hidden = true; hasSession = true; }
  setConversationOpen(false);
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
