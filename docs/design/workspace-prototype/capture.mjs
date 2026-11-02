// Capture and check the design study with the repository's Playwright.
// No hardware, no serial ports, no workers, loopback only.
//   node docs/design/workspace-prototype/capture.mjs --output /abs/dir
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../tools/e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('--url', 'http://127.0.0.1:8766/docs/design/workspace-prototype/');
const out = arg('--output');
if (!out) throw new Error('--output /absolute/dir is required');
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Loopback only');
mkdirSync(out, { recursive: true });

const sizes = [[1280, 720], [1440, 900], [1920, 1080], [390, 844]];
const DXF = ['0', 'SECTION', '2', 'ENTITIES',
  '0', 'LWPOLYLINE', '90', '6', '70', '1', '10', '0', '20', '0', '10', '320', '20', '0', '10', '320', '20', '150', '10', '250', '20', '220', '10', '0', '20', '220', '10', '0', '20', '0',
  ...[[30, 30], [290, 30], [30, 190], [215, 190], [160, 110], [290, 120]].flatMap(([x, y]) => ['0', 'CIRCLE', '10', String(x), '20', String(y), '40', '4']),
  '0', 'ENDSEC', '0', 'EOF'].join('\n');
const results = [];
const assert = (cond, msg) => { if (!cond) throw new Error(`Check failed: ${msg}`); };

const browser = await chromium.launch();
for (const [width, height] of sizes) {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1, acceptDownloads: false });
    const errors = []; const external = [];
    await context.route('**/*', (route) => { if (new URL(route.request().url()).host !== new URL(url).host) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { window.cspViolations = []; document.addEventListener('securitypolicyviolation', (e) => window.cspViolations.push(e.violatedDirective)); });
    await page.goto(`${url}#run`);
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; window.reviewDocument = 'unchanged'; }, theme);
    await page.evaluate(() => document.fonts.ready);
    const api = (js) => page.evaluate(js);
    const states = new Set(['disconnected', 'identified', 'idle', 'outdated', 'running', 'toolchange', 'held', 'lost', 'orphaned']);
    async function capture(name) {
      if (!states.has(name)) await api("document.querySelector('#toast').textContent = ''");
      await page.waitForTimeout(350);
      assert(await api('window.reviewDocument') === 'unchanged', 'the document never reloads');
      const b = await api('({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight})');
      assert(b.w <= b.iw && b.h <= b.ih, `no document scroll (${width} ${theme} ${name} ${JSON.stringify(b)})`);
      for (const sel of ['#pause', '#stop', '.warning']) {
        const box = await page.locator(sel).boundingBox();
        assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 0.5 && box.y + box.height <= height, `${sel} visible in ${name} at ${width} ${theme} ${JSON.stringify(box)}`);
      }
      assert(await page.locator('#pause').isEnabled() && await page.locator('#stop').isEnabled(), `Pause and Stop enabled in ${name}`);
      assert((await page.locator('#pause').innerText()).trim() === 'Pause', 'Pause label (OD-6)');
      assert((await page.locator('#stop').innerText()).trim() === 'Stop job', 'Stop label (OD-6)');
      const file = `${width}-${theme}-${name}.png`;
      await page.screenshot({ path: join(out, file) });
      results.push({ viewport: [width, height], theme, screen: name, screenshot: file });
    }
    // Run in every machine state.
    for (const state of ['disconnected', 'identified', 'idle', 'outdated', 'running', 'toolchange', 'held', 'lost', 'orphaned']) {
      await page.selectOption('#scenario', state);
      if (state === 'identified') { await page.click('.dock-tabs [data-tab="gcode"]'); }
      if (state === 'disconnected' || state === 'orphaned') assert((await page.locator('.dro-row strong').first().innerText()) === '—', 'unknown positions are dashes');
      if (state === 'outdated') { assert(await page.locator('#dialog-wrap').isVisible(), 'outdated firmware opens the update panel'); }
      if (state === 'running') {
        await page.click('#pause');
        assert((await page.locator('#machine-state').innerText()) === 'Job running', 'Pause feedback never fakes a state');
        assert((await page.locator('#toast').innerText()).includes('Waiting for the controller'), 'Pause delivery feedback');
        await page.selectOption('#scenario', 'running');
        assert(await page.locator('#live-grid').isVisible(), 'live job console visible while running');
      }
      if (state === 'held') assert((await page.locator('#machine-state').innerText()) === 'Paused · spindle still on', 'OD-6 paused wording');
      if (state === 'toolchange') assert(await page.locator('#sec-toolchange').isVisible(), 'tool-change card');
      await capture(state);
      if (state === 'outdated') {
        await page.keyboard.press('Escape');
        assert(await page.locator('#dialog-wrap').isHidden(), 'Escape closes the panel');
        assert((await page.locator('#machine-state').innerText()) === 'Firmware out of date', 'Escape pauses without changing state');
      }
    }
    await page.selectOption('#scenario', 'idle');
    // Setup: import a fixture drawing and change the stock.
    await page.locator('.rail [data-view="setup"]').click();
    await page.setInputFiles('#fixture-file', { name: 'fixture-plate-b.dxf', mimeType: 'application/dxf', buffer: Buffer.from(DXF) });
    await page.waitForFunction(() => document.querySelector('#fixture-meta').textContent.includes('fixture-plate-b'), null, { timeout: 5000 }).catch(() => {});
    const meta = await page.locator('#fixture-meta').innerText();
    assert(meta.includes('6 holes'), `DXF fixture import (${meta})`);
    await page.fill('#st-thick', '8');
    assert((await page.locator('#h-stock').innerText()) === '39.00', 'stock height follows thickness');
    await capture('setup');
    await page.fill('#st-thick', '6.35');
    await page.locator('.rail [data-view="tools"]').click();
    await page.locator('#tool-rows tr').nth(3).click();
    assert((await page.locator('#tool-title').innerText()).startsWith('T4'), 'tool selection');
    await capture('tools');
    await page.locator('.rail [data-view="configure"]').click();
    await page.selectOption('#connector-select', 'motor1');
    await page.fill('#motor-travel', '20');
    assert((await page.locator('#mechanical-story').innerText()).includes('80 steps/mm'), 'motor arithmetic');
    await capture('board');
    await page.click('[data-ctab="firmware"]');
    await capture('firmware');
    await page.click('[data-ctab="backups"]');
    await page.click('[data-against="live"]');
    assert((await page.locator('#diff-table tbody tr').count()) === 2, 'backup against live diff');
    await capture('backups');
    await page.click('[data-ctab="wiring"]');
    await page.locator('.rail [data-view="machines"]').click();
    assert((await page.locator('.machine-card').count()) === 6, 'six catalogue drawings');
    await capture('machines');
    await page.fill('#machine-search', 'Shapeoko');
    assert((await page.locator('.machine-card').count()) === 1, 'machine search');
    await page.click('[data-fork="Shapeoko"]');
    await page.click('#dialog-action');
    assert((await page.locator('#my-machine-name').innerText()) === 'My Shapeoko', 'machine copy');
    assert((await page.locator('#machine-name').innerText()) === 'Workshop router · TinyG v8 · simulated', 'a copy never retargets the connection');
    await page.fill('#machine-search', '');
    await page.locator('.rail [data-view="projects"]').click();
    await capture('projects');
    await page.locator('.rail [data-view="analyze"]').click();
    assert((await page.locator('#advisor-rows tr[aria-selected="true"] .tag').innerText()) === 'Too aggressive', 'advisor flags the pocket');
    await capture('analyze');
    await page.locator('.rail [data-view="run"]').click();
    await page.click('#account-button');
    assert(await page.locator('#account-menu').isVisible(), 'account menu');
    await capture('account');
    await page.keyboard.press('Escape');
    await page.goBack();
    assert(await page.locator('[data-screen="analyze"]').isVisible(), 'Back keeps the single page');
    assert(await api('window.reviewDocument') === 'unchanged', 'document unchanged at the end');
    assert(page.workers().length === 0, 'no workers');
    const csp = await api('window.cspViolations');
    assert(csp.length === 0, `no CSP violations: ${csp}`);
    assert(errors.length === 0, `no page errors: ${errors.join(' | ')}`);
    assert(external.length === 0, `no external requests: ${external}`);
    await context.close();
  }
}
await browser.close();

const checks = 'Nine machine states (incl. firmware gate, tool change, live job), setup with DXF fixture import, tools, board wiring/firmware/backups, machines, projects, advisor, account menu; no document scroll; warning, Pause and Stop visible, enabled and labelled per OD-6 in every capture; Pause/Escape never fake state; no reloads, workers, external requests, page errors or CSP violations.';
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify({ screenshots: results, checks }, null, 2)}\n`);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const screens = [...new Set(results.map((r) => r.screen))];
const sections = screens.map((screen) => `<section><h2>${esc(screen)}</h2><div class="row">${results.filter((r) => r.screen === screen).map((r) => `<figure><a href="${r.screenshot}"><img loading="lazy" src="${r.screenshot}" alt="${esc(`${screen} at ${r.viewport[0]} px, ${r.theme}`)}"></a><figcaption>${r.viewport[0]} × ${r.viewport[1]} · ${r.theme}</figcaption></figure>`).join('')}</div></section>`).join('');
writeFileSync(join(out, 'review.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Run workspace · increment 2</title><style>
:root{--paper:#f6f8f9;--sheet:#fff;--ink:#15222c;--muted:#4f5f6a;--rule:#c7d2d9;--blue:#1d5aa6}
@media (prefers-color-scheme:dark){:root{--paper:#0d161d;--sheet:#131f28;--ink:#e4ebf0;--muted:#a1b0bb;--rule:#2c3d4a;--blue:#7db0f5}}
body{margin:0;padding:28px 16px 60px;background:var(--paper);color:var(--ink);font:14px/1.5 system-ui,sans-serif}main{max-width:1800px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}p{color:var(--muted);margin:0 0 24px;max-width:80ch}nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:28px}nav a{color:var(--blue);border:1px solid var(--rule);border-radius:14px;padding:2px 10px;text-decoration:none;background:var(--sheet)}
h2{font-size:17px;margin:28px 0 10px;text-transform:none}.row{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
figure{margin:0;background:var(--sheet);border:1px solid var(--rule);border-radius:6px;padding:8px}img{display:block;width:100%;height:190px;object-fit:contain;object-position:top}figcaption{font-size:12px;color:var(--muted);padding-top:6px}
</style><main><h1>Run workspace · increment 2</h1><p>${results.length} captures: ${screens.length} views, four sizes, light and dark. Every capture passed the checks: ${esc(checks)} Click a picture for full size.</p><nav>${screens.map((s) => `<a href="#${s}">${esc(s)}</a>`).join('')}</nav>${sections.replace(/<section><h2>([^<]+)<\/h2>/g, '<section id="$1"><h2>$1</h2>')}</main>`);
console.log(`PASS: ${results.length} screenshots and interaction checks in ${out}`);
