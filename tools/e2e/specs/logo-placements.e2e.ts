/**
 * The logo placements (docs/superpowers/specs/2026-11-16-first-run-design.md §4): the top bar lockup shows the run
 * wordmark beside "Synthetos" and hides it on phones; the tab icon is the n. RUN_SCREENSHOTS=1 writes the walkthrough
 * pictures to docs/design/screenshots/logo-placements/.
 */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';
const SCREENSHOTS = process.env['RUN_SCREENSHOTS'] === '1';
const SHOT_DIR = new URL('../../../docs/design/screenshots/logo-placements/', import.meta.url).pathname;
const SIGNED_IN = { account: { subject: 'usr_owner', display: '@owner', canConnect: true }, signIn: true };

for (const theme of ['light', 'dark'] as const) {
  test(`the top bar is crosshair, Synthetos and the wordmark; the wordmark hides on phones (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.route('**/api/session', (route) => route.fulfill({ json: SIGNED_IN }));
    await page.goto('/'); await ready(page);
    // Located by class, not by name: the accessible name changes when the wordmark hides, and a name locator that
    // matched nothing would let `toBeHidden` pass on an empty set.
    const brand = page.locator('.topbar .brand');
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute('href', '/');
    await expect(brand).toHaveAccessibleName('Synthetos Run');
    const wordmark = brand.locator('.brand-run svg');
    await expect(wordmark).toHaveAttribute('aria-label', 'Run');
    await expect(brand.locator('.crosshair')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute('href', '/icons/icon-32.png');
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 740 : 800 });
      await expect(brand).toBeVisible();
      if (width === 1280) await expect(wordmark).toBeVisible();
      else {
        await expect(wordmark).toBeHidden();
        await expect(brand).toHaveAccessibleName('Synthetos');
      }
      if (SCREENSHOTS) await page.locator('.topbar').screenshot({ path: `${SHOT_DIR}topbar-${theme}-${width}.png` });
    }
  });
}

test('the tab icon is the n mark', async ({ page, baseURL }) => {
  const icon = `${baseURL}/icons/icon-32.png`;
  const app = `${baseURL}/icons/icon-192.png`;
  await page.setViewportSize({ width: 420, height: 260 });
  await page.setContent(
    `<body style="margin:0;padding:24px;background:#f6f8f9;font:13px system-ui;color:#15222c;display:flex;gap:32px;align-items:flex-end">` +
      `<figure style="margin:0;text-align:center"><img src="${icon}" width="32" height="32" alt=""><figcaption>tab, 32 px</figcaption></figure>` +
      `<figure style="margin:0;text-align:center"><img src="${icon}" width="128" height="128" alt="" style="image-rendering:pixelated"><figcaption>tab icon at 4×</figcaption></figure>` +
      `<figure style="margin:0;text-align:center"><img src="${app}" width="128" height="128" alt=""><figcaption>app icon, 192 px</figcaption></figure></body>`,
  );
  const images = page.locator('img');
  await expect(images).toHaveCount(3);
  for (const img of await images.all()) expect(await img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true);
  if (SCREENSHOTS) await page.screenshot({ path: `${SHOT_DIR}tab-icon.png` });
});

test('the sign-in dialog still shows the wordmark alone', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route('**/api/session', (route) => route.fulfill({ json: { account: null, signIn: true } }));
  await page.goto('/'); await ready(page);
  const dialog = page.locator('[data-gate="sign-in"]');
  await expect(dialog.getByRole('img', { name: 'run' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  if (SCREENSHOTS) await page.screenshot({ path: `${SHOT_DIR}gate-light-1280.png` });
});
