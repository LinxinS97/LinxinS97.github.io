export function citationPool(state, sectionIDs, papers, links) {
  const pool = { sources: [...new Set(state.read)].filter(id => sectionIDs.includes(id)), paper_sources: [], link_sources: [] };
  for (const [id, document] of Object.entries(state.documents)) {
    if (typeof document.notes !== 'string' || !document.notes.trim()) continue;
    if (state.sourceReads && !state.sourceReads.includes(id)) continue;
    if (document.kind === 'websearch' || document.kind === 'url' || (document.kind === 'webpage' && links.has(id))) pool.link_sources.push(id);
    else if (papers.has(id)) pool.paper_sources.push(id);
  }
  return pool;
}

export function citationTool(tool, pool) {
  const copy = structuredClone(tool);
  for (const field of Object.keys(pool)) {
    const property = copy.function.parameters.properties[field];
    property.items = pool[field].length ? { type: 'string', enum: pool[field] } : { type: 'string' };
    property.maxItems = pool[field].length;
  }
  return copy;
}

// Reclassify known IDs when the model puts them in the wrong citation array.
// Never drop an unknown citation or attach an unread source to an answer.
export function verifiedAnswer(args, pool) {
  if (typeof args.answer !== 'string' || !args.answer.trim() || args.answer.length > 14000) return null;
  const fields = ['sources', 'paper_sources', 'link_sources'];
  const values = fields.map(field => args[field] ?? []);
  if (values.some(value => !Array.isArray(value) || value.some(id => typeof id !== 'string'))) return null;
  const references = [...new Set(values.flat())];
  if (!references.length || references.some(id => !fields.some(field => pool[field].includes(id)))) return null;
  return { answer: args.answer, ...Object.fromEntries(fields.map(field => [field, references.filter(id => pool[field].includes(id))])) };
}
