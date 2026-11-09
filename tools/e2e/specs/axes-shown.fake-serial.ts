/**
 * The A axis shows only when the machine has one (first-time walk 2026-11-08, C24), in the built app (fake-serial
 * TEST build): the simulated TinyG turns its A axis on by default, so with no machine chosen the Position panel shows
 * A; with an X-Carve chosen (its profile has no A axis) it does not.
 */
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { PORT, session } from './jobFlow.ts';

test('A is shown for a board with no machine chosen, hidden for an X-Carve profile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  const a = page.locator('[data-position-axis="a"]');
  await expect(a).toHaveCount(1, { timeout: 10_000 });
  await page.locator('[data-region="rail"] [data-view="library"]').click();
  await page.getByText('Start from a machine', { exact: true }).click();
  await page.getByText('Make a copy', { exact: true }).first().click();
  await page.locator('[data-region="rail"] [data-view="job"]').click();
  await expect(page.locator('[data-position-axis="z"]')).toHaveCount(1);
  await expect(a).toHaveCount(0);
});
