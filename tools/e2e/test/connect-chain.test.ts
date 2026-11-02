/**
 * The bench build's Connect, end to end against the fake serial, where the
 * test kit is allowed (OD-3, approved 2026-11-02).
 *
 * No served build combines the bench channel with the fake-serial transport
 * (each is its own one-module swap of the release build, and the bench
 * build never carries the test kit), so this composes the same source
 * modules in Node, unchanged:
 *
 * the bench channel's localhost identity (channel/bench.ts) through the D1
 * gate (authGate.ts) → LIVE entry (liveEntry.ts) → C1 → the window's port
 * chooser (portChooser.ts over packages/machine/src/webSerialChooser.ts,
 * reading a stand-in for the browser's Web Serial object on navigator) → the `open` request →
 * `MachineWorkerHost` over the fake-serial build's transport source
 * (fake-serial/transport.ts: a simulated edge-next board behind a test-kit
 * MockSerialPort) → the read-only session probes and classifies the board.
 *
 * The one stand-in besides the board: the advisory check answers "ok".
 * The placeholder release key's private half is not in the repository, so
 * no test can sign an advisory; advisoryGate.test.ts covers verification.
 *
 * The browser layers are covered by Playwright: bench.bench.ts (the chooser
 * is reached from the real Connect in the bench build, with requestPort
 * stubbed) and the fake-serial suite (the worker and session against the
 * mock board in the built app).
 */
import { describe, expect, it, vi } from 'vitest';
import { startBuildChannel } from '../../../apps/web/src/channel/bench.ts';
import { AuthGate, providersFor, RUN_SESSION_PROVIDER } from '../../../apps/web/src/live/authGate.ts';
import { memoryDeviceSafety } from '../../../apps/web/src/live/deviceSafety.ts';
import { LiveEntry, type LiveEntryDeps } from '../../../apps/web/src/live/liveEntry.ts';
import { RPC_VERSION } from '../../../apps/web/src/machine-worker/rpc.ts';
import { windowChooser } from '../../../apps/web/src/live/portChooser.ts';
import { MachineWorkerHost, realClock } from '../../../apps/web/src/machine-worker/host.ts';
import { createTransportSource } from '../fake-serial/transport.ts';

const DESKTOP = Object.freeze({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', maxTouchPoints: 0 });

/** Just enough of a Document for the bench channel on loopback. */
function benchDocument(hostname: string): Document {
  const chip = { textContent: 'abc123', setAttribute: () => undefined };
  return {
    location: { hostname, protocol: 'http:' },
    documentElement: { dataset: {} },
    querySelector: () => chip,
    title: 'run',
  } as unknown as Document;
}

/** The browser's Web Serial object, as the window sees it with the simulated board granted at index 0. */
function windowSerial(calls: string[]): unknown {
  const board = { getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6015 }) };
  return {
    ['request' + 'Port']: () => {
      calls.push('chooser');
      return Promise.resolve(board);
    },
    ['get' + 'Ports']: () => Promise.resolve([board]),
  };
}

function entryFor(host: MachineWorkerHost, gate: AuthGate, calls: string[]): LiveEntry {
  const deps: LiveEntryDeps = {
    auth: gate,
    checkAdvisory: () => Promise.resolve({ ok: true, source: 'fetched' }),
    store: memoryDeviceSafety(),
    now: () => new Date('2026-11-02T10:00:00Z'),
    // The real chooser module, reading the stand-in on navigator.serial (only portChooser.ts may import it).
    choosePort: () => windowChooser(),
    open: async (port) => {
      calls.push('open');
      // The same request mount.ts's `openRequest` builds (mount.ts itself pulls in Vite worker URLs).
      const reply = await host.handle({ v: RPC_VERSION, kind: 'open', port, boardId: null, previousSessionEnded: false });
      return reply.ok ? { ok: true } : { ok: false, message: reply.message };
    },
    leaveFullscreen: () => Promise.resolve(),
    unlockAlarm: () => calls.push('alarm'),
    onLive: () => calls.push('live'),
  };
  return new LiveEntry(deps);
}

describe("the bench build's Connect against the fake serial (OD-3)", () => {
  it('bench identity, advisory, C1, the chooser inside the confirm click, then the worker opens and classifies the simulated board', { timeout: 20_000 }, async () => {
    const calls: string[] = [];
    vi.stubGlobal('navigator', { ...DESKTOP, serial: windowSerial(calls) });
    const channel = startBuildChannel(benchDocument('localhost'));
    const gate = new AuthGate(providersFor(channel, 'staging', RUN_SESSION_PROVIDER));
    const host = new MachineWorkerHost(createTransportSource(), realClock(), DESKTOP);
    const entry = entryFor(host, gate, calls);

    await entry.begin();
    expect(entry.state.step).toBe('c1');
    const boxes = entry.state.step === 'c1' ? entry.state.boxes : 0;
    const confirmed = entry.confirm(Array.from({ length: boxes }, () => true));
    // The chooser ran synchronously inside the click, before anything was awaited.
    expect(calls).toEqual(['alarm', 'chooser']);
    await confirmed;
    expect(entry.state.step).toBe('live');
    expect(calls).toEqual(['alarm', 'chooser', 'open', 'live']);

    await vi.waitFor(
      () => {
        const s = host.session.snapshot;
        expect(s.base).toBe('CONNECTED_UNKNOWN');
        expect(s.classification?.dialectId).toBe('tinyg-en');
      },
      { timeout: 10_000, interval: 50 },
    );
    expect(host.session.snapshot.port).toMatchObject({ usbVendorId: 0x0403, usbProductId: 0x6015 });
    expect(await host.handle({ v: 3, kind: 'close' })).toMatchObject({ ok: true });
    vi.unstubAllGlobals();
  });

  it('the bench identity exists only on loopback: elsewhere Connect is refused before the chooser', async () => {
    const calls: string[] = [];
    vi.stubGlobal('navigator', { ...DESKTOP, serial: windowSerial(calls) });
    const doc = benchDocument('localhost');
    const channel = startBuildChannel(doc);
    (doc as unknown as { location: { hostname: string } }).location.hostname = 'evil.example';
    const host = new MachineWorkerHost(createTransportSource(), realClock(), DESKTOP);
    const entry = entryFor(host, new AuthGate(providersFor(channel, 'staging', RUN_SESSION_PROVIDER)), calls);
    await entry.begin();
    expect(entry.state).toEqual({ step: 'refused', refusal: { kind: 'signed-out' } });
    expect(calls).toEqual(['alarm']);
    vi.unstubAllGlobals();
  });
});
