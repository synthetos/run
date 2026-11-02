/**
 * ROADMAP P0-14, on the PRODUCTION build (the attested artifact in CI).
 *
 * - The workspace page starts exactly one `machine.worker`, from a hashed
 *   same-origin chunk, through the `rs-worker` Trusted Types policy (the
 *   origin guard fails the test on any CSP or Trusted Types violation).
 * - From P1-01 that worker's transport source is Web Serial. Under the
 *   production headers (`serial=()`) the browser refuses `getPorts()` inside
 *   the worker, so `open` is refused with `unavailable` (the source failed)
 *   and the worker stays idle: production can reach no port. The staging and
 *   bench suites prove the other side (headers.staging.ts, bench.bench.ts).
 * - The spike's finding, kept as a regression test: a Playwright init
 *   script runs in the page but NOT in a dedicated worker, so an init
 *   script cannot give the worker a fake serial port
 *   (docs/testing/fake-serial.md). If a Playwright upgrade changes that,
 *   this test fails and the fallback can be reconsidered.
 */
import { expect, test } from './fixtures.ts';
import { MACHINE_WORKER_PATH, machineWorker, request } from './machineWorker.ts';

const PROBE = '__runInitScriptProbe';

test('the workspace starts one machine worker, whose Web Serial source the production headers refuse', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(new URL(worker.url()).pathname).toMatch(MACHINE_WORKER_PATH);
  expect(page.workers()).toHaveLength(1);
  expect(await worker.evaluate(() => (globalThis as unknown as { name: string }).name)).toBe('machine');

  expect(await request(worker, { v: 3, kind: 'status' })).toMatchObject({ v: 3, ok: true, kind: 'status', status: { source: 'serial', state: 'idle', session: { base: 'NOT_CONNECTED', overlays: [] } } });
  const reply = await request(worker, { v: 3, kind: 'prepare', port: { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0, grantSnapshot: ['1027:24597'] } });
  expect(reply).toMatchObject({ v: 3, ok: false, kind: 'prepare', code: 'unavailable' });
  expect((reply as { message: string }).message).toBe('the granted ports could not be verified');
  expect(await request(worker, { v: 3, kind: 'status' })).toMatchObject({ status: { source: 'serial', state: 'idle' } });
  expect(await request(worker, { v: 3, kind: 'close' })).toMatchObject({ ok: false, code: 'denied' });
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
