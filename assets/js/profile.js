(function () {
  'use strict';
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function revealHash() {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { return; }
    var target = document.getElementById(id);
    if (!target || !target.closest('.profile-document')) return;
    target.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  }
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href^="#"]');
    if (!link || link.getAttribute('href') === '#' || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var target;
    try { target = document.getElementById(decodeURIComponent(link.hash.slice(1))); } catch (_) { return; }
    if (!target || !target.closest('.profile-document')) return;
    // Keep profile anchor navigation consistent with agent citations.
    event.preventDefault();
    event.stopPropagation();
    if (location.hash !== link.hash) history.pushState(null, '', link.hash);
    revealHash();
  }, true);
  window.addEventListener('hashchange', function () { revealHash(); });
  revealHash();
})();
