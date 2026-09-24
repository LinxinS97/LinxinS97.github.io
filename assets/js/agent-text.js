(function (root) {
  'use strict';
  function cleanAgentAnswer(value) {
    var token = '(?:about-me|research-interests|post-training|agentic-ai|language-model-evaluation|before-phd|teaching|internships|professional-services|(?:link|search):[a-f0-9]{8,64}|arxiv:[0-9.]+(?:v[0-9]+)?|(?:acl|mlr):[\\w.-]+)';
    var citations = new RegExp('\\[(?:\\s*' + token + '\\s*[,;]?)+\\](?:\\(#[^)]*\\))?', 'gi');
    return String(value || '').replace(citations, '').replace(/\b(?:link|search):[a-f0-9]{8,64}\b/gi, '')
      .replace(/[ \t]+([.,;!?，。；！？])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
  }
  if (typeof module === 'object' && module.exports) module.exports = cleanAgentAnswer;
  else root.cleanAgentAnswer = cleanAgentAnswer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
