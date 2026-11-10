/**
 * The Run step compares the board's work zero with Place job's planned zero (first-time walk 2026-11-08, S6), in
 * the built app (fake-serial TEST build): before the machine position is set it says the distance is not known;
 * once it is set (here with Set machine zero here), it says how far, in mm and in words. It never says "No plan is
 * recorded" while Place job has a planned zero, and C31 names the plan.
 */
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { PORT, session, zigzag } from './jobFlow.ts';

test('Run names Place job’s planned zero and the difference from the board’s work zero', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  await page.locator('[data-job-step="run"]').click();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'job.nc', mimeType: 'text/plain', buffer: Buffer.from(zigzag(4)) });
  await expect(page.locator('[data-ready-item="file"]')).toHaveAttribute('data-mark', 'done', { timeout: 15_000 });
  // The list says it in a few words; the full comparison is the work zero note (Notes tab, owner 2026-11-09).
  await expect(page.locator('[data-ready-summary="zero"]')).toHaveText('Can’t compare.');
  const zero = page.locator('[data-note="zero"]');
  await expect(zero).toContainText('Your plan puts work zero at the front-left corner of the top of the stock');
  await expect(zero).toContainText('The machine position is not set (not homed)');
  await expect(zero).not.toContainText('No plan is recorded');
  // One plain sentence; no coordinates in the visible line (owner, 2026-11-09). This board has no homing set up, so
  // the note says to set the position and offers no Home button.
  await expect(zero.locator('.note-line')).toContainText('Can’t compare until the machine position is set.');
  await expect(zero.locator('[data-action="note-link"]')).toHaveCount(0);
  // Set the machine position here (G28.3): machine coordinates now relate to the bed, so the distance is known.
  await page.getByRole('button', { name: 'Set machine zero here, without homing' }).click();
  await page.locator('[data-region="home-quick"] button', { hasText: 'Set machine position' }).click();
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_HOMED');
  await expect(zero).toContainText(/Work zero Z is \d+\.\d mm (above|below) the top of the stock you planned\./);
  await expect(zero.locator('.note-line')).toContainText(/Your work zero is \d+ mm from where you planned it\./);
  await expect(zero.locator('.note-line')).not.toContainText(/X -?\d/);
  await expect(zero).toContainText('You planned work zero at the front-left corner of the top of the stock');
  await expect(zero).not.toContainText('No plan is recorded');
  await expect(page.locator('[data-ready-summary="zero"]')).toHaveText('Not your plan’s.');
  await expect(page.locator('[data-job="confirm-start"]')).toContainText("the board's work zero");
  // The registered C31, in full, is under Details in the start confirmation.
  await page.locator('[data-job="confirm-start-box"]').check();
  await page.locator('[data-action="start-job"]').click();
  const travel = page.locator('[data-action="travel-start"]');
  await expect(travel.or(page.locator('[data-safety="C30"]')).first()).toBeVisible();
  if ((await travel.count()) > 0) await travel.click();
  await expect(page.locator('[data-safety="C30"] [data-full="C31"]')).toContainText('at the front-left corner of the top of the stock');
  await expect(page.locator('[data-safety="C30"] [data-full="C31"]')).not.toContainText('none recorded');
  await page.locator('[data-safety="C30"] [data-action="motion-cancel"]').click();
});
