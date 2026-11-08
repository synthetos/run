/**
 * The carve during a job (docs/design/tool-sim.md, slice 3; fake-serial TEST build): a small job runs on the
 * simulated board and the 3D preview carves the stock to the line before the one the board reports executing.
 * The key's carve line carries `data-carved-through` (a file line), so the check reads no pixels: while the job
 * runs it never reaches the executing line, it moves forward with the board, and it holds when the job ends.
 *
 * The file has no tool change, so the tool already in the spindle is chosen in Analyze first (the carve uses
 * that statement, never a guess). The board is unhomed, so the carve is in the planned frame, as the path is.
 * With RUN_SCREENSHOTS_DIR set, the drawing mid-job is captured.
 */
import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { request } from './machineWorker.ts';
import { connect, open, phase, start } from './jobFlow.ts';

const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

/** A pass at Z -0.5 over the sample stock: 24 moves of 10 mm, about 0.75 s each on the simulated board. */
function passes(n: number): string {
  const lines = ['G21 G90', 'G0 X10 Y10', 'G1 Z-0.5 F300'];
  for (let i = 0; i < n; i++) lines.push(`G1 X${i % 2 === 0 ? 20 : 10} Y${(10 + i * 0.6).toFixed(1)} F800`);
  return `${[...lines, 'G0 Z5', 'M30'].join('\n')}\n`;
}

async function executing(worker: Worker): Promise<number | null> {
  const s = (await request(worker, { v: 3, kind: 'status' })) as { status: { session: { job: { executing: { line: number } | null } | null } } };
  return s.status.session.job?.executing?.line ?? null;
}

test('during a job the stock is carved to the line before the executing one, never further, and holds at the end', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, passes(24), 'passes.nc');
  // No tool change in the file: say which tool is in the spindle.
  await page.locator('[data-region="rail"] [data-view="analyze"]').click();
  for (const op of await page.locator('[data-screen="analyze"] [data-advisor-operation]').all()) await op.locator('[data-advisor-field="tool"]').selectOption('1');
  await page.locator('[data-region="rail"] [data-view="job"]').click();
  const carve = page.locator('[data-region="preview"] [data-scene="carve"]');
  // Before the job: the whole file, as a preview.
  await expect(carve).toHaveAttribute('data-carve-done', 'true');
  await expect(carve).toHaveAttribute('data-carve-lowest', '-0.500');

  await start(page);
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('running');
  const seen: number[] = [];
  let shotTaken = false;
  // Running, then draining (everything sent, the board still cutting), until the job is done.
  const deadline = Date.now() + 60_000;
  while ((await phase(worker)) !== 'done' && Date.now() < deadline) {
    // The carve first, then the board: the carve can only be behind a board that moved on in between.
    const carved = Number(await carve.getAttribute('data-carved-through'));
    const line = await executing(worker);
    if (line !== null) {
      expect(carved, `carved through line ${String(carved)} while the board executes line ${String(line)}`).toBeLessThan(line);
      seen.push(carved);
    }
    if (!shotTaken && SHOTS !== undefined && carved >= 12) {
      await page.locator('[data-preview="drawing"]').screenshot({ path: `${SHOTS}/carve-live-midjob.png` });
      shotTaken = true;
    }
    await page.waitForTimeout(150);
  }
  // It moved forward with the board, and never back.
  expect(Math.max(...seen)).toBeGreaterThanOrEqual(20);
  expect(seen.every((c, i) => i === 0 || c >= (seen[i - 1] as number))).toBe(true);
  await expect.poll(() => phase(worker), { timeout: 30_000 }).toBe('done');
  // Held at the last finished line once the page has the board's last report: it settles, never past the last
  // line of the file (M30, line 29), and stays there.
  const settled = async (): Promise<number | null> => {
    const a = await carve.getAttribute('data-carved-through');
    await page.waitForTimeout(700);
    return a === (await carve.getAttribute('data-carved-through')) ? Number(a) : null;
  };
  await expect.poll(settled, { timeout: 15_000 }).not.toBeNull();
  const held = Number(await carve.getAttribute('data-carved-through'));
  expect(held).toBeGreaterThanOrEqual(Math.max(...seen));
  expect(held).toBeLessThan(29);
  await expect(carve).toHaveAttribute('data-carve-done', 'true');
  await page.waitForTimeout(1000);
  await expect(carve).toHaveAttribute('data-carved-through', String(held));
});
