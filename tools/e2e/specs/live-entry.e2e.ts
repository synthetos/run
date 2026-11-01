/**
 * ROADMAP P1-05 in the built release app (served like production, no
 * Access): signed out, Connect is refused with the sign-in text and nothing
 * is opened (D1); a `liveSession` marker left in `device-safety` shows W6 in
 * place of NOT CONNECTED (T-S17), and the W6 band passes axe.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';
import { w6 } from '../../../packages/safety/src/strings.ts';

test('signed out: Connect is refused with the sign-in text, before the advisory or C1', async ({ page }) => {
  const advisory: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/safety-advisory.json')) advisory.push(r.url());
  });
  await page.goto('/');
  await ready(page);
  await page.locator('[data-action="connect"]').click();
  const refused = page.locator('[data-entry="refused"][data-refusal="signed-out"]');
  await expect(refused).toBeVisible();
  await expect(refused.getByRole('alert')).toContainText('Sign in to connect.');
  await expect(page.locator('[data-safety="C1"]')).toHaveCount(0);
  expect(advisory).toEqual([]);
});

test('T-S17: a liveSession marker from a previous session shows W6 instead of NOT CONNECTED', async ({ page }) => {
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
  const band = page.locator('[data-region="safety-bar"] [data-safety="W6"]');
  await expect(band).toHaveText(w6());
  await expect(page.locator('[data-region="safety-bar"] [data-safety="W7"]')).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include('[data-region="safety-bar"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});
