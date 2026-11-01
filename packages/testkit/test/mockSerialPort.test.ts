import { describe, expect, it } from 'vitest';
import { MockSerialPort } from '../src/mockSerialPort.ts';
import { TinyGEdgeNextModel } from '../src/firmware/edgeNext.ts';
import { createSim } from '../src/simHost.ts';
import { bytes, text } from '../src/bytes.ts';

function rig(start: 'ready' | 'boot' = 'ready'): { port: MockSerialPort; sim: ReturnType<typeof createSim<TinyGEdgeNextModel>> } {
  const sim = createSim(new TinyGEdgeNextModel({ start }));
  return { port: new MockSerialPort(sim.endpoint), sim };
}

async function readFor(port: MockSerialPort, sim: { clock: { advanceAsync(ms: number): Promise<void> } }, ms: number): Promise<string> {
  const reader = (port.readable as ReadableStream<Uint8Array>).getReader();
  let out = '';
  let done = false;
  const pump = (async () => {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      out += text(r.value);
    }
    done = true;
  })();
  await sim.clock.advanceAsync(ms);
  reader.releaseLock();
  await pump.catch(() => undefined);
  void done;
  return out;
}

describe('MockSerialPort', () => {
  it('has the SerialPort shape: info, null streams until open, then streams', async () => {
    const { port } = rig();
    expect(port.getInfo()).toEqual({ usbVendorId: 0x0403, usbProductId: 0x6015 });
    expect(port.connected).toBe(true);
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    await port.open({ baudRate: 115200 });
    expect(port.readable).toBeInstanceOf(ReadableStream);
    expect(port.writable).toBeInstanceOf(WritableStream);
    expect(port.readable).toBe(port.readable); // the same stream until it closes
  });

  it('validates open() like the spec and logs every attempt', async () => {
    const { port } = rig();
    await expect(port.open({ baudRate: 0 })).rejects.toThrow(TypeError);
    await expect(port.open({ baudRate: 115200, dataBits: 9 })).rejects.toThrow(TypeError);
    await expect(port.open({ baudRate: 115200, stopBits: 3 })).rejects.toThrow(TypeError);
    await expect(port.open({ baudRate: 115200, bufferSize: 0 })).rejects.toThrow(TypeError);
    await port.open({ baudRate: 1200 });
    await expect(port.open({ baudRate: 115200 })).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(port.openLog.map((o) => [o.options.baudRate, o.ok])).toEqual([
      [0, false],
      [115200, false],
      [115200, false],
      [115200, false],
      [1200, true],
      [115200, false],
    ]);
  });

  it('carries bytes both ways to the firmware model through Web Streams', async () => {
    const { port, sim } = rig();
    await port.open({ baudRate: 115200 });
    const writer = (port.writable as WritableStream<Uint8Array>).getWriter();
    await writer.write(bytes('{"fb":null}\n'));
    writer.releaseLock();
    const got = await readFor(port, sim, 20);
    expect(got).toBe('{"r":{"fb":450.01},"f":[3,0,10]}\n');
  });

  it('reads the boot banner with nobody reading yet: data is buffered in the stream', async () => {
    const { port, sim } = rig('boot');
    await port.open({ baudRate: 115200 });
    await sim.clock.advanceAsync(1100);
    const got = await readFor(port, sim, 1);
    expect(got).toContain('"msg":"SYSTEM READY"');
  });

  it('a wrong baud rate garbles the exchange', async () => {
    const { port, sim } = rig();
    await port.open({ baudRate: 9600 });
    const writer = (port.writable as WritableStream<Uint8Array>).getWriter();
    await writer.write(bytes('{"fb":null}\n'));
    writer.releaseLock();
    const got = await readFor(port, sim, 20);
    expect(got).not.toContain('450.01');
  });

  it('close() fails while a reader holds the stream lock, and succeeds once it is released', async () => {
    const { port } = rig();
    await port.open({ baudRate: 115200 });
    const reader = (port.readable as ReadableStream<Uint8Array>).getReader();
    await expect(port.close()).rejects.toThrow(TypeError);
    reader.releaseLock();
    await port.close();
    expect(port.readable).toBeNull();
    await expect(port.close()).rejects.toMatchObject({ name: 'InvalidStateError' });
    await port.open({ baudRate: 115200 }); // it can be opened again
  });

  it('a disconnect errors the readable with NetworkError, rejects writes and fires disconnect', async () => {
    const { port, sim } = rig();
    await port.open({ baudRate: 115200 });
    const events: string[] = [];
    port.addEventListener('disconnect', () => events.push('event'));
    port.ondisconnect = () => events.push('handler');
    const reader = (port.readable as ReadableStream<Uint8Array>).getReader();
    const read = reader.read();
    const writer = (port.writable as WritableStream<Uint8Array>).getWriter();
    sim.endpoint.disconnect('unplugged');
    await expect(read).rejects.toMatchObject({ name: 'NetworkError' });
    await expect(writer.write(bytes('x'))).rejects.toMatchObject({ name: 'NetworkError' });
    expect(events).toEqual(['handler', 'event']);
    expect(port.connected).toBe(false);
    expect(port.readable).toBeNull();
  });

  it('records setSignals and refuses signal calls on a closed port; forget() ends the port', async () => {
    const { port } = rig();
    await expect(port.setSignals({ dataTerminalReady: true })).rejects.toMatchObject({ name: 'InvalidStateError' });
    await port.open({ baudRate: 115200 });
    await port.setSignals({ dataTerminalReady: true, requestToSend: false });
    expect(port.signalLog).toEqual([{ dataTerminalReady: true, requestToSend: false }]);
    expect(port.outputSignals()).toEqual({ dataTerminalReady: true, requestToSend: false, break: false });
    expect(await port.getSignals()).toMatchObject({ clearToSend: true });
    await port.forget();
    expect(port.connected).toBe(false);
  });
});
