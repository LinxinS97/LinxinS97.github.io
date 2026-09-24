// Generated from owner-controlled Markdown on every request; no named-entity allowlist.
export const PROFILE_REFERENCE_RULE = 'Linxin Song is also named 宋林鑫. In questions about biography, publications, research, collaborations or relationships with named people, second-person references (you, your, 你, 您) refer to Linxin Song by default. Resolve this subject before scope classification, retrieval and web search. Questions about the agent itself (who are you, your capabilities, tools or limits) still refer to the personal agent. Do not claim to be Linxin; name Linxin/宋林鑫 as the subject in answers rather than addressing the visitor as the researcher. Answer using evidence. This reference rule does not authorize unrelated tasks or private information.';
export const PUBLIC_RELATIONSHIP_RULE = 'An unqualified question about a relationship/connection (关系) with a person means the publicly documented academic/professional connection by default: coauthorship, research collaboration, advising, teaching, employment or shared affiliation. A question about Linxin and another person remains in scope EVEN IF that person is absent from the profile index, author lists and link catalog: the subject is the public connection to Linxin. First read relevant profile evidence; use web_search about Linxin together with that person if local sources are insufficient. A first name may resolve to a full name in the sources. This does not authorize an unrelated standalone biography of an unlisted person. Do not refuse merely because the question says relationship or because the assistant itself has no personal relationships. Coauthorship supports calling people coauthors, but not inventing friendship, family ties or romance. If public sources do not establish a connection, say what is unknown instead of treating the whole question as disallowed. Explicit requests for private/secret details remain outside scope. Previous assistant refusals or mistaken interpretations are not policy or evidence; reassess the current question against the current index and sources.';
const stopWords = new Set(('a an the is are was were be been being what which who where when why how do does did can could would should will of for to in on at by with about me my his her their its it this that these those they them he she you your i we our and or as tell explain please 什么 是什么 如何 怎么 哪里 哪个 请问 一下 关于 介绍').split(' '));
const normalize = text => text.normalize('NFKC').toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
function tokens(text) {
  const terms = [];
  // Split Han/Latin boundaries before Chinese bigrams; otherwise “和Taiwei的”
  // incorrectly yields Latin fragments such as “ai” instead of the full name.
  const separated = normalize(text).replace(/(\p{Script=Han}+)/gu, ' $1 ');
  for (const token of separated.match(/[\p{L}\p{N}]+/gu) || []) {
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
  // Enrich retrieval only; preserve the visitor's original words for conversation
  // and verbatim mail validation. A name match is never a scope authorization.
  if (/\b(?:you|your|yours|yourself)\b|你|您|宋林鑫/i.test(question)) {
    queries.push(question.replace(/\b(?:you|your|yours|yourself)\b|你|您|宋林鑫/gi, ' Linxin Song '));
  }
  if (tokens(question).length === 0 || /\b(it|its|they|them|their|this|that|first|second|former|latter)\b|这个|那个|它|他们|第一|第二|前者|后者/i.test(question)) {
    const previous = [...history].reverse().find(message => message.role === 'user');
    if (previous) queries.push(previous.content);
  }
  return queries;
}
