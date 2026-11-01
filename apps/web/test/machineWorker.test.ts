/**
 * `machine.worker` request handling (ROADMAP P0-14): the strict request
 * parser, and `MachineWorkerHost` driving a Transport only through
 * `GuardedTransport`. The browser-level behaviour (the worker starts under
 * the production CSP and Trusted Types, refuses `open` in production, opens
 * the mock port in the fake-serial build) is asserted by the Playwright
 * suites in tools/e2e.
 */
import { describe, expect, it } from 'vitest';
import type { Transport, TransportInfo, TransportOpenOptions, TransportSource } from '@synthetos/machine';
import { MachineWorkerHost, SESSION_OPEN_OPTIONS } from '../src/machine-worker/host.ts';
import { parseRequest } from '../src/machine-worker/rpc.ts';
import { createTransportSource } from '../src/machine-worker/transport.ts';

/** A Transport whose readable the test feeds by hand. */
class FakeTransport implements Transport {
  readonly opened: TransportOpenOptions[] = [];
  readonly writes: Uint8Array[] = [];
  closed = 0;
  failOpen: Error | undefined;
  failClose: Error | undefined;
  #info: TransportInfo;
  #push: ((chunk: Uint8Array | null) => void) | undefined;
  readonly #queue: (Uint8Array | null)[] = [];
  readonly #disconnect: (() => void)[] = [];

  constructor(info: TransportInfo = { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 }) {
    this.#info = info;
  }

  info(): TransportInfo {
    return this.#info;
  }
  async open(options: TransportOpenOptions): Promise<void> {
    if (this.failOpen !== undefined) throw this.failOpen;
    this.opened.push(options);
  }
  async writeLine(line: Uint8Array): Promise<void> {
    this.writes.push(line);
  }
  get readable(): AsyncIterable<Uint8Array> {
    const next = (): Promise<IteratorResult<Uint8Array>> =>
      new Promise((resolve) => {
        const deliver = (chunk: Uint8Array | null): void => resolve(chunk === null ? { done: true, value: undefined } : { done: false, value: chunk });
        const queued = this.#queue.shift();
        if (queued !== undefined) deliver(queued);
        else this.#push = deliver;
      });
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
  /** Delivers bytes (or the end of the stream, `null`) to the reader. */
  feed(chunk: Uint8Array | null): void {
    const push = this.#push;
    this.#push = undefined;
    if (push !== undefined) push(chunk);
    else this.#queue.push(chunk);
  }
  async close(): Promise<void> {
    this.closed += 1;
    this.feed(null);
    if (this.failClose !== undefined) throw this.failClose;
  }
  onDisconnect(callback: () => void): void {
    this.#disconnect.push(callback);
  }
  disconnect(): void {
    for (const cb of this.#disconnect) cb();
  }
}

function source(kind: TransportSource['kind'], make: () => Transport | null | Promise<never>): TransportSource & { requests: number } {
  const s = {
    kind,
    requests: 0,
    request: async () => {
      s.requests += 1;
      return make();
    },
  };
  return s;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('parseRequest', () => {
  it.each(['open', 'close', 'status'])('accepts exactly { v: 1, kind: %s }', (kind) => {
    expect(parseRequest({ v: 1, kind })).toEqual({ v: 1, kind });
    expect(parseRequest({ kind, v: 1 })).toEqual({ v: 1, kind });
  });

  it.each([
    ['null', null],
    ['a string', 'open'],
    ['an array', [1, 'open']],
    ['a missing version', { kind: 'open' }],
    ['another version', { v: 2, kind: 'open' }],
    ['a string version', { v: '1', kind: 'open' }],
    ['an unknown kind', { v: 1, kind: 'write' }],
    ['an inherited kind', { v: 1, kind: 'toString' }],
    ['an extra key', { v: 1, kind: 'open', port: 'COM3' }],
    ['a class instance', Object.assign(Object.create({ x: 1 }) as object, { v: 1, kind: 'open' })],
  ])('refuses %s', (_label, data) => {
    expect(parseRequest(data)).toBeNull();
  });
});

describe('the production Phase 0 transport seam', () => {
  it('has no transport: kind none, and request() always resolves null', async () => {
    const s = createTransportSource();
    expect(s.kind).toBe('none');
    expect(await s.request()).toBeNull();
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('so the worker answers open with unavailable and stays idle', async () => {
    const host = new MachineWorkerHost(createTransportSource());
    expect(await host.handle({ v: 1, kind: 'open' })).toEqual({ v: 1, ok: false, kind: 'open', code: 'unavailable', message: 'this build cannot connect to a controller' });
    expect(await host.handle({ v: 1, kind: 'status' })).toEqual({ v: 1, ok: true, kind: 'status', status: { source: 'none', state: 'idle', bytesReceived: 0 } });
  });
});

describe('MachineWorkerHost', () => {
  it('refuses an invalid message without asking the source for anything', async () => {
    const s = source('fake', () => new FakeTransport());
    const host = new MachineWorkerHost(s);
    expect(await host.handle({ v: 1, kind: 'open', baudRate: 1200 })).toMatchObject({ ok: false, kind: 'invalid', code: 'invalid-request' });
    expect(s.requests).toBe(0);
  });

  it('opens through the guard with the session options, reports the identity, and counts bytes read', async () => {
    const t = new FakeTransport();
    const host = new MachineWorkerHost(source('fake', () => t));
    expect(await host.handle({ v: 1, kind: 'open' })).toEqual({ v: 1, ok: true, kind: 'open', info: { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 } });
    expect(t.opened).toEqual([{ baudRate: 115200, flowControl: 'none', bufferSize: 256 }]);
    expect(SESSION_OPEN_OPTIONS).toEqual({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
    t.feed(new Uint8Array(5));
    t.feed(new Uint8Array(3));
    await tick();
    expect(await host.handle({ v: 1, kind: 'status' })).toMatchObject({ status: { source: 'fake', state: 'open', bytesReceived: 8 } });
    expect(t.writes).toEqual([]);
  });

  it('never opens a port the guard refuses: the Arduino Due programming port', async () => {
    const t = new FakeTransport({ kind: 'sim', usbVendorId: 0x2341, usbProductId: 0x003d });
    const host = new MachineWorkerHost(source('fake', () => t));
    const reply = await host.handle({ v: 1, kind: 'open' });
    expect(reply).toMatchObject({ ok: false, kind: 'open', code: 'open-failed' });
    expect(reply).toHaveProperty('message', expect.stringContaining('(refused-port)'));
    expect(t.opened).toEqual([]);
    expect(await host.handle({ v: 1, kind: 'status' })).toMatchObject({ status: { state: 'idle' } });
  });

  it('reports a port that fails to open, and returns to idle', async () => {
    const t = new FakeTransport();
    t.failOpen = new Error('NetworkError: Failed to open serial port.');
    const host = new MachineWorkerHost(source('fake', () => t));
    expect(await host.handle({ v: 1, kind: 'open' })).toEqual({
      v: 1,
      ok: false,
      kind: 'open',
      code: 'open-failed',
      message: 'the port was not opened: NetworkError: Failed to open serial port.',
    });
    expect(await host.handle({ v: 1, kind: 'status' })).toMatchObject({ status: { state: 'idle' } });
  });

  it('answers unavailable when no port is chosen or the source fails', async () => {
    expect(await new MachineWorkerHost(source('serial', () => null)).handle({ v: 1, kind: 'open' })).toMatchObject({ code: 'unavailable', message: 'no port was chosen' });
    const failing = new MachineWorkerHost(source('serial', () => Promise.reject(new Error('picker dismissed')) as Promise<never>));
    expect(await failing.handle({ v: 1, kind: 'open' })).toMatchObject({ code: 'unavailable', message: 'the transport source failed: picker dismissed' });
    const odd = new MachineWorkerHost(source('serial', () => Promise.reject('odd') as Promise<never>));
    expect(await odd.handle({ v: 1, kind: 'open' })).toMatchObject({ message: 'the transport source failed: odd' });
    expect(await odd.handle({ v: 1, kind: 'status' })).toMatchObject({ status: { state: 'idle' } });
  });

  it('refuses a second open while one is open, without asking the source again', async () => {
    const s = source('fake', () => new FakeTransport());
    const host = new MachineWorkerHost(s);
    const [first, second] = await Promise.all([host.handle({ v: 1, kind: 'open' }), host.handle({ v: 1, kind: 'open' })]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, code: 'busy', message: 'a link is already open' });
    expect(s.requests).toBe(1);
  });

  it('runs requests one at a time: a close sent with an open waits for the open', async () => {
    const t = new FakeTransport();
    const host = new MachineWorkerHost(source('fake', () => t));
    const [open, close] = await Promise.all([host.handle({ v: 1, kind: 'open' }), host.handle({ v: 1, kind: 'close' })]);
    expect(open).toMatchObject({ ok: true });
    expect(close).toEqual({ v: 1, ok: true, kind: 'close' });
    expect(t.closed).toBe(1);
  });

  it('closes, resets the byte count, and can open a fresh link afterwards', async () => {
    const links: FakeTransport[] = [];
    const host = new MachineWorkerHost(
      source('fake', () => {
        const t = new FakeTransport();
        links.push(t);
        return t;
      }),
    );
    await host.handle({ v: 1, kind: 'open' });
    links[0]?.feed(new Uint8Array(4));
    await tick();
    expect(await host.handle({ v: 1, kind: 'close' })).toEqual({ v: 1, ok: true, kind: 'close' });
    expect(await host.handle({ v: 1, kind: 'status' })).toMatchObject({ status: { state: 'idle', bytesReceived: 0 } });
    expect(await host.handle({ v: 1, kind: 'close' })).toMatchObject({ ok: false, code: 'not-open' });
    expect(await host.handle({ v: 1, kind: 'open' })).toMatchObject({ ok: true });
    expect(links).toHaveLength(2);
  });

  it('reports a port error on close, and is idle afterwards whatever the port said', async () => {
    const t = new FakeTransport();
    t.failClose = new Error('stream locked');
    const host = new MachineWorkerHost(source('fake', () => t));
    await host.handle({ v: 1, kind: 'open' });
    expect(await host.handle({ v: 1, kind: 'close' })).toEqual({
      v: 1,
      ok: false,
      kind: 'close',
      code: 'close-failed',
      message: 'the port reported an error while closing: stream locked',
    });
    expect(await host.handle({ v: 1, kind: 'status' })).toMatchObject({ status: { state: 'idle' } });
    expect(await host.handle({ v: 1, kind: 'status' })).toMatchObject({ ok: true });
  });

  it('returns to idle when the link drops, and ignores a late drop from an old link', async () => {
    const links: FakeTransport[] = [];
    const host = new MachineWorkerHost(
      source('fake', () => {
        const t = new FakeTransport();
        links.push(t);
        return t;
      }),
    );
    await host.handle({ v: 1, kind: 'open' });
    links[0]?.disconnect();
    expect(await host.handle({ v: 1, kind: 'status' })).toMatchObject({ status: { state: 'idle' } });
    await host.handle({ v: 1, kind: 'open' });
    links[0]?.disconnect();
    expect(await host.handle({ v: 1, kind: 'status' })).toMatchObject({ status: { state: 'open' } });
  });

  it('survives a readable that errors (the link failing)', async () => {
    const t = new FakeTransport();
    Object.defineProperty(t, 'readable', {
      get: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('NetworkError: The device has been lost.')) }),
      }),
    });
    const host = new MachineWorkerHost(source('fake', () => t));
    expect(await host.handle({ v: 1, kind: 'open' })).toMatchObject({ ok: true });
    await tick();
    expect(await host.handle({ v: 1, kind: 'status' })).toMatchObject({ ok: true, status: { bytesReceived: 0 } });
  });
});
