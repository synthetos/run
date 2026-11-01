/**
 * ROADMAP TB-03 in the browser: the offline G-code preview loads a file
 * through `gcode.worker`, shows W13 pinned, a drawing (3D, or the 2D
 * fallback), the scrubber and the list; lite mode draws nothing; Cancel stops
 * a load; and no element offers Play or Simulate (T-S41).
 */
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';
import { w13 } from '../../../packages/safety/src/strings.ts';
import { ready } from './helpers.ts';

const CLEAN = fileURLToPath(new URL('../../../test-fixtures/cam/19-clean-job.nc', import.meta.url));
const PLAY = /\b(play|simulat|animat)/i;

async function expectNoPlay(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByRole('button', { name: PLAY })).toHaveCount(0);
  await expect(page.getByRole('link', { name: PLAY })).toHaveCount(0);
  expect(await page.locator('[data-region="preview"]').innerText()).not.toMatch(PLAY);
}

test('a file loads into the preview: W13 pinned, drawing, scrubber, list, and no Play or Simulate', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await expect(sheet.locator('[data-safety="W13"]')).toHaveText(w13());
  await expectNoPlay(page);

  await sheet.locator('[data-preview="file"]').setInputFiles(CLEAN);
  await expect(sheet.locator('[data-preview="summary"]')).toBeVisible();
  await expect(sheet.locator('[data-preview="canvas"], [data-preview="svg"]')).toHaveCount(1);
  await expect(sheet.locator('[data-preview="list"] [role="listitem"]').first()).toBeVisible();
  const scrubber = sheet.locator('[data-preview="scrubber"]');
  await scrubber.fill('2');
  await expect(sheet.locator('[data-preview="scrub-line"]')).toHaveText(/^file line \d+$/);
  await expect(sheet.locator('[data-preview="list"] [data-highlight="true"]').first()).toBeVisible();
  await expectNoPlay(page);
  expect(page.workers().map((w) => new URL(w.url()).pathname.split('/').pop()?.split('-')[0]).sort()).toEqual(['gcode.worker', 'machine.worker']);

  const axe = await new AxeBuilder({ page }).include('[data-region="preview"]').analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('lite mode lists and summarises without drawing', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await sheet.locator('[data-preview="mode"]').selectOption('lite');
  await sheet.locator('[data-preview="file"]').setInputFiles(CLEAN);
  await expect(sheet.locator('[data-preview="lite"]')).toBeVisible();
  await expect(sheet.locator('[data-preview="drawing"]')).toHaveCount(0);
  await expect(sheet.locator('[data-preview="list"]')).toBeVisible();
  await expectNoPlay(page);
});

test('Cancel stops a load at once', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  const big = Buffer.from('G21 G90\n' + 'G1 X10 Y5 F800\nG1 X0 Y0\n'.repeat(400_000));
  await sheet.locator('[data-preview="file"]').setInputFiles({ name: 'big.nc', mimeType: 'text/plain', buffer: big });
  const cancel = sheet.locator('[data-preview="cancel"]');
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(sheet.locator('[data-preview="progress"]')).toHaveCount(0, { timeout: 1000 });
  await expect(sheet.locator('[data-preview="summary"]')).toHaveCount(0);
  await expect(sheet.locator('[data-preview="file-name"]')).toHaveText('none');
});
