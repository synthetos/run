import { describe, expect, it } from 'vitest';
import { X192A3, XbootClient } from '@synthetos/flasher';
import { FlashableBoard, MockSerialPort, SimEndpoint, VirtualClock, type FaultPlan } from '@synthetos/testkit';
import { BootloaderLink } from '../src/bootloaderLink.ts';
import { WebSerialTransport, type SerialPortLike } from '../src/webSerialTransport.ts';

async function drive<T>(clock: VirtualClock, work: Promise<T>): Promise<T> {
  let done = false;
  const result = work.then((value) => { done = true; return { value }; }, (error: unknown) => { done = true; return { error }; });
  for (let i = 0; !done && i < 10000; i++) {
    for (let k = 0; k < 60; k++) await Promise.resolve();
    if (!done) { const at = clock.nextAt(); if (at !== undefined) clock.advanceTo(at); }
  }
  if (!done) throw new Error('test stalled');
  const r = await result;
  if ('error' in r) throw r.error;
  return r.value;
}
function rig(start: 'app' | 'bootloader' = 'bootloader', faults?: FaultPlan) {
  const clock = new VirtualClock();
  const board = new FlashableBoard({ start, xboot: { hardened: true } });
  const endpoint = new SimEndpoint({ clock, device: board, link: { latencyMs: 0.01 }, ...(faults === undefined ? {} : { faults }) });
  const port = new MockSerialPort(endpoint);
  // The close drain (WEB_SERIAL_CLOSE_DRAIN_MS) runs on this test's virtual clock, not a real timer.
  const wait = (ms: number): Promise<void> => new Promise<void>((resolve) => clock.setTimeout(resolve, ms));
  return { clock, board, endpoint, port, wait };
}
async function open(r: ReturnType<typeof rig>, port: SerialPortLike = r.port) {
  const transport = new WebSerialTransport(port, { wait: r.wait });
  const link = new BootloaderLink(transport, r.clock, X192A3);
  await drive(r.clock, link.openProbe());
  return { transport, link, client: new XbootClient(link, r.clock, X192A3) };
}

describe('Web Serial → bootloader link → xboot client', () => {
  it('receives a split XBoot++ reply through the real reader', async () => {
    const r = rig(); const x = await open(r);
    await drive(r.clock, x.client.enter(1000));
    expect(x.link.wire.filter((e) => e.dir === 'rx').length).toBeGreaterThan(1);
    expect(x.link.diagnostics.rxBytes).toBe(7);
    expect(x.transport.readDiagnostics).toMatchObject({ portOpen: true, readerAcquired: true, rxBytes: 7, error: null });
    await drive(r.clock, x.link.close());
  });

  it('closes and reopens the same port after boot=1 without pressing reset', async () => {
    const r = rig('app');
    const app = new WebSerialTransport(r.port, { wait: r.wait });
    await drive(r.clock, app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 }));
    await drive(r.clock, app.writeLine(new TextEncoder().encode('{"boot":1}\n')));
    await drive(r.clock, app.close());
    await r.clock.advanceAsync(300);
    const x = await open(r);
    await drive(r.clock, x.client.enter(1000));
    expect(r.port.openLog).toHaveLength(2);
    expect(r.board.history.some((s) => s.includes('software reset'))).toBe(true);
    expect(x.transport.readDiagnostics.readerAcquired).toBe(true);
    expect(r.board.xboot.commands).not.toContain(0x0a);
    await drive(r.clock, x.link.close());
  });

  it('reports an acquired pending reader and zero bytes when upstream RX is dropped', async () => {
    const r = rig('bootloader', { faults: [{ kind: 'drop', direction: 'toHost', select: { probability: 1 } }] });
    const x = await open(r);
    await expect(drive(r.clock, x.client.enter(400))).rejects.toMatchObject({ code: 'no-entry' });
    expect(r.board.xboot.commands).toContain(0x53);
    expect(x.link.diagnostics).toMatchObject({ portOpen: true, readerStarted: true, rxBytes: 0, ended: false, error: null });
    expect(x.transport.readDiagnostics).toMatchObject({ readerAcquired: true, readCompletions: 0, rxBytes: 0, error: null });
    await drive(r.clock, x.link.close());
  });

  it('preserves the original reader failure and reports closed, not an entry timeout', async () => {
    const r = rig(); const original = new DOMException('USB receive transfer failed', 'NetworkError');
    const port: SerialPortLike = {
      getInfo: () => r.port.getInfo(), open: (o) => r.port.open(o), close: () => r.port.close(),
      setSignals: (s) => r.port.setSignals(s), addEventListener: (type, fn) => r.port.addEventListener(type, fn),
      get writable() { return r.port.writable; },
      get readable() { return { getReader: () => ({ read: async () => { throw original; }, cancel: async () => undefined, releaseLock: () => undefined }) }; },
    };
    const x = await open(r, port);
    await expect(drive(r.clock, x.client.enter(400))).rejects.toMatchObject({ code: 'closed' });
    expect(x.link.diagnostics.error).toBe(original);
    expect(x.transport.readDiagnostics.error).toBe(original);
    expect(x.link.diagnostics.ended).toBe(true);
    await drive(r.clock, x.link.close());
  });
});
