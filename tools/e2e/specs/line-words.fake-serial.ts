/**
 * Lines as the user counts them (first-time walk 2026-11-08, C5), in the built app (fake-serial TEST build): the
 * G-code tab counts the file, the check names the file's lines and what Run adds, and while the job runs the strip
 * and the job card name the same FILE line the board is on.
 */
import { expect, test } from './fixtures.ts';
import type { Worker } from '@playwright/test';
import { request } from './machineWorker.ts';
import { connect, open, phase, session, start, zigzag } from './jobFlow.ts';

/** The file line the session says the board is on. */
async function executing(worker: Worker): Promise<number> {
  const s = (await request(worker, { v: 3, kind: 'status' })) as { status: { session: { job: { executing: { line: number } | null } | null } } };
  return s.status.session.job?.executing?.line ?? 0;
}

test('the check, the G-code tab, the strip and the card all count file lines', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  const text = zigzag(40, [], ['M3 S12000']).replace('M30', 'M5\nM30');
  await open(page, text);
  const fileLines = text.trimEnd().split('\n').length;
  await expect(page.locator('.dock-summary')).toHaveText(new RegExp(`^${String(fileLines)} lines, \\d+ with commands$`));
  const check = page.locator('[data-job="check"]');
  await expect(check).toContainText('Checked with this board: the file’s');
  const total = (await session(worker)).job?.total ?? 0;
  const toSend = Number(/the file’s (\d+) lines with commands/.exec((await check.textContent()) ?? '')?.[1]);
  if (total > toSend) await expect(check).toContainText(`plus ${String(total - toSend)} line`);
  await start(page);
  await expect.poll(() => executing(worker), { timeout: 20_000 }).toBeGreaterThan(5);
  const job = page.locator('[data-region="machine-strip"] [data-readout="Job"]');
  await expect(job).toHaveText(/^file line \d+$/);
  await expect(page.locator('[data-job="line"]')).toHaveText(/^file line \d+$/);
  // Both name the file line the session says the board is on (they may tick between reads, never another count).
  const strip = Number(/(\d+)/.exec((await job.textContent()) ?? '')?.[1]);
  expect(strip).toBeLessThanOrEqual(fileLines);
  await expect.poll(() => phase(worker), { timeout: 60_000 }).toBe('done');
  await expect(job).toHaveText('No job running');
});

