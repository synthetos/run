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
  await expect(page.locator('[data-job="check"]')).toContainText('Checked with this board', { timeout: 15_000 });
  const zero = page.locator('[data-job="zero"]');
  await expect(zero).toContainText('Your plan puts work zero at the front-left corner of the top of the stock');
  await expect(zero).toContainText('The machine position is not set (not homed)');
  await expect(zero).not.toContainText('No plan is recorded');
  // Set the machine position here (G28.3): machine coordinates now relate to the bed, so the distance is known.
  await page.getByRole('button', { name: 'Set machine zero here, without homing' }).click();
  await page.locator('[data-region="home-quick"] button', { hasText: 'Set machine position' }).click();
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_HOMED');
  await expect(zero).toContainText(/Work zero Z is \d+\.\d mm (above|below) the top of the stock you planned\./);
  await expect(zero).toContainText('You planned work zero at the front-left corner of the top of the stock');
  await expect(zero).not.toContainText('No plan is recorded');
  await expect(page.locator('[data-safety="C31"]')).toContainText('at the front-left corner of the top of the stock');
  await expect(page.locator('[data-safety="C31"]')).not.toContainText('none recorded');
});
