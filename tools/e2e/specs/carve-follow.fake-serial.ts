/**
 * The live carve keeps up with the tool (owner, 2026-11-09: "when removing the stock it lags; the bit passes
 * through it and then a few seconds later it disappears"; fake-serial TEST build). One long ramp is a single
 * line that takes seconds on the simulated board. The carve used to show it only once the line finished; now
 * the stock goes part way along it while the board is still on it, and never past the line it executes.
 */
import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { request } from './machineWorker.ts';
import { connect, open, phase, start } from './jobFlow.ts';

// Lines: 1 units, 2 a rapid over the stock, 3 down to the top (no cut), 4 a 100 mm ramp to 0.5 mm deep, 5 up, 6 end.
const RAMP = `${['G21 G90', 'G0 X10 Y10', 'G1 Z0 F300', 'G1 X110 Z-0.5 F600', 'G0 Z5', 'M30'].join('\n')}\n`;

async function executing(worker: Worker): Promise<number | null> {
  const s = (await request(worker, { v: 3, kind: 'status' })) as { status: { session: { job: { executing: { line: number } | null } | null } } };
  return s.status.session.job?.executing?.line ?? null;
}

test('the stock goes part way along a long line while the board is still on it', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, RAMP, 'ramp.nc');
  await page.locator('[data-region="rail"] [data-view="analyze"]').click();
  for (const op of await page.locator('[data-screen="analyze"] [data-advisor-operation]').all()) await op.locator('[data-advisor-field="tool"]').selectOption('1');
  await page.locator('[data-region="rail"] [data-view="job"]').click();
  const carve = page.locator('[data-region="preview"] [data-scene="carve"]');
  await expect(carve).toHaveAttribute('data-carve-done', 'true');
  await start(page);
  await expect.poll(() => executing(worker), { timeout: 15_000 }).toBe(4);
  // While the board executes the ramp (file line 4), the cut shows: deeper than the top, before the line ends.
  let partWay = false;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline && (await phase(worker)) !== 'done') {
    const lowest = Number(await carve.getAttribute('data-carve-lowest'));
    const through = Number(await carve.getAttribute('data-carved-through'));
    const line = await executing(worker);
    if (line === 4) {
      // Never past the line the board executes.
      expect(through).toBeLessThan(4);
      if (lowest < -0.05 && lowest > -0.49) partWay = true;
    }
    if (partWay) break;
    await page.waitForTimeout(100);
  }
  expect(partWay, 'the ramp was carved part way while the board was on it').toBe(true);
});
