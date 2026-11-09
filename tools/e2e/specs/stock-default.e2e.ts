/** A new job's stock is MDF, not aluminium (first-time walk 2026-11-08, C14). */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

test('a fresh draft plans on MDF, and Analyze says so', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('[data-job-step="stock"]').click();
  const material = page.locator('[data-job-panel="stock"] select').filter({ hasText: 'MDF' }).first();
  await expect(material.locator('option:checked')).toHaveText('MDF');
  await page.locator('[data-region="rail"] [data-view="analyze"]').click();
  await expect(page.locator('[data-screen="analyze"]')).toContainText('Stock: MDF');
  await expect(page.locator('[data-screen="analyze"]')).not.toContainText('Aluminium');
});
