import { expect, guardContext, test } from './fixtures.ts';
import { w1, w7, w13 } from '../../../packages/safety/src/strings.ts';

test('routine explanations stay in help, available by hover, focus and tap', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const safety = page.locator('[data-region="safety-bar"] [data-safety="W1"]');
  await expect(safety).toHaveText(w1());
  await expect(safety).toBeVisible();
  const connection = page.locator('[data-safety="W7"]');
  await expect(connection).toBeHidden();
  await page.getByRole('button', { name: 'About the disconnected state' }).hover();
  await expect(connection).toBeVisible();
  await page.getByRole('button', { name: 'About the disconnected state' }).focus();
  await page.keyboard.press('Escape');
  await expect(connection).toBeHidden();
  await page.mouse.move(600, 500);
  await page.getByRole('button', { name: 'About the preview', exact: true }).focus();
  await page.getByRole('button', { name: 'About the disconnected state' }).focus();
  await expect(page.locator('[data-safety="W7"]')).toHaveText(w7());
  await expect(page.locator('[data-safety="W7"]')).toBeVisible();
  await page.getByRole('button', { name: 'About the preview', exact: true }).click();
  await expect(page.locator('[data-safety="W13"]')).toHaveText(w13());
  await expect(page.locator('[data-safety="W13"]')).toBeVisible();
  await expect(safety).toBeVisible();
  // The spindle tab is in Advanced; Simple (the default, OD-13) shows one screen without tabs.
  await page.locator('[data-action="ui-level-advanced"]').click();
  await page.locator('.run-view [data-tab="spindle"]').click();
  await expect(page.locator('.sec-spindle .help-copy')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('workspace.png') });
  await page.locator('.sec-spindle').screenshot({ path: testInfo.outputPath('spindle.png') });
  await expect(page.locator('.sec-spindle')).not.toContainText('J6.');
  await page.getByRole('button', { name: 'About spindle and coolant readouts' }).click();
  await expect(page.locator('.sec-spindle .help-copy')).toBeVisible();
  const size = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
  expect(size.h).toBeLessThanOrEqual(size.ih);
  expect(size.w).toBeLessThanOrEqual(size.iw);
});

test('context help works without JavaScript and stays within a narrow screen', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
  const guard = await guardContext(context, baseURL);
  try {
    const page = await context.newPage();
    await page.goto(baseURL ?? '');
    await expect(page.locator('[data-region="safety-bar"] [data-safety="W1"]')).toBeVisible();
    await expect(page.locator('[data-safety="W7"]')).toBeHidden();
    await page.getByRole('button', { name: 'About the disconnected state' }).focus();
    await expect(page.locator('[data-safety="W7"]')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-region="stop-controls"] [data-action="stop-job"]')).toBeVisible();
    await guard.assertClean();
  } finally { await context.close(); }
});
