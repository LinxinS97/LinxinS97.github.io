// Generated from owner-controlled Markdown on every request; no named-entity allowlist.
const stopWords = new Set(('a an the is are was were be been being what which who where when why how do does did can could would should will of for to in on at by with about me my his her their its it this that these those they them he she you your i we our and or as tell explain please 什么 是什么 如何 怎么 哪里 哪个 请问 一下 关于 介绍').split(' '));
const normalize = text => text.normalize('NFKC').toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
function tokens(text) {
  const terms = [];
  for (const token of normalize(text).match(/[\p{L}\p{N}]+/gu) || []) {
    if (/\p{Script=Han}/u.test(token)) {
      for (let i = 0; i < token.length - 1; i++) terms.push(token.slice(i, i + 2));
    } else terms.push(token);
  }
  return [...new Set(terms.filter(term => term.length > 1 && !stopWords.has(term)))];
}
function plainText(markdown) {
  return markdown.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
}
export function buildProfileIndex(profile, sections) {
  const groups = new Map();
  let section = null;
  for (const line of profile.split('\n')) {
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      const id = heading[2].trim().toLowerCase().replace(/\s+/g, '-');
      if (sections[id]) { section = id; if (!groups.has(id)) groups.set(id, []); }
      else if (heading[1].length === 1) section = null;
    } else if (section) groups.get(section).push(line);
  }
  // Older adapters/tests may provide plain text rather than the full Markdown file.
  if (!groups.size && profile.trim()) groups.set('about-me', [profile]);
  const records = [], manifest = [];
  for (const [id, lines] of groups) {
    const markdown = lines.join('\n');
    const labels = [...markdown.matchAll(/\[([^\]]+)\]\([^)]+\)/g)].map(match => match[1]);
    manifest.push({ id, title: sections[id], linkedNames: [...new Set(labels)] });
    for (const paragraph of markdown.split(/\n\s*\n/)) {
      const text = plainText(paragraph);
      if (!text) continue;
      for (let offset = 0; offset < text.length; offset += 1100) {
        const excerpt = text.slice(offset, offset + 1400);
        records.push({ section: id, title: sections[id], text: excerpt, terms: new Set(tokens(sections[id] + ' ' + excerpt)) });
      }
    }
  }
  return { manifest, records };
}
export function searchProfileIndex(index, queries) {
  const safeQueries = [...new Set(queries.filter(query => typeof query === 'string' && query.trim()).map(query => query.trim().slice(0, 1200)))].slice(0, 4);
  const terms = tokens(safeQueries.join(' '));
  const frequencies = new Map(terms.map(term => [term, index.records.filter(record => record.terms.has(term)).length]));
  const ranked = index.records.map((record, order) => {
    const matched = terms.filter(term => record.terms.has(term));
    const score = matched.reduce((sum, term) => sum + Math.log(1 + index.records.length / (1 + frequencies.get(term))), 0);
    return { record, matched, score, order };
  }).filter(hit => hit.matched.length).sort((a, b) => b.score - a.score || a.order - b.order);
  // A bounded evidence set is sent to the classifier instead of the entire profile.
  return { queries: safeQueries, matches: ranked.slice(0, 5).map(({ record, matched }) => ({ ...record, terms: undefined, matched })) };
}
export function questionQueries(question, history) {
  const queries = [question];
  if (tokens(question).length === 0 || /\b(it|its|they|them|their|this|that|first|second|former|latter)\b|这个|那个|它|他们|第一|第二|前者|后者/i.test(question)) {
    const previous = [...history].reverse().find(message => message.role === 'user');
    if (previous) queries.push(previous.content);
  }
  return queries;
}
