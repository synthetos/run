/**
 * ROADMAP P1-01: `WebSerialTransport`.
 *
 * - bufferSize 256 and flowControl 'none' only (`open({flowControl:'hardware'})`
 *   throws), 1200 baud refused, 2341:003D refused before `open()`, no
 *   `abort()`, `getInfo()` recorded;
 * - T-S16 through the real `GuardedTransport` around the real transport;
 * - the write, read and close rules of SAFETY H2b, against a scripted port
 *   and against the test kit's firmware models behind `MockSerialPort`;
 * - choosing the granted port the window selected, and refusing otherwise.
 *
 * Every refusal is shown to happen before the port's `open` is called.
 */
import { BYTE } from '@synthetos/protocol';
import { mintBootloaderCapability } from '@synthetos/flasher/bootloader-capability';
import { MockSerialPort, SimEndpoint, TinyG440Model, TinyGEdgeNextModel, VirtualClock, settle } from '@synthetos/testkit';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { GuardedTransport, TransportRefusedError, TransportWriteError } from '../src/guardedTransport.ts';
import { BOOTLOADER_TOUCH_BAUD, DUE_PROGRAMMING_PORT, SESSION_OPEN_OPTIONS, TRANSPORT_BUFFER_SIZE } from '../src/openPolicy.ts';
import type { Transport, TransportOpenOptions } from '../src/transport.ts';
import {
  WEB_SERIAL_BUFFER_SIZE,
  WEB_SERIAL_REFUSED_BAUD,
  WEB_SERIAL_REFUSED_PORT,
  WebSerialRefusedError,
  WebSerialTransport,
  findGrantedPort,
  webSerialTransportSource,
  type SerialPortLike,
} from '../src/webSerialTransport.ts';
import { enc, flush } from './fakeTransport.ts';
import { ScriptedSerialPort } from './serialPorts.ts';

const OPEN = SESSION_OPEN_OPTIONS;
const TINYG = { usbVendorId: 0x0403, usbProductId: 0x6015 } as const;
const DUE_PROG = { usbVendorId: 0x2341, usbProductId: 0x003d } as const;

async function refused(promise: Promise<unknown>): Promise<WebSerialRefusedError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WebSerialRefusedError);
  return error as WebSerialRefusedError;
}

async function opened(port = new ScriptedSerialPort()): Promise<{ port: ScriptedSerialPort; t: WebSerialTransport }> {
  const t = new WebSerialTransport(port);
  await t.open(OPEN);
  port.log.length = 0;
  return { port, t };
}

function boardRig(model: 'edge-next' | '440'): { clock: VirtualClock; endpoint: SimEndpoint; port: MockSerialPort } {
  const clock = new VirtualClock();
  const device = model === 'edge-next' ? new TinyGEdgeNextModel({ start: 'boot', bootMs: 10 }) : new TinyG440Model({ start: 'boot', bootMs: 10 });
  const endpoint = new SimEndpoint({ clock, device });
  return { clock, endpoint, port: new MockSerialPort(endpoint) };
}

describe('the constants are the open policy\'s (the transport imports types only, so it holds literals)', () => {
  it('buffer size, refused baud rate and refused port', () => {
    expect(WEB_SERIAL_BUFFER_SIZE).toBe(TRANSPORT_BUFFER_SIZE);
    expect(WEB_SERIAL_REFUSED_BAUD).toBe(BOOTLOADER_TOUCH_BAUD);
    expect(WEB_SERIAL_REFUSED_PORT).toEqual(DUE_PROGRAMMING_PORT);
    expect(Object.isFrozen(WEB_SERIAL_REFUSED_PORT)).toBe(true);
  });

  it('is a Transport, and the test kit\'s MockSerialPort has the SerialPort shape it uses', () => {
    expectTypeOf<WebSerialTransport>().toMatchTypeOf<Transport>();
    expectTypeOf<MockSerialPort>().toMatchTypeOf<SerialPortLike>();
  });

  it('has exactly the Transport members and nothing else: no way to cancel a write in progress (SAFETY H2b)', () => {
    expect(Object.getOwnPropertyNames(WebSerialTransport.prototype).sort()).toEqual(['close', 'constructor', 'info', 'onDisconnect', 'open', 'readable', 'writeLine']);
    expect(Object.getOwnPropertyNames(new WebSerialTransport(new ScriptedSerialPort()))).toEqual([]);
  });
});

describe('getInfo() is recorded once, at construction', () => {
  it('reports kind serial with the USB identity, from one reading', () => {
    const port = new ScriptedSerialPort(TINYG);
    const t = new WebSerialTransport(port);
    expect(t.info()).toEqual({ kind: 'serial', ...TINYG });
    t.info();
    expect(port.infoReads).toBe(1);
    expect(Object.isFrozen(t.info())).toBe(true);
  });

  it('a port with no USB identity reports none and opens (a platform UART, for example)', async () => {
    const port = new ScriptedSerialPort({});
    const t = new WebSerialTransport(port);
    expect(t.info()).toEqual({ kind: 'serial' });
    await t.open(OPEN);
    expect(port.opened).toHaveLength(1);
  });

  it.each([
    [{ usbVendorId: '1027', usbProductId: 0x6015 }],
    [{ usbVendorId: 0x0403, usbProductId: 0x16015 }],
    [{ usbVendorId: 0x0403, usbProductId: -1 }],
    [{ usbVendorId: 0x0403, usbProductId: 1.5 }],
    [{ usbVendorId: 0x2341 }],
    [{ usbProductId: 0x003d }],
  ])('a malformed or half-known identity %j is recorded as such (never dropped) and refused before open', async (info) => {
    const port = new ScriptedSerialPort(info);
    const t = new WebSerialTransport(port);
    expect(Object.keys(t.info()).sort()).toEqual(['kind', ...Object.keys(info)].sort());
    expect((await refused(t.open(OPEN))).code).toBe('invalid-port-identity');
    expect(port.opened).toEqual([]);
    // The guard refuses it on its own as well.
    const guarded = new GuardedTransport(new WebSerialTransport(new ScriptedSerialPort(info)));
    await expect(guarded.open(OPEN)).rejects.toMatchObject({ code: 'invalid-port-identity' });
  });
});

describe('open', () => {
  it('opens the port once, 8N1, with exactly the session baud rate, flowControl none and bufferSize 256', async () => {
    const port = new ScriptedSerialPort();
    await new WebSerialTransport(port).open(OPEN);
    expect(port.opened).toEqual([{ baudRate: OPEN.baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 256 }]);
    expect(Object.isFrozen(port.opened[0])).toBe(true);
  });

  it("open({flowControl:'hardware'}) throws, and the port is never opened", async () => {
    const port = new ScriptedSerialPort();
    const t = new WebSerialTransport(port);
    const e = await refused(t.open({ ...OPEN, flowControl: 'hardware' }));
    expect(e.code).toBe('flow-control');
    expect(e.message).toContain("only 'none'");
    expect(port.opened).toEqual([]);
    // A refused open leaves the transport unopened; nothing can be written.
    expect((await refused(t.writeLine(enc('{"sr":null}\n')))).code).toBe('not-open');
  });

  it.each([255, 257, 0, 4096, Number.NaN])('refuses bufferSize %s before open; only 256', async (bufferSize) => {
    const port = new ScriptedSerialPort();
    expect((await refused(new WebSerialTransport(port).open({ ...OPEN, bufferSize }))).code).toBe('buffer-size');
    expect(port.opened).toEqual([]);
  });

  it('refuses 1200 baud before open, whatever the identity', async () => {
    for (const info of [TINYG, { usbVendorId: 0x1d50, usbProductId: 0x606d }, { usbVendorId: 0x03eb, usbProductId: 0x6124 }, {}]) {
      const port = new ScriptedSerialPort(info);
      expect((await refused(new WebSerialTransport(port).open({ ...OPEN, baudRate: 1200 }))).code).toBe('capability-required');
      expect(port.opened).toEqual([]);
    }
  });

  it('refuses the Due programming port 2341:003D before open, at any baud rate and whatever else is wrong', async () => {
    for (const options of [OPEN, { ...OPEN, baudRate: 1200 }, { ...OPEN, flowControl: 'hardware' as const }, { ...OPEN, bufferSize: 1 }]) {
      const port = new ScriptedSerialPort(DUE_PROG);
      const e = await refused(new WebSerialTransport(port).open(options));
      expect(e.code).toBe('refused-port');
      expect(e.message).toContain('2341:003d');
      expect(port.opened).toEqual([]);
    }
  });

  it('reads each option once, so a getter cannot pass the check and then send something else', async () => {
    let reads = 0;
    const tricky = {
      get flowControl(): 'none' | 'hardware' {
        reads++;
        return reads === 1 ? 'none' : 'hardware';
      },
      baudRate: OPEN.baudRate,
      bufferSize: 256,
    } satisfies TransportOpenOptions;
    const port = new ScriptedSerialPort();
    await new WebSerialTransport(port).open(tricky);
    expect(port.opened[0]?.flowControl).toBe('none');
    expect(reads).toBe(1);
  });

  it('opens at most once', async () => {
    const { port, t } = await opened();
    expect((await refused(t.open(OPEN))).code).toBe('already-opened');
    expect(port.opened).toHaveLength(1);
  });

  it('a port that fails to open leaves the transport closed, and it never opens again', async () => {
    const port = new ScriptedSerialPort();
    port.openError = new DOMException('Failed to open serial port.', 'NetworkError');
    const t = new WebSerialTransport(port);
    await expect(t.open(OPEN)).rejects.toThrow('Failed to open serial port.');
    expect((await refused(t.open(OPEN))).code).toBe('already-opened');
    expect((await refused(t.writeLine(enc('{"sr":null}\n')))).code).toBe('not-open');
    await t.close();
    expect(port.log).toEqual(['open']);
  });
});

describe('T-S16 with the real transport behind the real guard', () => {
  it('1200 baud throws without the token, and the board is never opened', async () => {
    const { port } = boardRig('edge-next');
    const t = new GuardedTransport(new WebSerialTransport(port));
    await expect(t.open({ ...OPEN, baudRate: 1200 })).rejects.toMatchObject({ code: 'capability-required' });
    expect(port.openLog).toEqual([]);
  });

  it('with a flasher token the guard lets 1200 through, and the transport still refuses it: no session port opens at 1200', async () => {
    const { port } = boardRig('edge-next');
    const t = new GuardedTransport(new WebSerialTransport(port));
    await expect(t.open({ ...OPEN, baudRate: 1200 }, mintBootloaderCapability())).rejects.toMatchObject({ code: 'capability-required', name: 'WebSerialRefusedError' });
    expect(port.openLog).toEqual([]);
  });

  it('2341:003D is refused before open', async () => {
    const { port } = boardRig('edge-next');
    const due = new MockSerialPort(port.endpoint, { info: { usbVendorId: 0x2341, usbProductId: 0x003d } });
    const t = new GuardedTransport(new WebSerialTransport(due));
    const e = await t.open(OPEN).then(
      () => undefined,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(TransportRefusedError);
    expect(e).toMatchObject({ code: 'refused-port' });
    expect(due.openLog).toEqual([]);
  });

  it("flowControl 'hardware' is refused by both, and the board is never opened", async () => {
    const { port } = boardRig('440');
    await expect(new GuardedTransport(new WebSerialTransport(port)).open({ ...OPEN, flowControl: 'hardware' })).rejects.toMatchObject({ code: 'flow-control' });
    await expect(new WebSerialTransport(port).open({ ...OPEN, flowControl: 'hardware' })).rejects.toMatchObject({ code: 'flow-control' });
    expect(port.openLog).toEqual([]);
  });
});

describe('writing', () => {
  it('writes one copy of the bytes per call, taking and releasing the writer around each write', async () => {
    const { port, t } = await opened();
    const line = enc('{"sr":null}\n');
    const pending = t.writeLine(line);
    line[1] = 0x21;
    await pending;
    expect(port.chunks).toHaveLength(1);
    expect(port.chunks[0]).not.toBe(line);
    expect(new TextDecoder().decode(port.chunks[0])).toBe('{"sr":null}\n');
    expect(port.log).toEqual(['write', 'write-done', 'writer-released']);
    expect(port.writerLocked).toBe(false);
  });

  it('accepts the next write as soon as the previous one resolved (back-to-back awaited writes)', async () => {
    const { port, t } = await opened();
    await t.writeLine(enc('{"sr":null}\n'));
    await t.writeLine(Uint8Array.of(BYTE.FEEDHOLD));
    expect(port.chunks.map((c) => c.length)).toEqual([12, 1]);
  });

  it('refuses a write while another is in progress (never queued, never merged)', async () => {
    const { port, t } = await opened();
    port.holdWrites = true;
    const first = t.writeLine(enc('{"sr":null}\n'));
    await flush();
    expect((await refused(t.writeLine(Uint8Array.of(BYTE.FEEDHOLD)))).code).toBe('write-in-progress');
    expect(port.chunks).toHaveLength(1);
    port.holdWrites = false;
    port.releaseWrite();
    await first;
    await flush();
    await t.writeLine(Uint8Array.of(BYTE.FEEDHOLD));
    expect(port.chunks).toHaveLength(2);
  });

  it('after a failed write, nothing with LF or CR is ever written; a realtime byte still is', async () => {
    const { port, t } = await opened();
    port.writeError = new DOMException('The device has been lost.', 'NetworkError');
    await expect(t.writeLine(enc('{"sr":null}\n'))).rejects.toThrow('The device has been lost.');
    expect(port.writerLocked).toBe(false);
    port.writeError = undefined;
    await flush();
    expect((await refused(t.writeLine(enc('{"fb":null}\n')))).code).toBe('line-after-write-failure');
    expect((await refused(t.writeLine(Uint8Array.of(0x0d)))).code).toBe('line-after-write-failure');
    expect((await refused(t.writeLine(Uint8Array.of(0x0a)))).code).toBe('line-after-write-failure');
    await t.writeLine(Uint8Array.of(BYTE.FEEDHOLD));
    expect(port.chunks.map((c) => Array.from(c))).toEqual([Array.from(enc('{"sr":null}\n')), [BYTE.FEEDHOLD]]);
  });

  it('a port without a writable stream fails the write, and that counts as a failed write', async () => {
    const { port, t } = await opened();
    port.noWritable = true;
    await expect(t.writeLine(Uint8Array.of(BYTE.FEEDHOLD))).rejects.toThrow('no writable stream');
    port.noWritable = false;
    await flush();
    expect((await refused(t.writeLine(enc('{"sr":null}\n')))).code).toBe('line-after-write-failure');
  });

  it('a writer that cannot be taken fails the write and latches', async () => {
    const { port, t } = await opened();
    port.writerLocked = true;
    await expect(t.writeLine(enc('{"sr":null}\n'))).rejects.toThrow('locked');
    port.writerLocked = false;
    await flush();
    expect((await refused(t.writeLine(enc('{"sr":null}\n')))).code).toBe('line-after-write-failure');
  });

  it('refuses before open, after close and after a disconnect', async () => {
    const port = new ScriptedSerialPort();
    const t = new WebSerialTransport(port);
    expect((await refused(t.writeLine(enc('{"sr":null}\n')))).code).toBe('not-open');
    await t.open(OPEN);
    port.disconnect();
    expect((await refused(t.writeLine(Uint8Array.of(BYTE.FEEDHOLD)))).code).toBe('disconnected');
    await t.close();
    expect((await refused(t.writeLine(Uint8Array.of(BYTE.FEEDHOLD)))).code).toBe('not-open');
    expect(port.chunks).toEqual([]);
  });

  it.each([[new Uint8Array(0)], [[0x21]], ['!'], [null], [new Uint16Array([0x21])]])('refuses %j: not a non-empty Uint8Array', async (value) => {
    const { port, t } = await opened();
    expect((await refused(t.writeLine(value as unknown as Uint8Array))).code).toBe('invalid-write');
    expect(port.chunks).toEqual([]);
  });

  it('each write reaches the simulated board as one host write, in order', async () => {
    const { clock, endpoint, port } = boardRig('edge-next');
    const t = new GuardedTransport(new WebSerialTransport(port));
    await t.open(OPEN);
    await t.writeLine(enc('{"sr":null}\n'));
    await t.writeLine(enc('{"fb":null}\n'));
    await t.writeLine(Uint8Array.of(BYTE.FEEDHOLD));
    await clock.advanceAsync(50);
    const writes = endpoint.transcript.entries().filter((e) => e.kind === 'host-write');
    expect(writes.map((e) => new TextDecoder().decode(e.data))).toEqual(['{"sr":null}\n', '{"fb":null}\n', '!']);
    await t.close();
  });
});

describe('reading', () => {
  it("delivers the board's bytes in order (edge-next and 440 models)", async () => {
    for (const model of ['edge-next', '440'] as const) {
      const { clock, port } = boardRig(model);
      const t = new WebSerialTransport(port);
      await t.open(OPEN);
      const got: number[] = [];
      const reading = (async () => {
        for await (const chunk of t.readable) got.push(...chunk);
      })();
      await clock.advanceAsync(2000);
      await settle();
      expect(new TextDecoder().decode(new Uint8Array(got)), model).toContain('SYSTEM READY');
      await t.close();
      await reading;
      expect(port.connected).toBe(true);
    }
  });

  it('one reader at a time: a second concurrent iteration is refused', async () => {
    const { port, t } = await opened();
    const first = t.readable[Symbol.asyncIterator]();
    const pending = first.next();
    await flush();
    const second = t.readable[Symbol.asyncIterator]();
    await expect(second.next()).rejects.toMatchObject({ code: 'reader-in-use' });
    port.push(Uint8Array.of(0x7b));
    expect(await pending).toEqual({ done: false, value: Uint8Array.of(0x7b) });
    await first.return?.(undefined);
    expect(port.readerLocked).toBe(false);
  });

  it('a read error ends the iteration with that error and releases the reader', async () => {
    const { port, t } = await opened();
    port.failRead(new DOMException('Framing error.', 'FramingError'));
    const iterator = t.readable[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow('Framing error.');
    expect(port.readerLocked).toBe(false);
  });

  it('a chunk that is not bytes ends the iteration with an error', async () => {
    const { port, t } = await opened();
    port.push('{"r":{}}');
    await expect(t.readable[Symbol.asyncIterator]().next()).rejects.toThrow('something other than bytes');
    expect(port.readerLocked).toBe(false);
  });

  it('yields nothing before open, and nothing from a port without a readable stream', async () => {
    const port = new ScriptedSerialPort();
    const t = new WebSerialTransport(port);
    expect(await t.readable[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined });
    await t.open(OPEN);
    port.noReadable = true;
    expect(await t.readable[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined });
    expect(port.log).not.toContain('reader');
  });

  it('closing while the consumer holds a chunk ends the iteration cleanly', async () => {
    const { port, t } = await opened();
    port.push(Uint8Array.of(1));
    const iterator = t.readable[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: Uint8Array.of(1) });
    await t.close();
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(port.log).toEqual(['reader', 'writable-close', 'reader-cancel', 'reader-released', 'port-close']);
  });
});

describe('closing', () => {
  it('waits for the write in progress, closes (never aborts) the writable, cancels the reader, then closes the port', async () => {
    const { port, t } = await opened();
    const reading = (async () => {
      for await (const _ of t.readable) void _;
    })();
    await flush();
    port.holdWrites = true;
    const write = t.writeLine(enc('{"sr":null}\n'));
    await flush();
    const closing = t.close();
    await flush();
    expect(port.log).toEqual(['reader', 'write']);
    port.releaseWrite();
    await write;
    await closing;
    await reading;
    expect(port.log).toEqual(['reader', 'write', 'write-done', 'writer-released', 'writable-close', 'reader-cancel', 'reader-released', 'port-close']);
  });

  it('closes the simulated board cleanly (MockSerialPort refuses to close while a stream is locked)', async () => {
    const { clock, port } = boardRig('edge-next');
    const t = new WebSerialTransport(port);
    await t.open(OPEN);
    const reading = (async () => {
      for await (const _ of t.readable) void _;
    })();
    await clock.advanceAsync(100);
    await t.writeLine(enc('{"sr":null}\n'));
    await t.close();
    await reading;
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    // Closed, so it can be opened again by a new transport.
    await new WebSerialTransport(port).open(OPEN);
    expect(port.openLog.filter((o) => o.ok)).toHaveLength(2);
  });

  it('is idempotent, and a never-opened transport touches nothing', async () => {
    const port = new ScriptedSerialPort();
    const t = new WebSerialTransport(port);
    await t.close();
    await t.close();
    expect(port.log).toEqual([]);
    expect((await refused(t.open(OPEN))).code).toBe('already-opened');
  });

  it('a close during the open waits for it, then closes the port; the open does not reopen it', async () => {
    const port = new ScriptedSerialPort();
    port.holdOpen = true;
    const t = new WebSerialTransport(port);
    const opening = t.open(OPEN);
    await flush();
    const closing = t.close();
    port.releaseOpen();
    await opening;
    await closing;
    expect(port.log).toEqual(['open', 'writable-close', 'port-close']);
    expect((await refused(t.writeLine(Uint8Array.of(BYTE.FEEDHOLD)))).code).toBe('not-open');
  });

  it('a close during an open that fails closes nothing', async () => {
    const port = new ScriptedSerialPort();
    port.holdOpen = true;
    port.openError = new Error('no device');
    const t = new WebSerialTransport(port);
    const opening = t.open(OPEN);
    await flush();
    const closing = t.close();
    port.releaseOpen();
    await expect(opening).rejects.toThrow('no device');
    await closing;
    expect(port.log).toEqual(['open']);
  });

  it('a writable that fails to close, a reader that fails to cancel, a missing or locked writable do not stop the port closing', async () => {
    const a = await opened();
    a.port.writableCloseError = new Error('lost');
    void a.t.readable[Symbol.asyncIterator]().next();
    await flush();
    a.port.readerCancelError = new Error('lost');
    await a.t.close();
    expect(a.port.log).toEqual(['reader', 'writable-close', 'reader-cancel', 'reader-released', 'port-close']);

    const b = await opened();
    b.port.noWritable = true;
    await b.t.close();
    expect(b.port.log).toEqual(['port-close']);

    const c = await opened();
    c.port.writerLocked = true;
    await expect(c.t.close()).rejects.toThrow('locked');
    expect(c.port.log).toEqual(['port-close']);
  });
});

describe('disconnect', () => {
  it('reaches every onDisconnect callback, and the guard registered at construction sees it', async () => {
    const { clock, endpoint, port } = boardRig('edge-next');
    const inner = new WebSerialTransport(port);
    const t = new GuardedTransport(inner);
    let seen = 0;
    t.onDisconnect(() => seen++);
    await t.open(OPEN);
    const reading = (async () => {
      for await (const _ of t.readable) void _;
    })().catch((e: unknown) => e);
    await clock.advanceAsync(20);
    endpoint.disconnect();
    expect(seen).toBe(1);
    expect(t.disconnected).toBe(true);
    expect(await reading).toBeInstanceOf(DOMException);
    await expect(t.writeLine(Uint8Array.of(BYTE.FEEDHOLD))).rejects.toMatchObject({ code: 'disconnected' });
    await expect(inner.writeLine(Uint8Array.of(BYTE.FEEDHOLD))).rejects.toMatchObject({ code: 'disconnected' });
  });
});

describe('choosing the granted port', () => {
  const a = new ScriptedSerialPort(TINYG);
  const b = new ScriptedSerialPort(TINYG);
  const g2 = new ScriptedSerialPort({ usbVendorId: 0x1d50, usbProductId: 0x606d });
  const selector = { ...TINYG, grantIndex: 0, grantSnapshot: ['1027:24597', '7504:24685'] };
  const list = (): Promise<readonly SerialPortLike[]> => Promise.resolve([a, g2]);

  it('matches the entire snapshot with a unique selected identity without opening', async () => {
    expect(await findGrantedPort(selector, list)).toBe(a);
    expect(a.opened).toEqual([]);
  });

  it('refuses duplicate identities, changed order, shifted grants, missing snapshots and wrong indices', async () => {
    expect(await findGrantedPort({ ...selector, grantSnapshot: ['1027:24597', '1027:24597'] }, () => Promise.resolve([a, b]))).toBeNull();
    expect(await findGrantedPort(selector, () => Promise.resolve([g2, a]))).toBeNull();
    expect(await findGrantedPort(selector, () => Promise.resolve([b]))).toBeNull();
    expect(await findGrantedPort({ ...TINYG, grantIndex: 0 }, list)).toBeNull();
    expect(await findGrantedPort({ ...selector, grantIndex: 1 }, list)).toBeNull();
    expect(await findGrantedPort({ ...selector, grantIndex: 3 }, list)).toBeNull();
    expect(await findGrantedPort({ ...selector, usbVendorId: 7 }, list)).toBeNull();
  });

  it('where the API does not exist (Node), there are no granted ports', async () => {
    expect(await findGrantedPort(selector)).toBeNull();
    expect(await webSerialTransportSource().request(selector)).toBeNull();
  });

  it('the source prepares a new unopened transport or refuses, and propagates listing failures', async () => {
    const source = webSerialTransportSource(list);
    expect(source.kind).toBe('serial');
    expect(Object.isFrozen(source)).toBe(true);
    const first = await source.request(selector);
    expect(first).toBeInstanceOf(WebSerialTransport);
    expect(first?.info()).toEqual({ kind: 'serial', ...TINYG });
    expect(a.opened).toEqual([]);
    expect(await source.request(selector)).not.toBe(first);
    expect(await source.request({ ...selector, grantIndex: 1 })).toBeNull();
    await expect(webSerialTransportSource(() => Promise.reject(new Error('denied'))).request(selector)).rejects.toThrow('denied');
  });
});

describe('the guard\'s write rules hold over the real transport', () => {
  it('a guarded write failure is a TransportWriteError and latches lines in the guard', async () => {
    const port = new ScriptedSerialPort();
    const t = new GuardedTransport(new WebSerialTransport(port));
    await t.open(OPEN);
    port.writeError = new Error('gone');
    await expect(t.writeLine(enc('{"sr":null}\n'))).rejects.toBeInstanceOf(TransportWriteError);
    port.writeError = undefined;
    await expect(t.writeLine(enc('{"sr":null}\n'))).rejects.toMatchObject({ code: 'line-after-write-failure' });
    await t.writeLine(Uint8Array.of(BYTE.FEEDHOLD));
    expect(port.chunks.map((c) => c.length)).toEqual([12, 1]);
  });

  it('the guard serialises writes, so the transport never sees two at once', async () => {
    const port = new ScriptedSerialPort();
    const t = new GuardedTransport(new WebSerialTransport(port));
    await t.open(OPEN);
    port.holdWrites = true;
    const line = t.writeLine(enc('{"sr":null}\n'));
    const hold = t.writeLine(Uint8Array.of(BYTE.FEEDHOLD));
    await flush();
    expect(port.heldWrites).toBe(1);
    port.releaseWrite();
    await flush();
    port.releaseWrite();
    await Promise.all([line, hold]);
    expect(port.log.filter((l) => l === 'write')).toHaveLength(2);
  });
});
