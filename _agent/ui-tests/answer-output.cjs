// Run with Playwright available on NODE_PATH; uses mocked agent responses, no API credit.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.route('**/api/health*', route => route.fulfill({ json: { ready: true, quota: { remaining: 20, limit: 20, resetAt: new Date(Date.now() + 86400000).toISOString() } } }));
    const markdown = '# Linxin Song\n\n**Research** in *language models*.\n\n- Agents\n  - Evaluation\n- Post-training\n\n> Grounded in the profile.\n\n| Topic | Focus |\n| --- | --- |\n| Agents | Computer use |\n\n```python\nif ready:\n    print("hello")\n```\n\n[Website](https://example.org/)\n\n' + ('A fast, readable overview of research. '.repeat(35));
    await page.route('**/api/agent', route => route.fulfill({ json: { type: 'answer', answer: markdown, sources: [], papers: [], links: [], conversation: '' } }));
    await page.goto(process.env.AGENT_TEST_URL || 'http://127.0.0.1:4000/', { waitUntil: 'networkidle' });
    await page.locator('.page-agent-send').waitFor({ state: 'visible' });
    const answer = page.locator('.page-agent-current .page-agent-answer');
    await page.locator('.page-agent-form textarea').fill('Tell me about Linxin');
    await page.locator('.page-agent-send').click();
    await page.waitForFunction(() => document.querySelector('.page-agent-answer.is-typing'));
    assert.ok((await answer.innerText()).length < markdown.length);
    await page.waitForFunction(() => !document.querySelector('.page-agent-answer.is-typing'));
    assert.equal(await answer.locator('h1').innerText(), 'Linxin Song');
    assert.equal(await answer.locator('strong').innerText(), 'Research');
    assert.equal(await answer.locator('ul ul li').innerText(), 'Evaluation');
    assert.equal(await answer.locator('table tbody td').count(), 2);
    assert.ok((await answer.locator('pre code').innerText()).includes('    print'));
    assert.equal(await answer.locator('a').getAttribute('rel'), 'noopener noreferrer');
    assert.equal(await answer.getAttribute('aria-busy'), 'false');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('.page-agent-history h1').innerText(), 'Linxin Song');
    assert.equal(await page.locator('.page-agent-history .is-typing').count(), 0);

    const checks = await page.evaluate(async () => {
      const target = document.createElement('div'); target.className = 'page-agent-answer'; document.querySelector('.page-agent').appendChild(target);
      window.agentOutput.render(target, '<script>window.markdownExecuted=1</script>\n\n<img src=x onerror="window.markdownExecuted=1">\n\n[bad](javascript:alert(1)) [data](data:text/html,test) [safe](https://example.org/)\n\n![image](https://example.org/tracker.png)');
      const safe = !target.querySelector('script,img,svg,iframe,style,form,[onerror]') && !window.markdownExecuted && Array.from(target.querySelectorAll('a')).every(a => a.protocol === 'https:');
      const controller = new AbortController();
      const animation = window.agentOutput.type(target, '**' + '研究👩🏽‍💻'.repeat(1000) + '**', { signal: controller.signal });
      const started = target.classList.contains('is-typing'); controller.abort(); await animation;
      const skipped = !target.classList.contains('is-typing') && target.textContent.trim() === '研究👩🏽‍💻'.repeat(1000);
      await window.agentOutput.type(target, '**Immediate**', { reducedMotion: true });
      const reduced = target.querySelector('strong').textContent === 'Immediate' && !target.classList.contains('is-typing');
      const before = performance.now(); await window.agentOutput.type(target, 'word '.repeat(2500));
      const duration = performance.now() - before;
      target.remove();
      return { safe, started, skipped, reduced, duration };
    });
    assert.ok(checks.safe); assert.ok(checks.started); assert.ok(checks.skipped); assert.ok(checks.reduced); assert.ok(checks.duration < 2200);
    await page.locator('.page-agent-form textarea').fill('Another overview');
    await page.locator('.page-agent-send').click();
    await page.getByRole('button', { name: 'Skip animation' }).click();
    await page.waitForFunction(() => !document.querySelector('.page-agent-send').disabled);
    assert.equal(await answer.locator('h1').innerText(), 'Linxin Song');
    assert.ok(!(await answer.innerText()).includes('Stopped.'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.page-agent').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.AGENT_TEST_SCREENSHOT) await page.screenshot({ path: path.resolve(process.env.AGENT_TEST_SCREENSHOT), fullPage: false });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ markdown: 'passed', history: 'passed', safeRendering: 'passed', animation: 'passed', mobile: 'passed', longAnswerMs: Math.round(checks.duration) }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
