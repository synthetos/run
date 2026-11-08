/**
 * ROADMAP P1-05 in the built release app (served like production, no
 * Access): signed out, Connect is refused with the account notice (B1) and nothing
 * is opened (D1); a `liveSession` marker left in `device-safety` shows W6 in
 * place of NOT CONNECTED (T-S17), and the W6 band passes axe.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

test('signed out on a release origin: Connect says accounts are coming soon and what works meanwhile, before the advisory or C1', async ({ page }) => {
  const advisory: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/safety-advisory.json')) advisory.push(r.url());
  });
  await page.goto('/');
  await ready(page);
  await page.locator('[data-action="connect"]').click();
  const refused = page.locator('[data-entry="refused"][data-refusal="signed-out"]');
  await expect(refused).toBeVisible();
  // No one can sign in on a release origin yet (B1, owner 2026-11-08): it says so and what works meanwhile, with Close.
  await expect(refused).toHaveAttribute('data-accounts', 'coming-soon');
  await expect(page.locator('#refused-title')).toHaveText('Connecting needs a Synthetos account');
  await expect(refused.getByRole('alert')).toContainText('Synthetos accounts are coming soon.');
  await expect(refused.locator('[data-account="works"] li')).toHaveCount(5);
  await expect(refused.locator('[data-account="wiring"]')).toHaveAttribute('href', '/wiring/');
  await expect(refused.locator('[data-action="dismiss"]')).toHaveText('Close');
  await expect(page.locator('[data-safety="C1"]')).toHaveCount(0);
  expect(advisory).toEqual([]);
  await refused.locator('[data-action="dismiss"]').click();
  await expect(refused).toHaveCount(0);
  await expect(page.locator('[data-region="strip-connection"] [data-action="connect"]')).toBeVisible();
});

test('T-S17 (OD-18): a liveSession marker from a previous session marks the strip; W6 waits for the connect', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('device-safety', 1);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ since: new Date().toISOString() }, 'liveSession');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
  await page.reload();
  await ready(page);
  await expect(page.locator('[data-region="machine-strip"] [data-state="previous-session"]')).toHaveCount(1);
  await expect(page.locator('[data-region="machine-strip"] [data-safety="W6"]')).toHaveCount(0);
  await expect(page.locator('[data-region="machine-strip"] [data-safety="W7"]')).toHaveCount(1);
  const axe = await new AxeBuilder({ page }).include('[data-region="safety-bar"]').include('[data-region="machine-strip"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [390, 1280] as const) {
    test(`the Connect control is a themed button in the Run view's connect card (${colorScheme}, ${width} px), axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      await ready(page);
      const connect = page.locator('[data-region="strip-connection"] [data-region="connect"] [data-entry="idle"] [data-action="connect"]');
      await expect(connect).toBeVisible();
      const style = await connect.evaluate((el) => {
        const s = getComputedStyle(el);
        const root = getComputedStyle(document.documentElement);
        return { bg: s.backgroundColor, border: Number.parseFloat(s.borderTopWidth), borderStyle: s.borderTopStyle, minHeight: s.minHeight, ink: root.getPropertyValue('--ink').trim() };
      });
      // Not the native grey control: the ink fill and a visible frame from the theme tokens.
      const hex = (rgb: string): string => `#${(rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
      expect(hex(style.bg)).toBe(style.ink);
      expect(style.border).toBeGreaterThanOrEqual(1);
      expect(style.borderStyle).toBe('solid');
      expect(style.minHeight).toBe('36px');
      const results = await new AxeBuilder({ page }).include('[data-region="connect"]').analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
