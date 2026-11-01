/**
 * ROADMAP P0-05 acceptance (D38): "Chrome reports the app as installable
 * (Playwright reads the manifest and checks the installability fields and
 * icons; a manual check of the Install prompt on desktop Chrome and Edge is
 * recorded), and the installed window shows the same safety bar and version
 * chip." The manual record is docs/ops/install-check.md.
 */
import { expect, test } from './fixtures.ts';
import { w1, w2Label, w7 } from '../../../packages/safety/src/strings.ts';
import { PAGES, ready } from './helpers.ts';

interface Icon { src: string; sizes: string; type: string; purpose: string }

test('every page links the manifest', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  }
});

test('the manifest is served same-origin with the installability fields and loadable icons', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^application\/(manifest\+)?json/);
  const manifest = (await res.json()) as Record<string, unknown> & { icons: Icon[] };
  expect(manifest).toMatchObject({ name: 'Synthetos Run', start_url: '/', scope: '/', display: 'standalone' });
  for (const icon of manifest.icons) {
    const img = await request.get(icon.src);
    expect(img.status(), icon.src).toBe(200);
    expect(img.headers()['content-type'], icon.src).toBe('image/png');
  }
});

test('Chrome parses the manifest without errors and reports no installability errors', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  const manifest = (await cdp.send('Page.getAppManifest')) as { url: string; errors: { message: string }[]; data?: string };
  expect(manifest.url).toMatch(/\/manifest\.webmanifest$/);
  expect(manifest.errors).toEqual([]);
  // Chrome fetches the icons asynchronously; poll until its verdict settles.
  await expect
    .poll(async () => ((await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] }).installabilityErrors.map((e) => e.errorId), {
      timeout: 15_000,
    })
    .toEqual([]);
});

/**
 * Chromium cannot emulate `display-mode: standalone` (CDP has no such media
 * feature), so the installed window is covered in two parts: here, proof that
 * nothing on the page can render differently in standalone mode (no
 * stylesheet rule and no script depends on display-mode, and the bar shows);
 * and the manual check recorded in docs/ops/install-check.md.
 */
test('nothing depends on display-mode, so an installed window shows the same safety bar and version chip', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const dependsOnDisplayMode = await page.evaluate(async () => {
    const rules: string[] = [];
    const walk = (list: CSSRuleList): void => {
      for (const rule of list) {
        rules.push(rule.cssText);
        if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules);
    const scripts = await Promise.all([...document.querySelectorAll('script[src]')].map((s) => fetch((s as HTMLScriptElement).src).then((r) => r.text())));
    return { css: rules.filter((r) => r.includes('display-mode')), js: scripts.filter((t) => t.includes('display-mode')).length };
  });
  expect(dependsOnDisplayMode).toEqual({ css: [], js: 0 });
  const bar = page.locator('[data-region="safety-bar"]');
  await expect(bar.locator('[data-safety="W1"]')).toHaveText(w1());
  await expect(bar.locator('[data-safety="W7"]')).toHaveText(w7());
  await expect(bar.locator('[data-version]')).toBeVisible();
  await expect(bar.getByRole('button', { name: w2Label() })).toBeDisabled();
});
