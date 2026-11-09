/**
 * "Use the machine's work zero" in Place job (owner, 2026-11-09, OD-28), in the built app (fake-serial TEST
 * build): it is offered only once the board is connected and the machine position is set; choosing it places the
 * job at the board's work zero and Run's zero check compares against it (so C31, shown for a difference, is not). It is display and plan only:
 * the board's work offsets are the same before and after.
 */
import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { PORT, session, zigzag } from './jobFlow.ts';

/** Every write to the simulated board, as text (as motion.fake-serial.ts reads them). */
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

test('the machine’s work zero is offered once the position is set, and Run compares against it', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  await page.locator('[data-job-step="run"]').click();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'job.nc', mimeType: 'text/plain', buffer: Buffer.from(zigzag(4)) });
  await expect(page.locator('[data-job="check"]')).toContainText('Checked with this board', { timeout: 15_000 });
  // Not homed: not offered.
  await page.locator('[data-job-step="place"]').click();
  const place = page.locator('[data-job-panel="place"]');
  await expect(place.locator('[data-place="zero-source"]')).toHaveCount(0);
  await page.locator('[data-job-step="run"]').click();
  await page.getByRole('button', { name: 'Set the machine zero here, without homing' }).click();
  await page.locator('[data-region="home-quick"] button', { hasText: 'Set machine position' }).click();
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_HOMED');
  const from = (await writes(worker)).length;
  await page.locator('[data-job-step="place"]').click();
  const source = place.locator('[data-place="zero-source"]');
  await expect(source).toBeVisible();
  await source.getByRole('button', { name: 'Use the machine’s work zero' }).click();
  await expect(place.locator('[data-place="machine-zero"]')).toContainText('Placed at the machine’s work zero (X ');
  await expect(place.locator('[data-place="machine-zero"]')).toContainText('Nothing is sent to the board.');
  // The stock point and its offsets step aside; the margins come from the board's zero.
  await expect(place.getByRole('radiogroup', { name: 'Zero point on the stock' })).toHaveCount(0);
  await expect(place.locator('[data-place="margins"]')).toBeVisible();
  await page.locator('[data-job-step="run"]').click();
  const zero = page.locator('[data-job="zero"]');
  await expect(zero).toContainText('The board’s work zero is where you planned it: the machine’s work zero');
  // The plan is the board's zero, so there is no difference to confirm (C31 shows only when they differ).
  await expect(page.locator('[data-safety="C31"]')).toHaveCount(0);
  // Nothing that sets a zero was written.
  expect((await writes(worker)).slice(from).filter((w) => /G10|G92|G28\.3/.test(w))).toEqual([]);
  // Back to a point on the stock.
  await page.locator('[data-job-step="place"]').click();
  await source.getByRole('button', { name: 'A point on the stock' }).click();
  await expect(place.getByRole('radiogroup', { name: 'Zero point on the stock' })).toBeVisible();
});
