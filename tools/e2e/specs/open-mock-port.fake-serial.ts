/**
 * ROADMAP P0-14 acceptance: "a passing example test that opens the mock port
 * from `machine.worker` in the built app".
 *
 * Runs only against the fake-serial TEST build (apps/web/dist-fake-serial),
 * in which the transport seam is swapped for a `MockTransport` over the
 * test kit's `MockSerialPort` and simulated edge-next board, and nothing
 * else differs from production (the CI diff check proves it). So the code
 * under test here is the production worker, `MachineWorkerHost` and
 * `GuardedTransport`, exactly as shipped.
 */
import { expect, test } from './fixtures.ts';
import { w7 } from '../../../packages/safety/src/strings.ts';
import { machineWorker, request } from './machineWorker.ts';

interface PortView {
  readonly openLog: readonly { readonly options: Record<string, unknown>; readonly ok: boolean }[];
  readonly connected: boolean;
  readonly readableNull: boolean;
}

/** What the worker did to the mock ports, read inside the worker. */
function ports(worker: import('@playwright/test').Worker): Promise<PortView[]> {
  return worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { openLog: PortView['openLog']; connected: boolean; readable: unknown }[] } })
      .__RUN_FAKE_SERIAL__;
    return (registry?.ports ?? []).map((p) => ({ openLog: p.openLog, connected: p.connected, readableNull: p.readable === null }));
  });
}

test('machine.worker opens the mock port through GuardedTransport, reads the board, and closes it', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 1, kind: 'status' })).toMatchObject({ status: { source: 'fake', state: 'idle' } });
  expect(await ports(worker)).toEqual([]);

  // The worker opens the port with the session options the guard allows.
  expect(await request(worker, { v: 1, kind: 'open' })).toEqual({
    v: 1,
    ok: true,
    kind: 'open',
    info: { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 },
  });
  const opened = await ports(worker);
  expect(opened).toHaveLength(1);
  expect(opened[0]?.openLog).toEqual([{ options: { baudRate: 115200, flowControl: 'none', bufferSize: 256 }, ok: true }]);

  // The simulated board boots and prints its banners; the worker reads them.
  await expect
    .poll(async () => ((await request(worker, { v: 1, kind: 'status' })) as { status: { bytesReceived: number } }).status.bytesReceived, { timeout: 5000 })
    .toBeGreaterThan(0);
  expect(await request(worker, { v: 1, kind: 'status' })).toMatchObject({ status: { state: 'open' } });

  // A second open while one is open is refused, and opens nothing.
  expect(await request(worker, { v: 1, kind: 'open' })).toMatchObject({ ok: false, code: 'busy' });
  expect(await ports(worker)).toHaveLength(1);

  // Close releases the reader and closes the port.
  expect(await request(worker, { v: 1, kind: 'close' })).toEqual({ v: 1, ok: true, kind: 'close' });
  expect(await request(worker, { v: 1, kind: 'status' })).toEqual({ v: 1, ok: true, kind: 'status', status: { source: 'fake', state: 'idle', bytesReceived: 0 } });
  const closed = await ports(worker);
  expect(closed[0]?.readableNull).toBe(true);
  expect(closed[0]?.openLog).toHaveLength(1);
});

test('the page itself still shows NOT CONNECTED: the test build changes nothing outside the worker', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 1, kind: 'open' })).toMatchObject({ ok: true });
  await expect(page.locator('[data-safety="W7"]')).toHaveText(w7());
});
