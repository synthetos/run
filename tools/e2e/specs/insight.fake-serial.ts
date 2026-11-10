/**
 * The Advanced planner and cutting block in the Position panel (owner, 2026-11-09), in the built app (fake-serial
 * TEST build): hidden in Simple; during a job it shows the planner buffer as blocks in use of the board's planner
 * size, the queued motion, the lines and the report age, and the cutting numbers. It only reads live state.
 * After a pause and resume, no "Resumed" line floats under the jog controls (the status strip says it).
 */
import { expect, test } from './fixtures.ts';
import { request } from './machineWorker.ts';
import { connect, open, phase, session, start, zigzag } from './jobFlow.ts';

test('Advanced shows the planner and cutting rows during a job, read only; Simple hides them', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  const block = page.locator('[data-insight="block"]');
  await expect(block).toBeVisible();
  await expect(block.locator('[data-insight-row="age"]')).toContainText(/Live · \d+\.\d\d s/);
  await page.locator('[data-action="ui-level-simple"]').click();
  await expect(block).toHaveCount(0);
  await page.locator('[data-action="ui-level-advanced"]').click();

  await open(page, zigzag(80, [], ['T1', 'M3 S12000']).replace('M30', 'M5\nM30'));
  await start(page);
  await expect.poll(async () => (await session(worker)).job?.acked ?? 0, { timeout: 20_000 }).toBeGreaterThan(5);
  await expect(block.locator('[data-insight-row="buffer"] [role="meter"]')).toHaveAttribute('aria-valuemax', /^\d+$/);
  await expect(block.locator('[data-insight-row="buffer"]')).toContainText(/\d+ of \d+/);
  await expect(block.locator('[data-insight-row="queued"]')).toContainText(/about .+ \/ \d+ mm|about /);
  await expect(block.locator('[data-insight-row="lines"]')).toContainText(/sent [\d,]+ · answered [\d,]+ · running N/);
  await expect(block.locator('[data-insight-row="spindle"]')).toContainText('12,000 rpm');
  await expect(block.locator('[data-insight-row="feed"]')).toContainText(/\d+ mm\/min(moving|programmed F)/);

  // Pause and resume: the strip says it; nothing floats under the jog controls.
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'feedhold' })).toMatchObject({ ok: true });
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('paused');
  await page.locator('[data-job="status"] [data-machine-control="resume"]').first().click();
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('running');
  await expect(page.locator('[data-jog="note"]')).toHaveCount(0);
  await expect(page.locator('.run-inspector')).not.toContainText('Resumed');
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'stopJob' })).toMatchObject({ ok: true });
});
