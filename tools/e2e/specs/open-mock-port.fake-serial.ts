/**
 * ROADMAP P0-14 acceptance: "a passing example test that opens the mock port
 * from `machine.worker` in the built app", and ROADMAP P1-02 in the built
 * app: the read-only `MachineSession` probes the simulated board from
 * `{sr:null}`, classifies it, reads it, and writes nothing but
 * allowlisted GETs and `!`.
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
  /** Every write the host made to the simulated board, as byte arrays. */
  readonly writes: readonly number[][];
}

/** What the worker did to the mock ports, read inside the worker. */
function ports(worker: import('@playwright/test').Worker): Promise<PortView[]> {
  return worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    const registry = (
      globalThis as unknown as {
        __RUN_FAKE_SERIAL__?: { ports: { openLog: PortView['openLog']; connected: boolean; readable: unknown; endpoint: { transcript: { entries(): readonly Entry[] } } }[] };
      }
    ).__RUN_FAKE_SERIAL__;
    return (registry?.ports ?? []).map((p) => ({
      openLog: p.openLog,
      connected: p.connected,
      readableNull: p.readable === null,
      writes: p.endpoint.transcript
        .entries()
        .filter((e) => e.kind === 'host-write')
        .map((e) => [...e.data]),
    }));
  });
}

interface StatusView {
  readonly status: { readonly state: string; readonly session: { readonly base: string; readonly overlays: readonly string[]; readonly classification: unknown; readonly identity: unknown; readonly values: Record<string, { value: unknown }> } };
}

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const text = (bytes: readonly number[]): string => String.fromCharCode(...bytes);

test('machine.worker runs the read-only session on the mock board: {sr:null} first, classified, read, and only GETs and ! written', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'status' })).toMatchObject({ status: { source: 'fake', state: 'idle', session: { base: 'NOT_CONNECTED' } } });
  expect(await ports(worker)).toEqual([]);

  // Prepare creates one unopened mock; committing the ticket must not acquire another.
  const prepared = await request(worker, { v: 3, kind: 'prepare', port: PORT }) as { ok: boolean; kind: string; preparation: number };
  expect(prepared).toMatchObject({ ok: true, kind: 'prepare' });
  expect(await ports(worker)).toHaveLength(1);
  expect((await ports(worker))[0]?.openLog).toEqual([]);
  expect((await ports(worker))[0]?.writes).toEqual([]);
  // The worker opens that held port with the session options the guard allows.
  expect(await request(worker, { v: 3, kind: 'open', port: PORT, preparation: prepared.preparation })).toEqual({ v: 3, ok: true, kind: 'open', info: { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 } });
  const opened = await ports(worker);
  expect(opened).toHaveLength(1);
  expect(opened[0]?.openLog).toEqual([{ options: { baudRate: 115200, flowControl: 'none', bufferSize: 256 }, ok: true }]);

  // The simulated board boots while it is probed: the session waits for SYSTEM READY, probes again from {sr:null}, and reads it.
  await expect
    .poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as StatusView).status.session.base, { timeout: 10_000 })
    .toBe('CONNECTED_UNKNOWN');
  const status = (await request(worker, { v: 3, kind: 'status' })) as StatusView;
  expect(status).toMatchObject({
    status: { state: 'open', session: { overlays: ['READ_ONLY'], classification: { dialectId: 'tinyg-en', mode: 'readOnly' }, identity: { fb: 450.01, id: 'SIM-EN-0001' } } },
  });

  // Pause writes `!`; a read of an allowlisted token is answered; a side-effect token is refused.
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'feedhold' })).toEqual({ v: 3, ok: true, kind: 'intent' });
  expect(await request(worker, { v: 3, kind: 'read', tokens: ['md'] })).toMatchObject({ ok: false, code: 'denied' });
  expect(await request(worker, { v: 3, kind: 'read', tokens: ['posx'] })).toEqual({ v: 3, ok: true, kind: 'read' });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as StatusView).status.session.values['posx']?.value, { timeout: 5000 }).toBe(0);

  const writes = (await ports(worker))[0]?.writes ?? [];
  expect(text(writes[0] ?? [])).toBe('{sr:null}\n');
  for (const w of writes) {
    expect(w.includes(0x18) || w.includes(0x04), text(w)).toBe(false);
    expect(/^\{"?[a-z0-9_]+"?:null\}\n$/.test(text(w)) || text(w) === '!', text(w)).toBe(true);
  }
  expect(writes.map(text)).toContain('!');
  expect(writes.map(text)).not.toContain('{"md":null}\n');

  // A second open while one is open is denied by the allow-matrix, and opens nothing.
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: false, code: 'denied' });
  expect(await ports(worker)).toHaveLength(1);

  // Disconnect releases the reader and closes the port.
  expect(await request(worker, { v: 3, kind: 'close' })).toEqual({ v: 3, ok: true, kind: 'close' });
  expect(await request(worker, { v: 3, kind: 'status' })).toMatchObject({ status: { source: 'fake', state: 'idle', session: { base: 'NOT_CONNECTED' } } });
  const closed = await ports(worker);
  expect(closed[0]?.readableNull).toBe(true);
  expect(closed[0]?.openLog).toHaveLength(1);
});

test('a subscribed port receives the session snapshots, at most 20 per second', async ({ page }) => {
  const worker = await machineWorker(page);
  const seen = await worker.evaluate(
    (port) =>
      new Promise<{ bases: string[]; times: number[] }>((resolve, reject) => {
        const bases: string[] = [];
        const times: number[] = [];
        const channel = new MessageChannel();
        const timer = setTimeout(() => reject(new Error(`no CONNECTED_UNKNOWN snapshot within 10 s: ${bases.join(' ')}`)), 10_000);
        channel.port1.onmessage = (event) => {
          const data = event.data as { kind: string; snapshot?: { base: string } };
          if (data.kind !== 'snapshot' || data.snapshot === undefined) return;
          bases.push(data.snapshot.base);
          times.push(performance.now());
          if (data.snapshot.base === 'CONNECTED_UNKNOWN') {
            clearTimeout(timer);
            resolve({ bases, times });
          }
        };
        globalThis.dispatchEvent(new MessageEvent('message', { data: { v: 3, kind: 'subscribe' }, ports: [channel.port2] }));
        const open = new MessageChannel();
        globalThis.dispatchEvent(new MessageEvent('message', { data: { v: 3, kind: 'open', port }, ports: [open.port2] }));
      }),
    PORT,
  );
  expect(seen.bases[0]).toBe('NOT_CONNECTED');
  expect(seen.bases).toContain('IDENTIFYING');
  expect(seen.bases.at(-1)).toBe('CONNECTED_UNKNOWN');
  for (let i = 2; i < seen.times.length; i++) expect((seen.times[i] as number) - (seen.times[i - 1] as number)).toBeGreaterThanOrEqual(45);
});

test('the page itself still shows NOT CONNECTED: the test build changes nothing outside the worker', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect(page.locator('[data-safety="W7"]')).toHaveText(w7());
});
