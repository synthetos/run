/**
 * The fake-serial replacement for the transport seam (ROADMAP P0-14):
 * `MockTransport` over the test kit's `MockSerialPort`, and the source the
 * test build hands to `machine.worker`. Node runs these against the same
 * test-kit objects the browser gets; the browser run is the fake-serial
 * Playwright suite.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GuardedTransport } from '@synthetos/machine';
import { MockSerialPort, SimEndpoint, TinyGEdgeNextModel, VirtualClock, settle } from '@synthetos/testkit';
import { MockTransport } from '../fake-serial/mockTransport.ts';
import { FAKE_GRANTED_PORT, FAKE_PLATE_Z, FAKE_SERIAL_GLOBAL, createTransportSource, realTimeClock, type FakeSerialRegistry } from '../fake-serial/transport.ts';
import * as fakeSeam from '../fake-serial/transport.ts';
import * as productionSeam from '../../../apps/web/src/machine-worker/transport.ts';
import { SESSION_OPEN_OPTIONS } from '@synthetos/machine';

/** The session options, from dialect data (never typed in). */
const OPEN = SESSION_OPEN_OPTIONS;

function rig(): { clock: VirtualClock; endpoint: SimEndpoint; port: MockSerialPort; transport: MockTransport } {
  const clock = new VirtualClock();
  const endpoint = new SimEndpoint({ clock, device: new TinyGEdgeNextModel({ start: 'boot', bootMs: 10 }) });
  const port = new MockSerialPort(endpoint);
  return { clock, endpoint, port, transport: new MockTransport(port) };
}

async function collect(transport: MockTransport, clock: VirtualClock, ms: number): Promise<{ bytes: number[]; done: Promise<void> }> {
  const bytes: number[] = [];
  const done = (async () => {
    for await (const chunk of transport.readable) bytes.push(...chunk);
  })();
  await clock.advanceAsync(ms);
  await settle();
  return { bytes, done };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[FAKE_SERIAL_GLOBAL];
});

describe('MockTransport', () => {
  it("reports the port's USB identity as a sim link, before open", () => {
    expect(rig().transport.info()).toEqual({ kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 });
    const clock = new VirtualClock();
    const port = new MockSerialPort(new SimEndpoint({ clock, device: new TinyGEdgeNextModel() }), { info: {} });
    expect(new MockTransport(port).info()).toEqual({ kind: 'sim' });
  });

  it('opens the port with exactly the options it is given', async () => {
    const { port, transport } = rig();
    await transport.open(OPEN);
    expect(port.openLog).toEqual([{ options: OPEN, ok: true }]);
  });

  it('reads what the board sends, writes one line per call, and closes the port with the reader released', async () => {
    const { clock, endpoint, port, transport } = rig();
    await transport.open(OPEN);
    const read = await collect(transport, clock, 2000);
    expect(new TextDecoder().decode(new Uint8Array(read.bytes))).toContain('SYSTEM READY');
    await transport.writeLine(new TextEncoder().encode('{"sr":null}\n'));
    await clock.advanceAsync(50);
    expect(new TextDecoder().decode(endpoint.transcript.bytesOf('host-write'))).toBe('{"sr":null}\n');
    await transport.close();
    await read.done;
    expect(port.readable).toBeNull();
    // The port really is closed: it can be opened again.
    await transport.open(OPEN);
    expect(port.openLog).toHaveLength(2);
  });

  it('closes a port nobody is reading', async () => {
    const { port, transport } = rig();
    await transport.open(OPEN);
    await transport.close();
    await expect(port.close()).rejects.toThrow(/not open/);
  });

  it('refuses to write or read on a closed port', async () => {
    const { transport } = rig();
    await expect(transport.writeLine(new Uint8Array([0x21]))).rejects.toThrow(/not writable/);
    const chunks: Uint8Array[] = [];
    for await (const c of transport.readable) chunks.push(c);
    expect(chunks).toEqual([]);
  });

  it('reports a disconnect', async () => {
    const { endpoint, transport } = rig();
    let dropped = 0;
    transport.onDisconnect(() => {
      dropped += 1;
    });
    await transport.open(OPEN);
    endpoint.disconnect('unplugged');
    expect(dropped).toBe(1);
  });

  it('is what GuardedTransport wraps: the guard still refuses a forbidden open before the port sees it', async () => {
    const { port, transport } = rig();
    const guarded = new GuardedTransport(transport);
    await expect(guarded.open({ ...OPEN, baudRate: 1200 })).rejects.toThrow(/capability-required/);
    expect(port.openLog).toEqual([]);
  });
});

describe('the fake-serial transport source', () => {
  it('is kind fake, and each request is a fresh, unopened MockTransport over a new listed port', async () => {
    const source = createTransportSource();
    expect(source.kind).toBe('fake');
    const a = await source.request(FAKE_GRANTED_PORT);
    const b = await source.request(FAKE_GRANTED_PORT);
    expect(a).toBeInstanceOf(MockTransport);
    expect(b).not.toBe(a);
    const registry = (globalThis as Record<string, unknown>)[FAKE_SERIAL_GLOBAL] as FakeSerialRegistry;
    expect(registry.ports).toHaveLength(2);
    expect(registry.ports.every((p) => p.openLog.length === 0)).toBe(true);
    expect(a?.info()).toEqual({ kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 });
  });

  it('the plain board has a Z-min probe input, a probe jerk and a plate a spec can drive (Probe Z, T-S132); a spec\'s EEPROM wins', async () => {
    const source = createTransportSource();
    await source.request(FAKE_GRANTED_PORT);
    const registry = (globalThis as Record<string, unknown>)[FAKE_SERIAL_GLOBAL] as FakeSerialRegistry;
    const device = registry.devices?.at(-1) as TinyGEdgeNextModel;
    expect(device.settings.get('zsn')).toBe(4);
    expect(device.settings.get('zjh')).toBe(40);
    expect(device.settings.get('prbp')).toBe(0);
    expect(device.eepromWrites).toBe(0);
    expect(FAKE_PLATE_Z).toBeLessThan(0);
    registry.next = { eeprom: { __layout: 10002, zsn: 1 } };
    await source.request(FAKE_GRANTED_PORT);
    expect(registry.devices?.at(-1)?.settings.get('zsn')).toBe(1);
    expect(registry.devices).toHaveLength(2);
  });

  it('refuses, never guesses: a selector for any other port resolves null and lists no port', async () => {
    const source = createTransportSource();
    for (const port of [
      { ...FAKE_GRANTED_PORT, grantIndex: 1 },
      { ...FAKE_GRANTED_PORT, usbProductId: 0x6001 },
      { ...FAKE_GRANTED_PORT, usbVendorId: 0x2341 },
    ]) {
      expect(await source.request(port), JSON.stringify(port)).toBeNull();
    }
    expect((globalThis as Record<string, unknown>)[FAKE_SERIAL_GLOBAL]).toBeUndefined();
  });

  it('runs on a real-time clock', async () => {
    const clock = realTimeClock();
    const t0 = clock.now();
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(1), 5);
    const cancelled = clock.setTimeout(() => fired.push(2), 5);
    clock.clearTimeout(cancelled);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toEqual([1]);
    expect(clock.now() - t0).toBeGreaterThanOrEqual(5);
  });
});

describe('the transport seam contract (apps/web/src/machine-worker/transport.ts)', () => {
  it('the production seam exports exactly createTransportSource, and the fake exports it with the same arity', () => {
    expect(Object.keys(productionSeam)).toEqual(['createTransportSource']);
    expect(typeof fakeSeam.createTransportSource).toBe('function');
    expect(fakeSeam.createTransportSource.length).toBe(productionSeam.createTransportSource.length);
    const prod = productionSeam.createTransportSource();
    const fake = fakeSeam.createTransportSource();
    expect(Object.keys(prod).sort()).toEqual(Object.keys(fake).sort());
    expect(prod.request.length).toBe(fake.request.length);
  });
});
