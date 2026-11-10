/**
 * ROADMAP TB-03 in the browser: the offline G-code preview loads a file
 * through `gcode.worker`, shows W13 pinned, a drawing (3D, or the 2D
 * fallback), the scrubber and the list; coarse detail keeps drawing; Cancel stops
 * a load; nothing offers Simulate or Animate, and Play is offered only as the play preview with a file open
 * (T-S41, amended 2026-11-09 by the owner, OD-25; play.e2e.ts covers Play itself).
 */
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';
import { w13 } from '../../../packages/safety/src/strings.ts';
import { ready } from './helpers.ts';

const CLEAN = fileURLToPath(new URL('../../../test-fixtures/cam/19-clean-job.nc', import.meta.url));
const SIMULATE = /\b(simulat|animat)/i;
const PLAY = /\bplay\b/i;

/** No Simulate or Animate ever; Play only as the play preview's own button, and only with a file open. */
async function expectNoPlay(page: import('@playwright/test').Page, fileOpen: boolean): Promise<void> {
  await expect(page.getByRole('button', { name: SIMULATE })).toHaveCount(0);
  await expect(page.getByRole('link', { name: SIMULATE })).toHaveCount(0);
  expect(await page.locator('[data-region="preview"]').innerText()).not.toMatch(SIMULATE);
  const plays = page.locator('[data-region="preview"]').getByRole('button', { name: PLAY });
  if (fileOpen) await expect(plays).toHaveAttribute('data-action', 'play-toggle');
  else await expect(plays).toHaveCount(0);
}

test('a file loads into the preview: W13 pinned, drawing, scrubber, list, and no Play or Simulate', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await expect(sheet.locator('[data-safety="W13"]')).toHaveText(w13());
  await expectNoPlay(page, false);

  await sheet.locator('[data-preview="file"]').setInputFiles(CLEAN);
  await sheet.locator('[data-job-step="check"]').click();
  await expect(sheet.locator('[data-preview="summary"]')).toBeVisible();
  await expect(sheet.locator('[data-preview="canvas"], [data-preview="svg"]')).toHaveCount(1);
  await expect(sheet.locator('[data-preview="list"] [role="listitem"]').first()).toBeVisible();
  const scrubber = sheet.locator('[data-preview="scrubber"]');
  await scrubber.fill('2');
  await expect(sheet.locator('[data-preview="scrub-line"]')).toHaveText(/^file line \d+$/);
  await expect(sheet.locator('[data-preview="list"] [data-highlight="true"]').first()).toBeVisible();
  await expectNoPlay(page, true);
  // The page's workers: the preview's, the machine's, and the stock carving's (tool-sim slice 2), none other.
  expect(page.workers().map((w) => new URL(w.url()).pathname.split('/').pop()?.split('-')[0]).sort()).toEqual(['carve.worker', 'gcode.worker', 'machine.worker']);

  const axe = await new AxeBuilder({ page }).include('[data-region="preview"]').analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('Detail changes reuse the parsed file and keep drawing', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  // The preview options are an Advanced setting.
  await page.locator('[data-action="ui-level-advanced"]').click();
  await sheet.locator('[data-preview="mode"]').selectOption('lite');
  await sheet.locator('[data-preview="file"]').setInputFiles(CLEAN);
  await sheet.locator('[data-job-step="check"]').click();
  await expect(sheet.locator('[data-preview="summary"]')).toBeVisible();
  await expect(sheet.locator('[data-preview="drawing"]')).toBeVisible();
  const worker = page.workers().find(w => w.url().includes('gcode.worker'));
  expect(worker).toBeDefined();
  let newWorkers = 0;
  page.on('worker', w => { if (w.url().includes('gcode.worker')) newWorkers++; });
  for (const mode of ['full', 'auto', 'lite']) {
    await sheet.locator('[data-preview="mode"]').selectOption(mode);
    await expect(sheet.locator('[data-preview="drawing"]')).toBeVisible();
    expect(page.workers().includes(worker!)).toBe(true);
  }
  expect(newWorkers).toBe(0);
  await expect(sheet.locator('[data-preview="list"]')).toBeVisible();
  await expectNoPlay(page, true);
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
