/**
 * ROADMAP P0-14, on the PRODUCTION build (the attested artifact in CI).
 *
 * - The workspace page starts exactly one `machine.worker`, from a hashed
 *   same-origin chunk, through the `rs-worker` Trusted Types policy (the
 *   origin guard fails the test on any CSP or Trusted Types violation).
 * - In Phase 0 that worker has no transport: `open` is refused with
 *   `unavailable` and the worker stays idle. Nothing can reach a port.
 * - The spike's finding, kept as a regression test: a Playwright init
 *   script runs in the page but NOT in a dedicated worker, so an init
 *   script cannot give the worker a fake serial port
 *   (docs/testing/fake-serial.md). If a Playwright upgrade changes that,
 *   this test fails and the fallback can be reconsidered.
 */
import { expect, test } from './fixtures.ts';
import { MACHINE_WORKER_PATH, machineWorker, request } from './machineWorker.ts';

const PROBE = '__runInitScriptProbe';

test('the workspace starts one machine worker, which has no transport in Phase 0', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(new URL(worker.url()).pathname).toMatch(MACHINE_WORKER_PATH);
  expect(page.workers()).toHaveLength(1);
  expect(await worker.evaluate(() => (globalThis as unknown as { name: string }).name)).toBe('machine');

  expect(await request(worker, { v: 1, kind: 'status' })).toEqual({ v: 1, ok: true, kind: 'status', status: { source: 'none', state: 'idle', bytesReceived: 0 } });
  expect(await request(worker, { v: 1, kind: 'open' })).toEqual({
    v: 1,
    ok: false,
    kind: 'open',
    code: 'unavailable',
    message: 'this build cannot connect to a controller',
  });
  expect(await request(worker, { v: 1, kind: 'status' })).toMatchObject({ status: { source: 'none', state: 'idle' } });
  expect(await request(worker, { v: 1, kind: 'close' })).toMatchObject({ ok: false, code: 'not-open' });
  expect(await request(worker, { kind: 'open' })).toMatchObject({ ok: false, kind: 'invalid', code: 'invalid-request' });
});

test('spike finding: an init script reaches the page but not the dedicated machine worker', async ({ page }) => {
  await page.addInitScript((name) => {
    Object.defineProperty(globalThis, name, { value: true });
  }, PROBE);
  const worker = await machineWorker(page);
  expect(await page.evaluate((name) => (globalThis as unknown as Record<string, unknown>)[name], PROBE)).toBe(true);
  expect(await worker.evaluate((name) => typeof (globalThis as unknown as Record<string, unknown>)[name], PROBE)).toBe('undefined');
});
