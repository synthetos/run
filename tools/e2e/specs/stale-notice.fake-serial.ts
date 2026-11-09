/**
 * An old message goes on the next action (first-time walk 2026-11-08, C25), in the built app (fake-serial TEST
 * build): after Stop job the strip says "Stopped: queue cleared, spindle and coolant off"; a jog afterwards clears it.
 */
import { expect, test } from './fixtures.ts';
import { request } from './machineWorker.ts';
import { connect, open, phase, session, start, zigzag } from './jobFlow.ts';

test('the Stopped message clears when the next jog starts', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, zigzag(40));
  await start(page);
  await expect.poll(async () => (await session(worker)).job?.acked ?? 0, { timeout: 20_000 }).toBeGreaterThan(5);
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'stopJob' })).toMatchObject({ ok: true });
  await expect.poll(() => phase(worker), { timeout: 15_000 }).toBe('stopped');
  const strip = page.locator('[data-region="machine-strip"]');
  await expect(strip).toContainText('Stopped: queue cleared, spindle and coolant off');
  await page.locator('[data-tab="jog"]').click();
  await page.locator('.sec-jog [aria-label="Step size"] button', { hasText: /^1$/ }).click();
  await page.getByRole('button', { name: 'X+', exact: true }).click();
  await expect(strip).not.toContainText('Stopped: queue cleared', { timeout: 10_000 });
});
