/**
 * ROADMAP P0-14 acceptance: "a passing example test that opens the mock port
 * from `machine.worker` in the built app", and ROADMAP P1-02 in the built
 * app: after the ESC/S/newline pre-check, the read-only `MachineSession` probes
 * the simulated board from `{sr:null}`, classifies it, reads it, and writes nothing but
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
import { afterRunningFirmwarePrecheck, isReportConfig } from './helpers.ts';
import { w7 } from '../../../packages/safety/src/strings.ts';
import { machineWorker, request } from './machineWorker.ts';

interface PortView {
  readonly openLog: readonly { readonly options: Record<string, unknown>; readonly ok: boolean }[];
  readonly connected: boolean;
  readonly readableNull: boolean;
  /** Every write the host made to the simulated board, as byte arrays. */
  readonly writes: readonly number[][];
  readonly received: string;
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
      received: p.endpoint.transcript.entries().filter(e => e.kind === 'host-read').map(e => String.fromCharCode(...e.data)).join(''),
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

test('machine.worker runs the read-only session on the mock board: ESC/S/newline then {sr:null}, classified, read, and only GETs and ! written', async ({ page }) => {
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
    .toBe('IDLE_UNHOMED');
  const status = (await request(worker, { v: 3, kind: 'status' })) as StatusView;
  // P1-03: the worker verifies the bundled signed manifest for its own origin. The test server is plain-HTTP
  // loopback, which the worker treats as the bench (staging) environment, so the owner-signed bench channel
  // approves edge-next 450.02 (no fbs) and the simulated board classifies full. Loopback also has the Phase 2
  // motion flag (motionFlag.ts), so the session is idle (not homed); nothing here moves, so only GETs and `!` are written.
  expect(status).toMatchObject({
    status: { state: 'open', session: { overlays: [], classification: { dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved' }, identity: { fb: 450.02, id: 'SIM-EN-0001' } } },
  });

  // Pause writes `!`; a read of an allowlisted token is answered; a side-effect token is refused.
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'feedhold' })).toEqual({ v: 3, ok: true, kind: 'intent' });
  expect(await request(worker, { v: 3, kind: 'read', tokens: ['md'] })).toMatchObject({ ok: false, code: 'denied' });
  expect(await request(worker, { v: 3, kind: 'read', tokens: ['posx'] })).toEqual({ v: 3, ok: true, kind: 'read' });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as StatusView).status.session.values['posx']?.value, { timeout: 5000 }).toBe(0);

  const writes = (await ports(worker))[0]?.writes ?? [];
  expect(writes.slice(0, 4).map(text)).toEqual(['\u001b', 'S', '\n', '{sr:null}\n']);
  for (const w of afterRunningFirmwarePrecheck(writes.map(text))) {
    expect(w.includes('\u0018') || w.includes('\u0004'), w).toBe(false);
    expect(/^\{"?[a-z0-9_]+"?:null\}\n$/.test(w) || w === '!' || isReportConfig(w), w).toBe(true);
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
        const timer = setTimeout(() => reject(new Error(`no IDLE_UNHOMED snapshot within 10 s: ${bases.join(' ')}`)), 10_000);
        channel.port1.onmessage = (event) => {
          const data = event.data as { kind: string; snapshot?: { base: string } };
          if (data.kind !== 'snapshot' || data.snapshot === undefined) return;
          bases.push(data.snapshot.base);
          times.push(performance.now());
          if (data.snapshot.base === 'IDLE_UNHOMED') {
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
  expect(seen.bases.at(-1)).toBe('IDLE_UNHOMED');
  // The worker posts at most one snapshot per 50 ms. Arrival times in the page carry delivery jitter (a delayed message
  // shortens the next gap), so check the rate over the run and allow single gaps to be compressed, never to bunch up.
  const gaps = seen.times.slice(2).map((t, i) => t - (seen.times[i + 1] as number));
  if (gaps.length > 0) {
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(20);
    expect(((seen.times.at(-1) as number) - (seen.times[1] as number)) / gaps.length).toBeGreaterThanOrEqual(45);
  }
});

test('the page itself still shows NOT CONNECTED: the test build changes nothing outside the worker', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect(page.locator('[data-safety="W7"]')).toHaveText(w7());
});

for (const rxm of [0, 1] as const) {
  test(`the running mock answers the ESC/S pre-check with one error in rxm ${rxm}`, async ({ page }) => {
    const worker = await machineWorker(page);
    await worker.evaluate(mode => {
      const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: { rxm: number; start: 'ready' } } };
      scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
      scope.__RUN_FAKE_SERIAL__.next = { rxm: mode, start: 'ready' };
    }, rxm);
    expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
    const port = (await ports(worker))[0];
    expect(port).toBeDefined();
    const writes = afterRunningFirmwarePrecheck((port?.writes ?? []).map(text));
    expect(writes[0]).toBe('{sr:null}\n');
    // EN a7489b79 gcode_parser.c:145-155 keeps ESC as malformed in character mode (E161).
    // Line-mode posting strips leading controls, leaving bare S: BAD_NUMBER_FORMAT (102).
    const status = rxm === 0 ? 101 : 102;
    const errors = (port?.received ?? '').split(/\r?\n/).filter(line => line.includes(`,${status},`));
    expect(errors, port?.received).toHaveLength(1);
    const reply = JSON.parse(errors[0] as string) as { r: unknown; f: number[] };
    expect(reply.r).toEqual({});
    expect(reply.f[0]).toBe(rxm === 0 ? 2 : 3);
    expect(reply.f[1]).toBe(status);
    if (rxm === 1) expect(reply.f).toEqual([3, 102, 10]);
    await request(worker, { v: 3, kind: 'close' });
  });
}
