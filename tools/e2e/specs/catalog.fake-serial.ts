import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
for (const theme of ['light', 'dark'] as const) {
  test(`catalog page and editable draft in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 }); await page.goto('/'); await ready(page);
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.locator('[data-region="rail"] [data-view="library"]').click();
    await expect(page.locator('#library-tab-tools')).toHaveText('My tools');
    await page.locator('#library-tab-catalog').click(); const catalog = page.locator('.catalog-view');
    await expect(catalog).toContainText('Shared catalog, maintained by Synthetos');
    await catalog.getByRole('button', { name: '1/4"', exact: true }).click();
    await catalog.getByLabel('Maker', { exact: true }).selectOption('Onsrud');
    await expect(catalog.locator('tbody tr')).toHaveCount(16);
    await catalog.getByLabel('Type', { exact: true }).selectOption('ball'); await expect(catalog.locator('tbody tr')).toHaveCount(2);
    await catalog.getByLabel('Type', { exact: true }).selectOption('');
    await catalog.getByRole('button', { name: 'in', exact: true }).click();
    const dir = resolve('../../logs'); await mkdir(dir, { recursive: true });
    expect(await catalog.locator('.tool-table-wrap').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    for (const index of [0, 1]) {
      const stripe = catalog.locator('tbody tr').nth(index);
      await page.mouse.move(0, 0);
      const before = await stripe.evaluate(el => getComputedStyle(el).backgroundColor);
      await stripe.hover();
      expect(await stripe.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(before);
    }
    await catalog.getByLabel('Search catalog').fill('absent'); await expect(catalog).toContainText('No matching tools.');
    await catalog.getByLabel('Search catalog').fill('52-280');
    const row = catalog.locator('[data-catalog-part="52-280"]');
    await expect(row.getByRole('link', { name: 'Onsrud page' })).toHaveAttribute('href', 'https://onsrud.com/Products/52280.asp');
    await row.locator('td').first().click(); const modal = catalog.getByRole('dialog');
    await expect(modal.locator('h2')).toContainText('Onsrud 52-280');
    await expect(modal.locator('[data-tool-field="number"]')).toHaveCount(0);
    await expect(modal.locator('[data-tool-field="diameter"]')).toBeDisabled();
    await expect(modal.locator('[data-action="tool-delete"]')).toHaveCount(0);
    await page.screenshot({ path: `${dir}/catalog-preview-${theme}.png` });
    await modal.getByRole('tab', { name: 'Details', exact: true }).click();
    await expect(modal.locator('[data-tool-field="name"]')).toBeDisabled();
    await modal.getByRole('tab', { name: 'Where to buy' }).click();
    await expect(modal.locator('[data-action="add-link"]')).toHaveCount(0);
    // Blur to body: Escape still dismisses, then restores the row that opened the preview.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur()); await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0); await expect(row).toBeFocused();
    await row.press('Space'); await expect(modal).toBeVisible();
    await modal.locator('[data-action="catalog-add"]').click();

    await expect(modal.locator('.catalog-banner')).toHaveText('From the Onsrud catalog: 52-280, 1/4" up-cut spiral. It becomes T7. Change anything before you add it.');
    await expect(modal.locator('[data-tool-field="number"]')).toHaveValue('7');
    await expect(modal.getByRole('tab', { name: 'From catalog' })).toHaveCount(0);

    await modal.getByRole('button', { name: 'Back to catalog' }).click();
    await expect(row.getByRole('button', { name: 'Add to my tools' })).toBeVisible();
    await row.getByRole('button', { name: 'Add to my tools' }).click();
    await modal.locator('#tool-tab-cutting').click();
    await expect(modal.getByRole('link', { name: 'Onsrud 2025 catalog, p. 129' })).toHaveAttribute('href', /#page=129$/);
    await expect(modal).toContainText('0.007 – 0.009');
    await expect(modal).not.toContainText('Surface speed');

    await modal.getByRole('button', { name: 'mm', exact: true }).click();
    await expect(modal).toContainText('0.1778 – 0.2286');
    await modal.getByRole('button', { name: 'in', exact: true }).click();
    await expect(modal).toContainText('Onsrud publishes chipload ranges at a cut depth of one tool diameter. It publishes no spindle speeds for these tools.');
    await modal.locator('[data-action="cancel-tool"]').click();
    await row.getByRole('button', { name: 'Add to my tools' }).click();
    await modal.locator('[data-tool-field="number"]').fill('9');
    await expect(modal.locator('.catalog-banner')).toContainText('It becomes T9.');
    await modal.locator('[data-action="save-tool"]').click(); await expect(row).toContainText('In your tools as T9');
    await expect(row.getByRole('button', { name: 'Add to my tools' })).toHaveCount(0);
    await row.focus(); await row.press('Enter');
    await expect(modal).toContainText('In your tools as T9');
    await modal.getByRole('button', { name: 'Open T9', exact: true }).click();
    await expect(modal.locator('h2')).toContainText('Edit T9');
    await modal.locator('[data-tool-field="diameter"]').fill('0.3');
    await page.evaluate(() => (document.activeElement as HTMLElement).blur()); await page.keyboard.press('Escape');
    await expect(modal).toContainText('Discard your changes?');
    if (theme === 'light') await page.screenshot({ path: `${dir}/catalog-discard.png` });
    await modal.getByRole('button', { name: 'Keep editing' }).click();
    await expect(modal.locator('[data-tool-field="diameter"]')).toHaveValue('0.3');
    const wrap = catalog.locator('.dialog-wrap'); const outside = await wrap.boundingBox();
    if (outside === null) throw new Error('missing backdrop');
    await page.mouse.click(outside.x + outside.width / 2, outside.y + outside.height - 30);
    await expect(modal).toContainText('Discard your changes?');
    await modal.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(modal).toHaveCount(0); await expect(row).toBeFocused();

    await page.locator('#library-tab-tools').click(); await page.locator('[data-action="add-tool"]').click();
    const blank = page.locator('.tools-view').getByRole('dialog'); await expect(blank.locator('.catalog-banner')).toHaveCount(0);
    await blank.locator('#tool-tab-buy').click(); await expect(blank.getByRole('link', { name: /Onsrud/ })).toHaveCount(0);
    // A press beginning inside cannot dismiss when released outside.
    const bounds = await blank.boundingBox(); const shade = await page.locator('.tools-view .dialog-wrap').boundingBox();
    if (bounds === null || shade === null) throw new Error('missing tool window');
    await page.mouse.move(bounds.x + 15, bounds.y + 15); await page.mouse.down();
    await page.mouse.move(shade.x + shade.width / 2, shade.y + shade.height - 30); await page.mouse.up(); await expect(blank).toBeVisible();
    await page.mouse.click(shade.x + shade.width / 2, shade.y + shade.height - 30); await expect(blank).toHaveCount(0);
    await page.locator('[data-action="add-tool"]').click();
    await blank.locator('[data-tool-field="number"]').fill('12'); await page.keyboard.press('Escape');
    await expect(blank).toContainText('Discard your changes?'); await blank.getByRole('button', { name: 'Discard', exact: true }).click();

  });
}

test('offline catalog retry leaves My tools available and uses only its same-origin endpoint', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/catalog/tools', async route => { requests++; await route.abort('internetdisconnected'); });
  await page.goto('/'); await ready(page);
  await page.locator('[data-region="rail"] [data-view="library"]').click();
  await page.locator('#library-tab-tools').click();
  await expect(page.locator('[data-action="add-tool"]')).toBeVisible(); expect(requests).toBe(0);
  await page.locator('#library-tab-catalog').click();
  const catalog = page.locator('.catalog-view');
  await expect(catalog).toContainText('The catalog could not load. Check your connection and try again.');
  await page.unroute('**/api/catalog/tools'); await catalog.getByRole('button', { name: 'Retry' }).click();
  await expect(catalog.locator('tbody tr')).toHaveCount(30);
  await page.locator('#library-tab-tools').click(); await page.locator('[data-action="add-tool"]').click();
  await expect(page.locator('.tools-view').getByRole('dialog')).toBeVisible();
  await page.locator('[data-action="cancel-tool"]').click();
});
