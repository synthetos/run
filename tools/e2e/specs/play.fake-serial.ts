/**
 * Play preview is never offered while a job runs (owner, 2026-11-09; SAFETY H15 and T-S41 amended, OD-25;
 * T-S142; fake-serial TEST build): with the simulated board idle, Play is offered; once the job starts the controls
 * go and a running preview stops; the live marker and the preview tool are never both a preview of the machine.
 */
import { expect, test } from './fixtures.ts';
import { connect, open, phase, start } from './jobFlow.ts';

function passes(n: number): string {
  const lines = ['G21 G90', 'G0 X10 Y10', 'G1 Z-0.5 F300'];
  for (let i = 0; i < n; i++) lines.push(`G1 X${i % 2 === 0 ? 20 : 10} Y${(10 + i * 0.6).toFixed(1)} F800`);
  return `${[...lines, 'G0 Z5', 'M30'].join('\n')}\n`;
}

test('Play is offered with the board idle, stops and goes when the job starts, and stays away while it runs', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, passes(30), 'passes.nc');
  const sheet = page.locator('[data-region="preview"]');
  const play = sheet.locator('[data-action="play-toggle"]');
  await expect(play).toHaveText('Play');
  await play.click();
  await expect(sheet.locator('[data-preview="play-notice"]')).toBeVisible();
  await start(page);
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toMatch(/^(running|draining|ending)$/);
  // Read both DOM markers together, then consult the worker only if they are present.
  // The job may finish and Play legitimately reappear between awaits; a phase read
  // before the DOM would mistake that transition for Play being offered during a job.
  const hiddenWhileActive = async (): Promise<boolean> => {
    const hidden = await sheet.evaluate(el => el.querySelector('[data-preview="play"], [data-preview="play-notice"]') === null);
    return hidden || (await phase(worker)) === 'done';
  };
  await expect.poll(hiddenWhileActive, { timeout: 5_000 }).toBe(true);
  // It stays away for the whole job.
  const deadline = Date.now() + 60_000;
  while ((await phase(worker)) !== 'done' && Date.now() < deadline) {
    expect(await hiddenWhileActive()).toBe(true);
    await page.waitForTimeout(500);
  }
  expect(await phase(worker)).toBe('done');
});
