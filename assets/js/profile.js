(function () {
  'use strict';
  var transitions = new WeakMap();
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function setChapterOpen(chapter, open, animate) {
    var previous = transitions.get(chapter);
    if (previous && previous.open === open) return previous.finished;
    if (!previous && chapter.open === open) return Promise.resolve();
    var start = chapter.getBoundingClientRect().height;
    if (previous) previous.animation.cancel();
    chapter.open = true;
    var summary = chapter.querySelector('summary');
    var border = parseFloat(getComputedStyle(chapter).borderTopWidth) + parseFloat(getComputedStyle(chapter).borderBottomWidth);
    var end = open ? chapter.getBoundingClientRect().height : summary.getBoundingClientRect().height + border;
    if (animate === false || reducedMotion.matches || !chapter.animate) {
      transitions.delete(chapter);
      chapter.open = open;
      chapter.style.overflow = '';
      return Promise.resolve();
    }
    chapter.style.overflow = 'hidden';
    var animation = chapter.animate([{ height: start + 'px' }, { height: end + 'px' }], {
      duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)'
    });
    var transition = { open: open, animation: animation };
    transitions.set(chapter, transition);
    transition.finished = animation.finished.catch(function () {}).then(function () {
      if (transitions.get(chapter) !== transition) return;
      transitions.delete(chapter);
      chapter.open = open;
      chapter.style.overflow = '';
    });
    return transition.finished;
  }
  async function openFor(target, animate) {
    var chapters = [];
    var ancestor = target.parentElement;
    while (ancestor) {
      if (ancestor.matches('details.profile-chapter')) chapters.unshift(ancestor);
      ancestor = ancestor.parentElement;
    }
    for (var chapter of chapters) await setChapterOpen(chapter, true, animate);
  }
  window.profileChapters = { openFor: openFor };
  async function revealHash(animate) {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { return; }
    var target = document.getElementById(id);
    if (!target || !target.closest('.profile-document')) return;
    await openFor(target, animate);
    if (location.hash.slice(1) === encodeURIComponent(id) || location.hash.slice(1) === id) target.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  }
  document.addEventListener('click', function (event) {
    var summary = event.target.closest('.profile-chapter > summary');
    if (summary) {
      event.preventDefault();
      var chapter = summary.parentElement;
      var transition = transitions.get(chapter);
      setChapterOpen(chapter, !(transition ? transition.open : chapter.open), true);
      return;
    }
    var link = event.target.closest('a[href^="#"]');
    if (!link || link.getAttribute('href') === '#' || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var target;
    try { target = document.getElementById(decodeURIComponent(link.hash.slice(1))); } catch (_) { return; }
    if (!target || !target.closest('.profile-document')) return;
    // Open before scrolling; the theme's legacy smooth-scroll handler cannot see closed chapters.
    event.preventDefault();
    event.stopPropagation();
    if (location.hash !== link.hash) history.pushState(null, '', link.hash);
    revealHash(true);
  }, true);
  window.addEventListener('hashchange', function () { revealHash(true); });
  revealHash(false);
})();
