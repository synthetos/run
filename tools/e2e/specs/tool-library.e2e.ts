/**
 * The tool library (first-time walk 2026-11-08, C1 and C16): Add a tool selects a new "T7 tool" and scrolls it into
 * view in its T-number place; the Name field renames it everywhere the row shows; Delete asks in the page (Cancel
 * keeps it), then removes it; renumbered tools stay in T-number order.
 */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

test('add, rename, sort and delete a tool, all in the page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  page.on('dialog', () => { throw new Error('a browser dialog was opened'); });
  await page.goto('/');
  await ready(page);
  await page.locator('[data-region="rail"] [data-view="library"]').click();
  await page.locator('#library-tab-tools').click();
  const view = page.locator('.tools-view');
  const inspector = view.locator('[aria-label="Selected tool"]');
  await view.locator('[data-action="add-tool"]').click();
  await expect(inspector.locator('h2')).toHaveText('T7 · T7 tool');
  const row = view.locator('tr[data-tool-row="7"]');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(row).toBeInViewport();
  // Rename it.
  const name = inspector.locator('[data-tool-field="name"]');
  await name.fill('60° V-bit');
  await name.press('Enter');
  await expect(inspector.locator('h2')).toHaveText('T7 · 60° V-bit');
  await expect(row).toContainText('T7 · 60° V-bit');
  // Renumber it to 3 after moving the seed T3 away: the list stays in T-number order.
  await view.locator('tr[data-tool-row="3"] .row-link').click();
  await inspector.locator('[data-tool-field="number"]').fill('9');
  await inspector.locator('[data-tool-field="number"]').press('Enter');
  await view.locator('tr[data-tool-row="7"] .row-link').click();
  await inspector.locator('[data-tool-field="number"]').fill('3');
  await inspector.locator('[data-tool-field="number"]').press('Enter');
  const order = await view.locator('tr[data-tool-row]').evaluateAll((rows) => rows.map((r) => Number(r.getAttribute('data-tool-row'))));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // Delete asks first; Cancel keeps it.
  await inspector.locator('[data-action="tool-delete"]').click();
  await expect(inspector.locator('[data-tool-delete="confirm"]')).toContainText('Delete T3 · 60° V-bit?');
  await inspector.locator('[data-action="tool-delete-cancel"]').click();
  await expect(view.locator('tr[data-tool-row="3"]')).toHaveCount(1);
  await inspector.locator('[data-action="tool-delete"]').click();
  await inspector.locator('[data-action="tool-delete-confirm"]').click();
  await expect(view.locator('tr[data-tool-row="3"]')).toHaveCount(0);
});
