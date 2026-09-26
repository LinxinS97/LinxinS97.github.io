// Mocked API: verify silent parallel progress and citations for explicit URLs.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let requests = 0, continuation;
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.route('**/api/health*', route => route.fulfill({ json: { ready: true, quota: { remaining: 20, limit: 20 } } }));
    await page.route('**/api/agent', async route => {
      if (requests++ === 0) return route.fulfill({ json: { type: 'action', state: 'opaque-batch-token', action: { name: 'observe_page', args: { parallel: [
        { name: 'focus_section', args: { section: 'about-me' } },
        { name: 'read_links', args: { links: [{ title: 'Specific source', url: 'https://new-source.example.org/research' }] } },
        { name: 'web_search', args: { query: 'Linxin research' } }
      ] } } } });
      continuation = route.request().postDataJSON();
      return route.fulfill({ json: { type: 'answer', answer: '**Verified** research overview.', sources: [], papers: [], links: [
        { id: 'url:1234567890abcdef', title: 'Specific source', url: 'https://new-source.example.org/research' },
        { id: 'url:1234567890abcdef', title: 'Unsafe', url: 'javascript:alert(1)' }
      ], conversation: 'saved-context' } });
    });
    await page.goto('http://127.0.0.1:4000/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('.page-agent-send')?.disabled);
    await page.locator('.page-agent-form textarea').fill('Read these sources together');
    const before = await page.evaluate(() => ({ y: scrollY, expanded: [...document.querySelectorAll('details')].map(node => node.open) }));
    await page.locator('.page-agent-send').click();
    await page.waitForFunction(() => !document.querySelector('.page-agent-send').disabled);
    assert.equal(requests, 2); assert.equal(continuation.state, 'opaque-batch-token'); assert.equal(continuation.result.ok, true);
    assert.ok((await page.locator('.page-agent-current').innerText()).includes('PARALLEL · 3 operations'));
    assert.equal(await page.locator('.page-agent-current .page-agent-sources a').count(), 1);
    assert.equal(await page.locator('.page-agent-current .page-agent-sources a').getAttribute('href'), 'https://new-source.example.org/research');
    const after = await page.evaluate(() => ({ y: scrollY, expanded: [...document.querySelectorAll('details')].map(node => node.open) }));
    assert.deepEqual(after.expanded, before.expanded); assert.ok(Math.abs(after.y - before.y) < 2);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('.page-agent-history .page-agent-sources a').getAttribute('href'), 'https://new-source.example.org/research');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ parallelProgress: true, silentReading: true, urlCitations: true, restoredCitations: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
