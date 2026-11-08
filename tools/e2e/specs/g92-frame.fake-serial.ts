/**
 * The G92 frame in the built app (fake-serial TEST build): a job whose file sets its own G92 before it moves,
 * as braid_500mm.gcode does, run on the simulated edge-next board from machine 0, 0, 0. While a line runs:
 * - the "Tool at" readout is that line's programmed X, Y and Z (the board's work position, G92 included), with
 *   "G92 offset active";
 * - the tool handed to the drawing (`data-tool` on the drawing, in the toolpath's frame) lies on that line's
 *   segment as the preview drew it.
 * Before the fix the readout was the machine position minus the offsets read before the job, and the drawn tool
 * sat off its path by the G92 offset (the bench run of 2026-11-07). After M30 the board has dropped the G92, and
 * both still agree with the path.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { connect, open, phase, start } from './jobFlow.ts';
import { request } from './machineWorker.ts';

// G92 X5 Y-20 Z-1 at machine 0: the preview draws the program shifted by (-5, 20, 1), the board reports it unshifted.
const FILE = ['G21 G90', 'G92 X5 Y-20 Z-1', 'G0 Z1', 'G1 Z-1 F600', 'G1 X25 Y-20 F300', 'G1 X25 Y-40 F300', 'G0 Z1', 'M30', ''].join('\n');
const SHIFT = [-5, 20, 1] as const;

interface Sample {
  readonly line: number | null;
  readonly readout: string | null;
  readonly tool: readonly number[] | null;
}

/** The executing row, the readout and the drawn tool, read from one rendering. */
function sample(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    const row = document.querySelector('[data-executing="true"]');
    const tool = document.querySelector('[data-preview="drawing"]')?.getAttribute('data-tool') ?? null;
    return {
      line: row === null ? null : Number(row.getAttribute('data-line')),
      readout: document.querySelector('[data-preview="marker-readout"]')?.textContent ?? null,
      tool: tool === null ? null : tool.split(' ').map(Number),
    };
  });
}

/** "Tool at X a Y b Z c …" as numbers (true minus signs). */
function readoutXyz(text: string | null): number[] | null {
  const m = /^Tool at X (\S+) Y (\S+) Z (\S+)/.exec(text ?? '');
  return m === null ? null : [m[1], m[2], m[3]].map((v) => Number((v as string).replace('−', '-')));
}

/** A sample taken mid-segment of `line`, where the readout's `axis` is strictly inside (lo, hi). */
async function midSegment(page: Page, line: number, axis: 0 | 1, lo: number, hi: number): Promise<Sample> {
  let found: Sample | null = null;
  await expect.poll(async () => {
    const s = await sample(page);
    const p = readoutXyz(s.readout);
    if (s.line === line && p !== null && (p[axis] as number) > lo && (p[axis] as number) < hi && s.tool !== null) found = s;
    return found !== null;
  }, { timeout: 30_000, intervals: [50] }).toBe(true);
  return found as unknown as Sample;
}

test('a file with its own G92: the readout is the executing line’s coordinates and the drawn tool is on that line’s segment', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, FILE, 'g92.nc');

  // Before the job: the offset before the first line, so the tool is at the path's origin; the key says line 2 re-anchors the cut.
  await expect(page.locator('[data-preview="marker-readout"]')).toHaveText(/^Tool at X 0\.000 Y 0\.000 Z 0\.000 · /);
  await expect(page.locator('[data-preview="drawing"]')).toHaveAttribute('data-tool', '0.000 0.000 0.000');
  await expect(page.locator('[data-scene="note"]').filter({ hasText: 'Line 2 sets a temporary offset (G92)' })).toHaveCount(1);

  await start(page);

  // Line 5, G1 X25 Y-20: the readout is Y -20 and Z -1, as written; the tool is on the drawn segment (0, 0, 0)-(20, 0, 0).
  const a = await midSegment(page, 5, 0, 7, 23);
  const pa = readoutXyz(a.readout) as number[];
  expect(a.readout).toMatch(/^Tool at X \S+ Y −20\.000 Z −1\.000 · G92 offset active · /);
  const ta = a.tool as number[];
  expect(ta[0]).toBeCloseTo((pa[0] as number) + SHIFT[0], 2);
  expect(Math.abs(ta[1] as number)).toBeLessThan(0.01);
  expect(Math.abs(ta[2] as number)).toBeLessThan(0.01);
  expect(ta[0]).toBeGreaterThan(0);
  expect(ta[0]).toBeLessThan(20);

  // Line 6, G1 X25 Y-40: X 25 as written; the tool on (20, 0, 0)-(20, -20, 0).
  const b = await midSegment(page, 6, 1, -38, -22);
  const pb = readoutXyz(b.readout) as number[];
  expect(b.readout).toMatch(/^Tool at X 25\.000 Y \S+ Z −1\.000 · G92 offset active · /);
  const tb = b.tool as number[];
  expect(tb[0]).toBeCloseTo(20, 2);
  expect(tb[1]).toBeCloseTo((pb[1] as number) + SHIFT[1], 2);
  expect(Math.abs(tb[2] as number)).toBeLessThan(0.01);

  // After M30 the board has dropped the G92: the readout is the machine position less the saved offset (none), still the path's end.
  await expect.poll(() => phase(worker), { timeout: 30_000 }).toBe('done');
  await expect(page.locator('[data-preview="marker-readout"]')).toHaveText(/^Tool at X 20\.000 Y −20\.000 Z 2\.000 · (live|[\d.]+ s old)$/, { timeout: 5000 });
  await expect(page.locator('[data-preview="drawing"]')).toHaveAttribute('data-tool', '20.000 -20.000 2.000');
  expect(await request(worker, { v: 3, kind: 'close' })).toMatchObject({ ok: true });
});
