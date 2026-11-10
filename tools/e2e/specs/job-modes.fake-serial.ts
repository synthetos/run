/**
 * T-S133 (E). Job start matches the preview (OD-19, owner 2026-11-08; SAFETY §4.4a Start), in the built app on the simulated
 * edge-next board: a file that ends in G91 with no M30 leaves the board relative, the job card says so from the
 * values read after the job, and the next file, which moves before it sets a distance mode, gets `G90` before its
 * first line, read back, as the check said it would.
 *
 * With JOB_MODES_SHOTS set to a directory, the card's modes row and start line are captured in Simple and Advanced
 * at 1280x720 and 390x844.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { connect, open, phase, start } from './jobFlow.ts';

const SHOTS = process.env['JOB_MODES_SHOTS'];

function writes(worker: Worker): Promise<string[]> {
  return worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly Entry[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports.at(-1)?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data));
  });
}

async function shots(page: Page): Promise<void> {
  if (SHOTS === undefined) return;
  for (const level of ['simple', 'advanced'] as const) {
    await page.locator(`[data-action="ui-level-${level}"]`).click();
    for (const [w, h] of [[1280, 720], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      const modes = page.locator('[data-ready-item="modes"]');
      if ((await modes.count()) > 0) await modes.first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: `${SHOTS}/job-modes-${level}-${w}x${h}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-action="ui-level-advanced"]').click();
}

test('a board a file left in G91: the card says Relative, mm, and the next file gets G90 before its first line', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, 'G21 G91\nG1 X1 F600\nG1 X1\n', 'leaves-g91.nc');
  await expect(page.locator('[data-ready-summary="modes"]')).toHaveText('Absolute, mm.');
  await expect(page.locator('[data-note="modes"]')).toHaveCount(0); // the file sets its own modes
  await start(page);
  await expect.poll(() => phase(worker), { timeout: 30_000 }).toBe('done');
  await page.locator('[data-action="job-close"]').click();

  await open(page, 'G1 X5 F600\nG1 X2\nM30\n', 'no-g90.nc');
  await expect(page.locator('[data-ready-summary="modes"]')).toHaveText('Relative, mm.', { timeout: 10_000 });
  // What Start writes is a note (Notes tab, owner 2026-11-09).
  await expect(page.locator('[data-note="modes"]')).toContainText('Run sets absolute mode before the first line, as the preview shows.');
  await shots(page);
  const from = (await writes(worker)).length;
  await start(page);
  await expect.poll(() => phase(worker), { timeout: 30_000 }).toBe('done');
  const w = (await writes(worker)).slice(from);
  const lines = w.filter((x) => !x.startsWith('{') && x !== '\x05');
  // G90 goes before the first motion line, and is read back before it.
  expect(lines[0]).toBe('G90\n');
  expect(lines[1]).toMatch(/^N1 G1 X5 F600\n$/);
  expect(w.slice(w.indexOf('G90\n') + 1, w.findIndex((x) => x.startsWith('N1 ')))).toContain('{"dist":null}\n');
});
