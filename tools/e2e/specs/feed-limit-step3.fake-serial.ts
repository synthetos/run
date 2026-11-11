/** Opt-in telemetry through the real worker and page, using the optional step-3 edge-next model. */
import { expect, test } from './fixtures.ts';
import { connect, open, phase, start, zigzag } from './jobFlow.ts';
import { request } from './machineWorker.ts';

test('capability-probed step 3 pairs v2/fg, marks the job, and closes telemetry at completion', async ({ page }) => {
  test.setTimeout(90_000);
  // Keep the signed simulated identity. Only its explicitly advertised runtime capabilities change.
  const worker = await connect(page, { feedLimit: true, feedLimitStep3: true });
  await open(page, zigzag(12));
  await start(page);
  const feed = async () => ((await request(worker, { v: 3, kind: 'status' })) as {
    status: { session: { job: { feedLimit: { last: { e: number; q: number; c: number[] } | null; gaps: { e: number; q: number } | null } | null } } };
  }).status.session.job.feedLimit;
  await expect.poll(async () => (await feed())?.last?.c.length, { timeout: 20_000 }).toBe(7);
  await expect.poll(async () => {
    const f = await feed();
    return f?.gaps !== null && f?.gaps?.e === f?.last?.e && f?.gaps?.q === f?.last?.q;
  }).toBe(true);
  await page.locator('[data-tab="live"]').click();
  await expect(page.locator('[data-live="feed-limit"]')).toBeVisible();
  await expect.poll(() => phase(worker), { timeout: 45_000 }).toBe('done');
  const writes = () => worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): { kind: string; data: Uint8Array }[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports.at(-1)?.endpoint.transcript.entries() ?? []).filter(e => e.kind === 'host-write').map(e => String.fromCharCode(...e.data));
  });
  await expect.poll(async () => (await writes()).includes('{"rt":{"fg":0}}\n')).toBe(true);
  const w = await writes();
  for (const line of ['{"rt":{"fi":2}}\n', '{"rt":{"fg":1}}\n', '{"rt":{"job":1}}\n', '{"rt":{"job":0}}\n', '{"rt":{"fi":0}}\n']) expect(w).toContain(line);
  expect(w.indexOf('{"rt":{"fg":1}}\n')).toBeLessThan(w.findIndex(l => l.startsWith('N')));
  await expect(page.locator('[data-live="feed-limit"]')).toHaveAttribute('data-feed-state', 'summary');
});
