/**
 * Play preview (owner, 2026-11-09: "play preview should just play the gcode and the movements"; SAFETY H15 and
 * T-S41 amended, OD-25; T-S141): with a file open and no board, Play moves the preview tool along the moves at
 * programmed speeds, at 1×, 2×, 5× or 10×; a plain notice says it is not timed like the machine for as long as the
 * session is on; Pause and the scrubber work any time; under reduced motion it steps one move at a time instead.
 */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

// 40 short feeds at F6000 (0.1 s each at 1×), so the test sees the lines go by.
const FILE = ['G21 G90', 'T1 M6', 'G0 Z5', 'G0 X10 Y10', 'G1 Z-0.5 F300', ...Array.from({ length: 40 }, (_, i) => `G1 X${i % 2 === 0 ? 20 : 10} Y${(10 + i * 0.5).toFixed(1)} F6000`), 'G0 Z5', 'M30'].join('\n');

async function open(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await ready(page);
  await page.locator('[data-region="preview"] [data-preview="file"]').setInputFiles({ name: 'zigzag.nc', mimeType: 'text/plain', buffer: Buffer.from(FILE) });
  await expect(page.locator('[data-preview="file-name"]')).toHaveText('zigzag.nc');
}

test('Play runs the moves at programmed speeds with the notice; speeds, Pause, the scrubber and End preview work', async ({ page }) => {
  await open(page);
  const sheet = page.locator('[data-region="preview"]');
  const play = sheet.locator('[data-action="play-toggle"]');
  const notice = sheet.locator('[data-preview="play-notice"]');
  const line = sheet.locator('[data-preview="scrub-line"]');
  await expect(play).toHaveText('Play');
  await expect(notice).toHaveCount(0);
  await expect(sheet.locator('[data-play-speed="1"]')).toHaveAttribute('aria-pressed', 'true');
  await play.click();
  await expect(play).toHaveText('Pause');
  await expect(notice).toHaveText('Preview at programmed speeds: not timed like the machine');
  // The scrubber follows the lines done.
  await expect.poll(async () => Number(await sheet.locator('[data-preview="scrubber"]').inputValue()), { timeout: 10_000 }).toBeGreaterThan(8);
  await sheet.locator('[data-play-speed="10"]').click();
  await expect(sheet.locator('[data-play-speed="10"]')).toHaveAttribute('aria-pressed', 'true');
  await play.click();
  await expect(play).toHaveText('Play');
  // Paused: the notice stays while the session is on, and the scrubber moves the tool.
  await expect(notice).toBeVisible();
  const scrubber = sheet.locator('[data-preview="scrubber"]');
  await scrubber.fill('3');
  await expect(line).toHaveText('file line 3');
  await page.waitForTimeout(400);
  await expect(scrubber).toHaveValue('3');
  // At 10× it runs to the end and stops there.
  await play.click();
  await expect(play).toHaveText('Play', { timeout: 15_000 });
  await expect(scrubber).toHaveValue(await scrubber.getAttribute('max') ?? '');
  await sheet.locator('[data-action="play-stop"]').click();
  await expect(notice).toHaveCount(0);
});

test('under reduced motion Play does not run on its own: Next move steps one move at a time', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const sheet = page.locator('[data-region="preview"]');
  await expect(sheet.locator('[data-action="play-toggle"]')).toHaveCount(0);
  await expect(sheet.locator('[data-play-speed="1"]')).toHaveCount(0);
  const step = sheet.locator('[data-action="play-step"]');
  await step.click();
  await expect(sheet.locator('[data-preview="play-notice"]')).toBeVisible();
  const first = Number(await sheet.locator('[data-preview="scrubber"]').inputValue());
  await step.click();
  await expect.poll(async () => Number(await sheet.locator('[data-preview="scrubber"]').inputValue())).toBeGreaterThan(first);
});

test('no Play before a file is open', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.locator('[data-region="preview"] [data-preview="play"]')).toHaveCount(0);
});
