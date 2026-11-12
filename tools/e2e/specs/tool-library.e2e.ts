import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test('tool drafts save atomically, cancel, fill gaps, convert units and delete inline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  page.on('dialog', () => { throw new Error('a browser dialog was opened'); });
  await page.goto('/'); await ready(page);
  await page.locator('[data-region="rail"] [data-view="library"]').click();
  await page.locator('#library-tab-tools').click();
  const view = page.locator('.tools-view'); const modal = view.getByRole('dialog');
  const add = view.locator('[data-action="add-tool"]');
  await add.click(); await expect(modal.locator('h2')).toHaveText('Add a tool');
  await expect(view.locator('tr[data-tool-row="7"]')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(add).toBeFocused();
  await add.click();
  await modal.getByRole('button', { name: 'in', exact: true }).click();
  const diameter = modal.locator('[data-tool-field="diameter"]');
  await diameter.fill('1/4junk'); await modal.locator('[data-action="save-tool"]').click();
  await expect(modal).toBeVisible(); await expect(view.locator('tr[data-tool-row="7"]')).toHaveCount(0);
  await diameter.fill('1/4'); await modal.locator('[data-action="save-tool"]').click();
  const row = view.locator('tr[data-tool-row="7"]');
  await expect(row).toContainText('T7 · 6.35 mm end mill'); await expect(row).toContainText('0.25 in');
  await row.focus(); await page.keyboard.press('Enter');
  await modal.locator('#tool-tab-details').click();
  await modal.locator('[data-tool-field="name"]').fill('Discard this');
  await modal.locator('[data-action="cancel-tool"]').click();
  await expect(row).toBeFocused(); await expect(row).not.toContainText('Discard this');
  await row.locator('.row-link').click(); await modal.locator('#tool-tab-details').click();
  await modal.locator('[data-tool-field="name"]').fill('My cutter');
  await modal.locator('[data-action="save-tool"]').click(); await expect(row).toContainText('My cutter');
  await view.locator('tr[data-tool-row="3"] .row-link').click();
  await modal.locator('[data-tool-field="number"]').fill('9'); await modal.locator('[data-action="save-tool"]').click();
  await add.click(); await expect(modal.locator('[data-tool-field="number"]')).toHaveValue('3');
  await modal.locator('[data-action="cancel-tool"]').click();
  await row.locator('.row-link').click(); await modal.locator('[data-action="tool-delete"]').click();
  await modal.locator('[data-action="tool-delete-cancel"]').click(); await expect(row).toHaveCount(1);
  await modal.locator('[data-action="tool-delete"]').click(); await modal.locator('[data-action="tool-delete-confirm"]').click();
  await expect(row).toHaveCount(0); await expect(add).toBeFocused();
  await page.reload(); await ready(page);
  await page.locator('[data-region="rail"] [data-view="library"]').click(); await page.locator('#library-tab-tools').click();
  await expect(view.locator('tr[data-tool-row="1"]')).toContainText('0.125 in');
});

for (const theme of ['light', 'dark'] as const) {
  test(`each tool tab fits 1280x720 in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/'); await ready(page);
    await page.locator('[data-region="rail"] [data-view="library"]').click(); await page.locator('#library-tab-tools').click();
    await page.locator('tr[data-tool-row="4"] .row-link').click();
    const modal = page.locator('.tool-modal');
    const dir = resolve('../../screens'); await mkdir(dir, { recursive: true });
    for (const tab of ['shape', 'details', 'buy', 'cutting']) {
      await modal.locator(`#tool-tab-${tab}`).click();
      await expect(modal.locator(`#tool-pane-${tab}`)).toBeVisible();
      expect(await modal.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await modal.locator(`#tool-pane-${tab}`).evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
      const box = await modal.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(720);
      await page.screenshot({ path: `${dir}/tool-${tab}-${theme}.png` });
    }
  });
}
