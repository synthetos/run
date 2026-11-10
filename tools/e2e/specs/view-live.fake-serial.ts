/**
 * The 3D view during a job (owner, 2026-11-10; fake-serial TEST build): while the job runs the lines are drawn by
 * planner state and the key says what each look means; with the spindle on (M3) the bit turns, except under
 * reduced motion or on a software renderer (the browser tests run SwiftShader), where the viewer's bar says
 * "↻ Spindle on" instead. Both go when the job ends. Read only: nothing here sends anything. With
 * RUN_SCREENSHOTS_DIR set, the drawing mid-job is captured.
 */
import { expect, test } from './fixtures.ts';
import { connect, open, phase, start } from './jobFlow.ts';

const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

function job(n: number): string {
  const lines = ['G21 G90', 'S10000 M3', 'G0 X10 Y10', 'G1 Z-0.5 F300'];
  for (let i = 0; i < n; i++) lines.push(`G1 X${i % 2 === 0 ? 30 : 10} Y${(10 + i * 0.8).toFixed(1)} F900`);
  return `${[...lines, 'G0 Z5', 'M5', 'M30'].join('\n')}\n`;
}

for (const reduced of [false, true]) {
  test(`while a job runs: the planner legend, and the spindle badge${reduced ? ' (reduced motion)' : ''}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    const worker = await connect(page);
    await open(page, job(20), 'spin.nc');
    await page.locator('[data-region="rail"] [data-view="analyze"]').click();
    for (const op of await page.locator('[data-screen="analyze"] [data-advisor-operation]').all()) await op.locator('[data-advisor-field="tool"]').selectOption('1');
    await page.locator('[data-region="rail"] [data-view="job"]').click();
    const legend = page.locator('[data-region="preview"] [data-scene="planner-legend"]');
    const badge = page.locator('[data-region="preview"] [data-preview="spin-badge"]');
    await expect(legend).toHaveCount(0);
    await start(page);
    await expect.poll(async () => (await phase(worker)) ?? '', { timeout: 10_000 }).toMatch(/^(running|ending)$/);
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('In the planner');
    // The tests' renderer is software, so the bit does not turn and the badge shows, reduced motion or not.
    await expect(badge).toHaveText('↻ Spindle on', { timeout: 10_000 });
    if (SHOTS !== undefined) await page.locator('[data-region="preview"]').screenshot({ path: `${SHOTS}/view-live-${reduced ? 'reduced' : 'spin'}.png` });
    await expect.poll(() => phase(worker), { timeout: 60_000 }).toBe('done');
    await expect(legend).toHaveCount(0);
    await expect(badge).toHaveCount(0);
  });
}
