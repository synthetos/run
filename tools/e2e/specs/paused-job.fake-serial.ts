/**
 * A paused job (first-time walk 2026-11-08, S3 and B2), in the built app (fake-serial TEST build) at 1280 × 720:
 * the strip says "Paused · spindle still on", never "Machine idle", and the Run card shows Resume at its top, in
 * view without scrolling; Resume there streams the job on.
 */
import { expect, test } from './fixtures.ts';
import { request } from './machineWorker.ts';
import { connect, open, phase, session, start, zigzag } from './jobFlow.ts';

test('paused with the spindle on: the strip says so and Resume is at the top of the Run card, in view', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, zigzag(60, [], ['M3 S12000']).replace('M30', 'M5\nM30'));
  await start(page);
  await expect.poll(async () => (await session(worker)).job?.acked ?? 0, { timeout: 20_000 }).toBeGreaterThan(5);
  await page.locator('[data-action="ui-level-simple"]').click();
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'feedhold' })).toMatchObject({ ok: true });
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('paused');
  const strip = page.locator('[data-region="machine-strip"] [data-strip="state"]');
  await expect(strip).toHaveText('Paused · spindle still on');
  const row = page.locator('[data-job="status"] [data-job="resume-row"]');
  await expect(row).toContainText('Paused · spindle still on');
  const resume = row.locator('[data-machine-control="resume"]');
  await expect(resume).toBeInViewport({ ratio: 1 });
  await expect(page.locator('[data-job="status"] [data-machine-control="resume"]')).toHaveCount(1);
  await resume.click();
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('running');
  await expect(row).toHaveCount(0);
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'stopJob' })).toMatchObject({ ok: true });
  await expect.poll(() => phase(worker), { timeout: 15_000 }).toBe('stopped');
});
