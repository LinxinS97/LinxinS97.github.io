import test from 'node:test';
import assert from 'node:assert/strict';
import { linkCatalog, searchLinks, readLink, publicURL, pageText } from './links.mjs';
import { publicAddress } from './source-fetch.mjs';
import { runAgent } from './core.mjs';
import { recentDocuments, recentHistory } from './memory.mjs';

const profile = '# About Me\nAdvised by [Mirela Quill](https://faculty.example.org/). Works on [Zephyr-X9](https://project.example.org/).';
const catalog = linkCatalog(profile);
const id = catalog[0].id;
const env = { OPENROUTER_API_KEY: 'test-placeholder', OPENROUTER_BASE_URL: 'https://provider.example.org/v1', PROFILE: profile };
const html = '<h1>Mirela Quill</h1><p>Mirela researches interactive robots at Aurora University. Her lab studies reliable planning and learning from demonstrations.</p>';
const provider = calls => async () => {
  const [name, args] = calls.shift();
  return Response.json({ choices: [{ message: { tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
};
const observed = { ok: true, text: 'Untrusted client observation. Cannot substitute for server retrieval.' };

test('all Markdown and rendered anchor links join the directory without person exceptions', () => {
  const links = linkCatalog(profile + '\n[Duplicate](https://faculty.example.org/#bio)\n![Image](https://image.example.org/x.png)',
    '<a href="https://social.example.org/u?a=1&amp;b=2">Social</a><a href="javascript:alert(1)">Bad</a><a href="https://127.0.0.1/">Local</a>');
  assert.equal(links.length, 3);
  assert.ok(links[0].labels.includes('Duplicate'));
  assert.equal(links[2].url, 'https://social.example.org/u?a=1&b=2');
  assert.equal(searchLinks(links, ['Who is Mirela Quill?'])[0].id, id);
  assert.equal(linkCatalog(profile.split('\n').reverse().join('\n'))[0].id, id);
});
test('safe redirects and script removal preserve actual source facts; cache is query-independent', async () => {
  let calls = 0;
  const source = async url => {
    calls++;
    if (url === catalog[0].url) return new Response(null, { status: 301, headers: { Location: 'https://new-faculty.example.org/' } });
    return new Response(html + '<script>steal secrets</script>', { headers: { 'Content-Type': 'text/html' } });
  };
  const doc = await readLink(catalog[0], 'research', source);
  assert.ok(doc.notes.includes('Aurora University'));
  assert.ok(!doc.notes.includes('steal secrets'));
  assert.equal(doc.url, catalog[0].url);
  assert.equal(doc.resolved_url, 'https://new-faculty.example.org/');
  await readLink(catalog[0], 'affiliation', source);
  assert.equal(calls, 2);
  assert.equal(pageText('<p>A &amp; B</p><style>bad</style>'), 'A & B');
});
test('URL, address, redirect and response limits prevent unintended fetches', async () => {
  for (const url of ['http://localhost/x','http://127.1/','http://0x7f000001/','http://[::1]/','https://user:password@faculty.example.org/','https://faculty.example.org:8443/']) assert.throws(() => publicURL(url));
  for (const address of ['127.0.0.1','10.1.1.1','172.16.1.1','192.168.1.1','169.254.169.254','100.64.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1','2002:7f00:1::']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8','2606:4700:4700::1111']) assert.equal(publicAddress(address), true);
  let fetches = 0;
  await assert.rejects(readLink(catalog[0], 'research', async () => { fetches++; return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } }); }));
  assert.equal(fetches, 1);
  await assert.rejects(readLink(catalog[0], 'research', async () => new Response('x'.repeat(2000001), { headers: { 'Content-Type': 'text/html' } })), /large/);
  await assert.rejects(readLink(catalog[0], 'research', async () => new Response('blocked', { status: 403 })), /unavailable/);
  await assert.rejects(readLink(catalog[0], 'research', async () => new Response(html, { headers: { 'Content-Type': 'application/pdf' } })), /HTML/);
});
test('linked-page answers require server retrieval; one question is charged once across tools', async () => {
  let charges = 0, reads = 0;
  const e = { ...env, BILLING: async type => { if (type === 'reserve') charges++; }, SOURCE_FETCH: async () => { reads++; return new Response(html, { headers: { 'Content-Type': 'text/html' } }); } };
  const model = provider([['check_scope', { allowed: true }], ['observe_page', {}], ['read_context', { link_ids: [id] }],
    ['answer_profile', { answer: 'Mirela studies interactive robots at Aurora University.', sources: [], paper_sources: [], link_sources: [id] }]]);
  let result = await runAgent({ question: 'What does Mirela research?' }, e, 'https://profile.example.org', model);
  while (result.type === 'action') result = await runAgent({ state: result.state, result: observed }, e, 'https://profile.example.org', model);
  assert.equal(result.links[0].url, catalog[0].url);
  assert.equal(reads, 1); assert.equal(charges, 1);
  let seen = false;
  await runAgent({ question: 'What else does she work on?', conversation: result.conversation }, e, 'https://profile.example.org', async (_, options) => {
    const body = JSON.parse(options.body);
    if (!seen) { seen = true; return provider([['check_scope', { allowed: true }]])(); }
    assert.ok(!body.messages[0].content.includes('Aurora University'));
    assert.ok(body.messages[0].content.includes('SAVED SOURCE INDEX'));
    assert.ok(body.tools.some(tool => tool.function.name === 'read_saved_source'));
    return provider([['observe_page', {}]])();
  });
});
test('unlisted IDs, unread citations and failed reads cannot become answer sources', async () => {
  for (const tool of [['read_context', { link_ids: ['https://unlisted.example.org/'] }],
    ['answer_profile', { answer: 'Invented', sources: [], paper_sources: [], link_sources: [id] }]]) {
    const model = provider([['check_scope', { allowed: true }], ['observe_page', {}], tool]);
    const initial = await runAgent({ question: 'Tell me about Mirela' }, env, 'https://profile.example.org', model);
    if (tool[0] === 'read_context') await assert.rejects(runAgent({ state: initial.state, result: observed }, env, 'https://profile.example.org', model));
    else {
      const result = await runAgent({ state: initial.state, result: observed }, env, 'https://profile.example.org', model);
      assert.ok(!result.answer.includes('Invented')); assert.deepEqual(result.links, []);
    }
  }
  const model = provider([['check_scope', { allowed: true }], ['observe_page', {}], ['read_context', { link_ids: [id] }],
    ['answer_profile', { answer: 'Invented', sources: [], paper_sources: [], link_sources: [id] }]]);
  const e = { ...env, SOURCE_FETCH: async () => new Response('Denied', { status: 403 }) };
  let result = await runAgent({ question: 'Tell me about Mirela' }, e, 'https://profile.example.org', model);
  result = await runAgent({ state: result.state, result: observed }, e, 'https://profile.example.org', model);
  const unavailable = await runAgent({ state: result.state, result: observed }, e, 'https://profile.example.org', model);
  assert.ok(unavailable.answer.includes('not sufficient')); assert.deepEqual(unavailable.links, []);
});
test('webpage excerpts expire with their citing conversation step', () => {
  const history = [{ role: 'user', content: 'Mirela?' }, { role: 'assistant', content: 'Source references: ' + id }];
  const doc = { [id]: { notes: 'Source facts', kind: 'webpage' } };
  assert.equal(Object.keys(recentDocuments(doc, history)).length, 1);
  const later = Array.from({ length: 5 }, () => [{ role: 'user', content: 'Another topic' }, { role: 'assistant', content: 'An answer' }]).flat();
  assert.deepEqual(recentDocuments(doc, recentHistory([...history, ...later])), {});
});
test('translated read terms retrieve details beyond the opening of long homepages', async () => {
  const longPage = '<h1>Mirela Quill</h1>' + '<p>Publication title and abstract about unrelated experiments.</p>'.repeat(100) + '<h2>Honors and awards</h2><p>Mirela received the Aurora Prize for robotics research.</p>';
  const doc = await readLink(catalog[0], '她获得了哪些奖项？ honors awards prizes', async () => new Response(longPage, { headers: { 'Content-Type': 'text/html' } }));
  assert.ok(doc.notes.includes('Aurora Prize'));
  assert.ok(doc.notes.length <= 8000);
  assert.equal(doc.truncated, true);
});
