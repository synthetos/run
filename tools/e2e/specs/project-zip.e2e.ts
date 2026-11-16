import { expect, guardContext, test } from './fixtures.ts';
import { ready } from './helpers.ts';
import { stubFirmwareCatalog } from './firmwareCatalogFixture.ts';

for (const theme of ['light', 'dark']) test(`project zip opens in a fresh browser (${theme})`, async ({ page, browser, baseURL }, testInfo) => {
  await page.addInitScript(theme => localStorage.setItem('run.theme', theme), theme);
  await page.route('**/api/session', route => route.fulfill({ json: { account: null, signIn: true } }));
  await page.goto('/'); await ready(page);
  await page.locator('[data-region="rail"] [data-view="projects"]').click();
  await page.locator('[data-action="project-new"]').click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 24;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#b77945'; ctx.fillRect(0, 0, 24, 24);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('[data-project="file-input"]').setInputFiles([
    { name: 'plate.nc', mimeType: 'text/plain', buffer: Buffer.from('G21 G90\nG0 X12 Y8\nM2\n') },
    { name: 'plate.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
  ]);
  await expect(page.locator('[data-project-file="plate.nc"]')).toBeVisible();
  await expect(page.locator('.image-strip img')).toHaveCount(1);
  const downloading = page.waitForEvent('download');
  await page.locator('[data-action="project-download"]').click();
  const download = await downloading; expect(download.suggestedFilename()).toBe('Project 1.zip');
  const zip = testInfo.outputPath('Project 1.zip'); await download.saveAs(zip);
  const context = await browser.newContext({ ...(baseURL ? { baseURL } : {}), viewport: { width: 1440, height: 1000 } });
  const guard = await guardContext(context, baseURL);
  try {
    const fresh = await context.newPage(); await stubFirmwareCatalog(fresh);
    await fresh.addInitScript(theme => localStorage.setItem('run.theme', theme), theme);
    await fresh.route('**/api/session', route => route.fulfill({ json: { account: null, signIn: true } }));
    await fresh.goto('/'); await ready(fresh);
    await fresh.locator('[data-region="rail"] [data-view="projects"]').click();
    await expect(fresh.locator('[data-project-row]')).toHaveCount(0);
    await fresh.locator('[data-project="zip-input"]').setInputFiles(zip);
    await expect(fresh.locator('[data-project-row="Project 1"]')).toBeVisible();
    await expect(fresh.locator('[data-project-file="plate.nc"]')).toBeVisible();
    await expect(fresh.locator('.image-strip img')).toHaveCount(1);
    await fresh.screenshot({ path: testInfo.outputPath(`project-zip-${theme}.png`), animations: 'disabled', fullPage: true });
    await fresh.locator('[data-action="project-open"]').click();
    await expect(fresh.locator('[data-preview="file-name"]')).toHaveText('plate.nc');
    await fresh.reload(); await ready(fresh);
    await expect(fresh.locator('[data-preview="file-name"]')).toHaveText('plate.nc');
    await guard.assertClean();
  } finally { await context.close(); }
});
