/**
 * `machine.worker` request handling (ROADMAP P0-14, P1-02): the strict
 * request parser, and `MachineWorkerHost` driving the read-only
 * `MachineSession`. The browser-level behaviour (the worker starts under the
 * production CSP and Trusted Types, refuses `open` in production, runs the
 * session against the mock board in the fake-serial build) is asserted by
 * the Playwright suites in tools/e2e.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PortSelector, SessionClock, Transport, TransportInfo, TransportOpenOptions, TransportSource } from '@synthetos/machine';
import { SESSION_BAUD_RATES, SESSION_OPEN_OPTIONS } from '@synthetos/machine';
import { MachineWorkerHost, SNAPSHOT_INTERVAL_MS, realClock, workerState } from '../src/machine-worker/host.ts';
import { MAX_BOARD_ID_LENGTH, MAX_READ_TOKENS, parseRequest, type SnapshotMessage } from '../src/machine-worker/rpc.ts';
import { createTransportSource } from '../src/machine-worker/transport.ts';

/** The worker's navigator on a desktop OS: Node's own (`Node.js/<v>`) is not one, and T-S77 refuses an OS it cannot tell. */
const DESKTOP_NAVIGATOR = Object.freeze({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', maxTouchPoints: 0 });
vi.stubGlobal('navigator', DESKTOP_NAVIGATOR);

/** Edge-next answers (footer rev 3) for the probe and READING, keyed by token. */
const EN: Readonly<Record<string, string>> = {
  sr: '{"r":{"sr":{"posx":0,"vel":0,"stat":1}},"f":[3,0,10]}',
  fb: '{"r":{"fb":450.01},"f":[3,0,10]}',
  fv: '{"r":{"fv":0.97},"f":[3,0,10]}',
  hp: '{"r":{"hp":1},"f":[3,0,10]}',
  id: '{"r":{"id":"EN-1"},"f":[3,0,10]}',
  hv: '{"r":{"hv":8},"f":[3,0,10]}',
  fbs: '{"r":{},"f":[3,100,10]}',
  spep: '{"r":{"spep":1},"f":[3,0,10]}',
  prbp: '{"r":{"prbp":0},"f":[3,0,10]}',
  fstk: '{"r":{"fstk":900},"f":[3,0,10]}',
  os: '{"r":{"os":0},"f":[3,0,10]}',
  spph: '{"r":{},"f":[3,17,10]}',
  stat: '{"r":{"stat":1},"f":[3,0,10]}',
  hold: '{"r":{"hold":0},"f":[3,0,10]}',
  vel: '{"r":{"vel":0},"f":[3,0,10]}',
  qr: '{"r":{"qr":32},"f":[3,0,10]}',
  ex: '{"r":{"ex":1},"f":[3,0,10]}',
  posx: '{"r":{"posx":12.5},"f":[3,0,10]}',
  mpo: '{"r":{"mpo":{"x":3.5,"y":0,"z":0,"a":0,"b":0,"c":0}},"f":[3,0,10]}',
};

/** A Transport that answers GETs like an idle edge-next board, and whose stream the test can end or fail. */
class BoardTransport implements Transport {
  readonly opened: TransportOpenOptions[] = [];
  readonly writes: string[] = [];
  closed = 0;
  failOpen: Error | undefined;
  silent = false;
  #info: TransportInfo;
  #queue: (Uint8Array | Error | null)[] = [];
  #wake: (() => void) | undefined;
  readonly #disconnect: (() => void)[] = [];
  /** When set, close() waits for it. */
  closeGate: Promise<void> | undefined;

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
    const text = new TextDecoder().decode(line);
    this.writes.push(text);
    const m = /^\{"([^"]+)":null\}\n$/.exec(text);
    const reply = m === null || this.silent ? undefined : EN[m[1] as string];
    if (reply !== undefined) queueMicrotask(() => this.feed(`${reply}\n`));
  }
  get readable(): AsyncIterable<Uint8Array> {
    const next = async (): Promise<IteratorResult<Uint8Array>> => {
      for (;;) {
        const item = this.#queue.shift();
        if (item === null) return { done: true, value: undefined };
        if (item instanceof Error) throw item;
        if (item !== undefined) return { done: false, value: item };
        await new Promise<void>((resolve) => (this.#wake = resolve));
      }
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
  feed(data: string | Error | null): void {
    this.#queue.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    this.#wake?.();
  }
  async close(): Promise<void> {
    this.closed += 1;
    if (this.closeGate !== undefined) await this.closeGate;
    this.feed(null);
  }
  onDisconnect(callback: () => void): void {
    this.#disconnect.push(callback);
  }
  disconnect(): void {
    for (const cb of this.#disconnect) cb();
    this.feed(new Error('NetworkError: The device has been lost.'));
  }
}

function source(kind: TransportSource['kind'], make: () => Transport | null | Promise<never>): TransportSource & { requests: number; selectors: PortSelector[] } {
  const s = {
    kind,
    requests: 0,
    selectors: [] as PortSelector[],
    request: async (port: PortSelector) => {
      s.requests += 1;
      s.selectors.push(port);
      return make();
    },
  };
  return s;
}

/** A clock whose timers fire when the test says. */
class TestClock implements SessionClock {
  t = 0;
  readonly timers = new Map<number, { at: number; cb: () => void }>();
  #id = 1;
  now(): number {
    return this.t;
  }
  setTimeout(cb: () => void, ms: number): number {
    const id = this.#id++;
    this.timers.set(id, { at: this.t + ms, cb });
    return id;
  }
  clearTimeout(id: number): void {
    this.timers.delete(id);
  }
  advance(ms: number): void {
    this.t += ms;
    for (const [id, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > this.t) continue;
      this.timers.delete(id);
      timer.cb();
    }
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** The port the window chose (an FTDI board, first in its granted list). */
const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const OPEN = { v: 3, kind: 'open', port: PORT } as const;
const STATUS = { v: 3, kind: 'status' } as const;

describe('parseRequest', () => {
  it.each(['close', 'status', 'subscribe', 'transcript'])('accepts exactly { v: 3, kind: %s }', (kind) => {
    expect(parseRequest({ v: 3, kind })).toEqual({ v: 3, kind });
    expect(parseRequest({ kind, v: 3 })).toEqual({ v: 3, kind });
  });

  it('accepts open with a port selector, and an optional board id of the selected machine', () => {
    expect(parseRequest(OPEN)).toEqual({ ...OPEN, boardId: null });
    expect(parseRequest({ ...OPEN, boardId: 'ABC-1' })).toEqual({ ...OPEN, boardId: 'ABC-1' });
    expect(parseRequest({ ...OPEN, boardId: null })).toEqual({ ...OPEN, boardId: null });
  });

  it('accepts the window intents and bounded reads', () => {
    for (const intent of ['feedhold', 'stopJob', 'spindleOffNow', 'ackFault', 'acknowledgeLost']) {
      expect(parseRequest({ v: 3, kind: 'intent', intent })).toEqual({ v: 3, kind: 'intent', intent });
    }
    expect(parseRequest({ v: 3, kind: 'read', tokens: ['posx', 'mpox'] })).toEqual({ v: 3, kind: 'read', tokens: ['posx', 'mpox'] });
  });

  it.each([
    ['null', null],
    ['a string', 'open'],
    ['an array', [1, 'open']],
    ['a missing version', { kind: 'status' }],
    ['the Phase 0 version', { v: 2, kind: 'status' }],
    ['a string version', { v: '3', kind: 'status' }],
    ['an unknown kind', { v: 3, kind: 'write' }],
    ['an inherited kind', { v: 3, kind: 'toString' }],
    ['open without a port', { v: 3, kind: 'open' }],
    ['open with a port name instead of a selector', { v: 3, kind: 'open', port: 'COM3' }],
    ['open with a malformed selector', { v: 3, kind: 'open', port: { ...PORT, grantIndex: -1 } }],
    ['open with an extra key', { ...OPEN, baudRate: 1200 }],
    ['open with an empty board id', { ...OPEN, boardId: '' }],
    ['open with a numeric board id', { ...OPEN, boardId: 7 }],
    ['open with a long board id', { ...OPEN, boardId: 'x'.repeat(MAX_BOARD_ID_LENGTH + 1) }],
    ['close with a port', { v: 3, kind: 'close', port: PORT }],
    ['a class instance', Object.assign(Object.create({ x: 1 }) as object, { v: 3, kind: 'status' })],
    ['an intent the window may not send (reset)', { v: 3, kind: 'intent', intent: 'resetController' }],
    ['an intent the session sends itself (enq)', { v: 3, kind: 'intent', intent: 'enq' }],
    ['a motion intent', { v: 3, kind: 'intent', intent: 'jog' }],
    ['an intent with an extra key', { v: 3, kind: 'intent', intent: 'feedhold', force: true }],
    ['a read without tokens', { v: 3, kind: 'read' }],
    ['a read of nothing', { v: 3, kind: 'read', tokens: [] }],
    ['a read of a string', { v: 3, kind: 'read', tokens: 'posx' }],
    ['a read of a number', { v: 3, kind: 'read', tokens: [1] }],
    ['a read of an empty token', { v: 3, kind: 'read', tokens: [''] }],
    ['a read of a long token', { v: 3, kind: 'read', tokens: ['x'.repeat(17)] }],
    ['a read of too many tokens', { v: 3, kind: 'read', tokens: Array.from({ length: MAX_READ_TOKENS + 1 }, () => 'posx') }],
    ['a read with an array subclass', { v: 3, kind: 'read', tokens: Object.setPrototypeOf(['posx'], Object.create(Array.prototype) as object) }],
  ])('refuses %s', (_label, data) => {
    expect(parseRequest(data)).toBeNull();
  });
});

describe('the release transport seam (P1-01: Web Serial)', () => {
  it('is the Web Serial source: kind serial, and no granted port here (Node has no navigator.serial), so request() resolves null', async () => {
    const s = createTransportSource();
    expect(s.kind).toBe('serial');
    expect(await s.request(PORT)).toBeNull();
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('so the worker answers open with unavailable and stays idle', async () => {
    const host = new MachineWorkerHost(createTransportSource());
    expect(await host.handle(OPEN)).toEqual({ v: 3, ok: false, kind: 'open', code: 'unavailable', message: 'no port was chosen' });
    expect(await host.handle(STATUS)).toMatchObject({ v: 3, ok: true, kind: 'status', status: { source: 'serial', state: 'idle', session: { base: 'NOT_CONNECTED' } } });
  });
});

describe('T-S77: open is refused on a mobile OS before the transport source is asked', () => {
  const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36', userAgentData: { mobile: true, platform: 'Android' } };

  it('Android with Web Serial: refused with the platform reason; the port is never requested', async () => {
    const s = source('serial', () => new BoardTransport());
    const host = new MachineWorkerHost(s, realClock(), ANDROID);
    const reply = await host.handle(OPEN);
    expect(reply).toMatchObject({ ok: false, kind: 'open', code: 'platform' });
    expect((reply as { message: string }).message).toContain('not available on phone or tablet operating systems');
    expect(s.requests).toBe(0);
    expect(host.session.snapshot.base).toBe('NOT_CONNECTED');
  });

  it('ChromeOS and an unknown OS are refused too; the default reads the worker navigator', async () => {
    const cros = new MachineWorkerHost(source('serial', () => new BoardTransport()), realClock(), { userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/140.0.0.0' });
    expect(await cros.handle(OPEN)).toMatchObject({ code: 'platform' });
    const none = new MachineWorkerHost(source('serial', () => new BoardTransport()), realClock(), {});
    expect(await none.handle(OPEN)).toMatchObject({ code: 'platform' });
    vi.stubGlobal('navigator', ANDROID);
    try {
      expect(await new MachineWorkerHost(source('serial', () => new BoardTransport())).handle(OPEN)).toMatchObject({ code: 'platform' });
    } finally {
      vi.stubGlobal('navigator', DESKTOP_NAVIGATOR);
    }
  });

  it('Pause is still answered on a refused platform (stops are never gated)', async () => {
    const host = new MachineWorkerHost(source('serial', () => new BoardTransport()), realClock(), ANDROID);
    expect(await host.handle(OPEN)).toMatchObject({ code: 'platform' });
    const reply = await host.handle({ v: 3, kind: 'intent', intent: 'feedhold' });
    // The same answer the session gives on a desktop host that was never opened: the platform rule adds nothing to it.
    const desktop = new MachineWorkerHost(source('serial', () => new BoardTransport()), realClock(), DESKTOP_NAVIGATOR);
    expect(reply).toEqual(await desktop.handle({ v: 3, kind: 'intent', intent: 'feedhold' }));
    expect(reply).toMatchObject({ kind: 'intent' });
    expect(reply).not.toMatchObject({ code: 'platform' });
  });
});

describe('MachineWorkerHost', () => {
  it('refuses an invalid message without asking the source for anything', async () => {
    const s = source('fake', () => new BoardTransport());
    const host = new MachineWorkerHost(s);
    expect(await host.handle({ ...OPEN, baudRate: 1200 })).toMatchObject({ ok: false, kind: 'invalid', code: 'invalid-request' });
    expect(s.requests).toBe(0);
  });

  it('opens through the guard with the session options, probes from {"sr":null}, and reports the session in status', async () => {
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t));
    expect(await host.handle(OPEN)).toEqual({ v: 3, ok: true, kind: 'open', info: { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 } });
    expect(t.opened).toEqual([SESSION_OPEN_OPTIONS]);
    expect([...SESSION_BAUD_RATES]).toEqual([SESSION_OPEN_OPTIONS.baudRate]);
    await settle();
    expect(t.writes[0]).toBe('{"sr":null}\n');
    expect(t.writes.every((w) => /^\{"[a-z0-9_]+":null\}\n$/.test(w))).toBe(true);
    expect(await host.handle(STATUS)).toMatchObject({
      status: { source: 'fake', state: 'open', session: { base: 'CONNECTED_UNKNOWN', classification: { dialectId: 'tinyg-en', mode: 'readOnly' }, identity: { id: 'EN-1' } } },
    });
  });

  it('transcript (P1-08): refused before any open; after one, the {t, dir, hex} JSONL of exactly the bytes written and received', async () => {
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t));
    expect(await host.handle({ v: 3, kind: 'transcript' })).toMatchObject({ ok: false, kind: 'transcript', code: 'unavailable', message: 'no port has been opened in this session' });
    await host.handle(OPEN);
    await settle();
    const reply = await host.handle({ v: 3, kind: 'transcript' });
    if (!reply.ok || reply.kind !== 'transcript') throw new Error('transcript refused');
    const lines = reply.jsonl.trimEnd().split('\n').map((l) => JSON.parse(l) as { t: number; dir: string; hex: string });
    expect(lines).toHaveLength(reply.events);
    const hexText = (h: string): string => new TextDecoder().decode(Uint8Array.from(h.match(/../g) ?? [], (b) => Number.parseInt(b, 16)));
    expect(lines.filter((l) => l.dir === 'tx').map((l) => hexText(l.hex))).toEqual(t.writes);
    expect(lines.some((l) => l.dir === 'rx')).toBe(true);
  });

  it('passes the selected machine\'s board id: a different board is BLOCKED and nothing more is written', async () => {
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t));
    await host.handle({ ...OPEN, boardId: 'OTHER' });
    await settle();
    expect(host.session.snapshot).toMatchObject({ base: 'BLOCKED', blocked: { expected: 'OTHER', reported: 'EN-1' } });
    expect(t.writes).toHaveLength(12);
  });

  it('never opens a port the guard refuses: the Arduino Due programming port', async () => {
    const t = new BoardTransport({ kind: 'sim', usbVendorId: 0x2341, usbProductId: 0x003d });
    const host = new MachineWorkerHost(source('fake', () => t));
    const reply = await host.handle(OPEN);
    expect(reply).toMatchObject({ ok: false, kind: 'open', code: 'open-failed' });
    expect(reply).toHaveProperty('message', expect.stringContaining('(refused-port)'));
    expect(t.opened).toEqual([]);
    expect(await host.handle(STATUS)).toMatchObject({ status: { state: 'idle' } });
  });

  it('reports a port that fails to open, and returns to idle', async () => {
    const t = new BoardTransport();
    t.failOpen = new Error('NetworkError: Failed to open serial port.');
    const host = new MachineWorkerHost(source('fake', () => t));
    expect(await host.handle(OPEN)).toEqual({ v: 3, ok: false, kind: 'open', code: 'open-failed', message: 'the port was not opened: NetworkError: Failed to open serial port.' });
    expect(await host.handle(STATUS)).toMatchObject({ status: { state: 'idle' } });
  });

  it('answers unavailable when no port is chosen or the source fails', async () => {
    expect(await new MachineWorkerHost(source('serial', () => null)).handle(OPEN)).toMatchObject({ code: 'unavailable', message: 'no port was chosen' });
    expect(await new MachineWorkerHost(source('none', () => null)).handle(OPEN)).toMatchObject({ code: 'unavailable', message: 'this build cannot connect to a controller' });
    const failing = new MachineWorkerHost(source('serial', () => Promise.reject(new Error('picker dismissed')) as Promise<never>));
    expect(await failing.handle(OPEN)).toMatchObject({ code: 'unavailable', message: 'the transport source failed: picker dismissed' });
  });

  it('a second open while one is open is denied by the allow-matrix, without asking the source again', async () => {
    const s = source('fake', () => new BoardTransport());
    const host = new MachineWorkerHost(s);
    const [first, second] = await Promise.all([host.handle(OPEN), host.handle(OPEN)]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, code: 'denied', message: 'Already connected.', decision: { reason: 'Already connected.', remedy: 'Disconnect first.' } });
    expect(s.requests).toBe(1);
  });

  it('close is the session Disconnect; afterwards a fresh link can be opened', async () => {
    const links: BoardTransport[] = [];
    const host = new MachineWorkerHost(
      source('fake', () => {
        const t = new BoardTransport();
        links.push(t);
        return t;
      }),
    );
    await host.handle(OPEN);
    await settle();
    expect(await host.handle({ v: 3, kind: 'close' })).toEqual({ v: 3, ok: true, kind: 'close' });
    expect(links[0]?.closed).toBe(1);
    expect(await host.handle(STATUS)).toMatchObject({ status: { state: 'idle', session: { base: 'NOT_CONNECTED' } } });
    expect(await host.handle({ v: 3, kind: 'close' })).toMatchObject({ ok: false, code: 'denied' });
    expect(await host.handle(OPEN)).toMatchObject({ ok: true });
    expect(links).toHaveLength(2);
  });

  it('a dropped link is LOST: the port is closed, and acknowledging it returns to idle', async () => {
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t));
    await host.handle(OPEN);
    await settle();
    t.disconnect();
    await settle();
    expect(t.closed).toBe(1);
    expect(await host.handle(STATUS)).toMatchObject({ status: { state: 'lost', session: { overlays: ['LOST', 'READ_ONLY'] } } });
    expect(await host.handle({ v: 3, kind: 'intent', intent: 'feedhold' })).toMatchObject({ ok: false, code: 'denied' });
    expect(await host.handle({ v: 3, kind: 'intent', intent: 'acknowledgeLost' })).toEqual({ v: 3, ok: true, kind: 'intent' });
    expect(await host.handle(STATUS)).toMatchObject({ status: { state: 'idle' } });
  });

  it('Pause, Stop job and Spindle off write only !, and are answered at once even while a close is still pending', async () => {
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t));
    await host.handle(OPEN);
    await settle();
    for (const intent of ['feedhold', 'stopJob', 'spindleOffNow']) {
      expect(await host.handle({ v: 3, kind: 'intent', intent })).toEqual({ v: 3, ok: true, kind: 'intent' });
    }
    await settle();
    expect(t.writes.slice(-3)).toEqual(['!', '!', '!']);
    expect(host.session.snapshot.notices.adviseEstop).toBe(true);
    // A close whose port takes its time: a Pause sent meanwhile is decided at once, not queued behind it.
    let release: () => void = () => undefined;
    t.closeGate = new Promise((r) => (release = r));
    const closing = host.handle({ v: 3, kind: 'close' });
    const pause = await host.handle({ v: 3, kind: 'intent', intent: 'feedhold' });
    expect(pause).toMatchObject({ ok: false, code: 'denied' });
    release();
    expect(await closing).toMatchObject({ ok: true });
  });

  it('ackFault is decided by the session (no fault: denied with the matrix reason)', async () => {
    const host = new MachineWorkerHost(source('fake', () => new BoardTransport()));
    await host.handle(OPEN);
    await settle();
    expect(await host.handle({ v: 3, kind: 'intent', intent: 'ackFault' })).toMatchObject({ ok: false, code: 'denied', decision: { reason: 'There is no fault to acknowledge here.' } });
  });

  it('read sends only allowlisted GETs; anything else is denied with the reason', async () => {
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t));
    await host.handle(OPEN);
    await settle();
    expect(await host.handle({ v: 3, kind: 'read', tokens: ['md'] })).toMatchObject({ ok: false, code: 'denied', message: 'Not on the tinyg-en read allowlist: "md".' });
    expect(await host.handle({ v: 3, kind: 'read', tokens: ['posx'] })).toEqual({ v: 3, ok: true, kind: 'read' });
    await settle();
    expect(t.writes.at(-1)).toBe('{"posx":null}\n');
    expect(host.session.snapshot.values['posx']).toMatchObject({ value: 12.5, status: 0 });
  });

  it('subscribe needs a reply port; with one, the snapshot is posted at once and then at most every 50 ms, the last never dropped', async () => {
    const clock = new TestClock();
    const t = new BoardTransport();
    t.silent = true;
    const host = new MachineWorkerHost(source('fake', () => t), clock);
    expect(await host.handle({ v: 3, kind: 'subscribe' })).toMatchObject({ ok: false, code: 'invalid-request' });
    const posted: SnapshotMessage[] = [];
    expect(await host.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => posted.push(m) })).toEqual({ v: 3, ok: true, kind: 'subscribe' });
    expect(posted.map((m) => m.snapshot.base)).toEqual(['NOT_CONNECTED']);
    void host.handle(OPEN);
    await settle();
    // Several state changes inside one interval: one trailing post with the latest snapshot.
    expect(posted).toHaveLength(1);
    clock.advance(SNAPSHOT_INTERVAL_MS);
    expect(posted.map((m) => m.snapshot.base)).toEqual(['NOT_CONNECTED', 'IDENTIFYING']);
    expect(posted[1]).toMatchObject({ v: 3, kind: 'snapshot' });
    // Long after the last post, a change is posted at once.
    clock.advance(10 * SNAPSHOT_INTERVAL_MS);
    expect(posted).toHaveLength(2);
    clock.advance(2999);
    await settle();
    expect(posted.at(-1)?.snapshot.overlays).toEqual(['ORPHANED_MOTION']);
  });

  it('a subscriber port that throws is dropped; the session carries on', async () => {
    const clock = new TestClock();
    const host = new MachineWorkerHost(source('fake', () => new BoardTransport()), clock);
    let calls = 0;
    await host.handle({ v: 3, kind: 'subscribe' }, {
      postMessage: () => {
        calls++;
        if (calls > 1) throw new Error('port closed');
      },
    });
    clock.advance(SNAPSHOT_INTERVAL_MS);
    void host.handle(OPEN);
    await settle();
    clock.advance(SNAPSHOT_INTERVAL_MS);
    await settle();
    clock.advance(SNAPSHOT_INTERVAL_MS);
    expect(calls).toBe(2);
    expect(host.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
  });

  it('a new subscriber replaces the old one', async () => {
    const host = new MachineWorkerHost(source('fake', () => null), new TestClock());
    const a: SnapshotMessage[] = [];
    const b: SnapshotMessage[] = [];
    await host.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => a.push(m) });
    await host.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => b.push(m) });
    expect([a.length, b.length]).toEqual([1, 1]);
  });

  it('passes the chosen port to the source, unchanged', async () => {
    const s = source('serial', () => new BoardTransport());
    const host = new MachineWorkerHost(s);
    await host.handle({ ...OPEN, port: { usbVendorId: 0x2341, usbProductId: 0x003e, grantIndex: 3 } });
    expect(s.selectors).toEqual([{ usbVendorId: 0x2341, usbProductId: 0x003e, grantIndex: 3 }]);
  });

  it('workerState maps the session to the Phase 0 link words', () => {
    const snap = (base: string, overlays: string[] = []) => ({ base, overlays }) as unknown as Parameters<typeof workerState>[0];
    expect(workerState(snap('NOT_CONNECTED'))).toBe('idle');
    expect(workerState(snap('PORT_REQUEST'))).toBe('opening');
    expect(workerState(snap('OPENING'))).toBe('opening');
    expect(workerState(snap('IDENTIFYING'))).toBe('open');
    expect(workerState(snap('CONNECTED_UNKNOWN', ['LOST']))).toBe('lost');
  });

  it('realClock uses the worker timers', async () => {
    const clock = realClock();
    const start = clock.now();
    await new Promise<void>((resolve) => clock.setTimeout(resolve, 1));
    expect(clock.now()).toBeGreaterThanOrEqual(start);
    const id = clock.setTimeout(() => {
      throw new Error('cancelled timer fired');
    }, 1);
    clock.clearTimeout(id);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
});

describe('P1-07: the polled mpo position and the drift report', () => {
  it('parses exactly { v: 3, kind: drift, epoch } with a whole, non-negative epoch', () => {
    expect(parseRequest({ v: 3, kind: 'drift', epoch: 2 })).toEqual({ v: 3, kind: 'drift', epoch: 2 });
    for (const bad of [{ v: 3, kind: 'drift' }, { v: 3, kind: 'drift', epoch: -1 }, { v: 3, kind: 'drift', epoch: 1.5 }, { v: 3, kind: 'drift', epoch: '1' }, { v: 3, kind: 'drift', epoch: 1, extra: 1 }]) {
      expect(parseRequest(bad)).toBeNull();
    }
  });

  it('the host polls {"mpo":null} every 500 ms once a board is classified, and drift raises NEEDS_REVIEW', async () => {
    const clock = new TestClock();
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t), clock);
    clock.advance(2000);
    expect(t.writes).toEqual([]);
    await host.handle(OPEN);
    await settle();
    expect(host.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    clock.advance(500);
    await settle();
    expect(t.writes.at(-1)).toBe('{"mpo":null}\n');
    expect(host.poller.polls).toBe(1);
    expect(host.session.snapshot.values['mpo']).toMatchObject({ value: { x: 3.5 }, status: 0 });

    const epoch = host.session.snapshot.epoch;
    expect(await host.handle({ v: 3, kind: 'drift', epoch: epoch + 1 })).toEqual({ v: 3, ok: true, kind: 'drift' });
    expect(host.session.snapshot.overlays).not.toContain('NEEDS_REVIEW');
    expect(await host.handle({ v: 3, kind: 'drift', epoch })).toEqual({ v: 3, ok: true, kind: 'drift' });
    expect(host.session.snapshot.overlays).toContain('NEEDS_REVIEW');
  });

  it('every posted snapshot carries its DRO view, computed from polled mpo on the worker clock, and the lag thresholds', async () => {
    const clock = new TestClock();
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t), clock);
    const posted: SnapshotMessage[] = [];
    await host.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => posted.push(m) });
    expect(posted[0]?.dro.machineSource).toEqual({ label: 'polled mpo', at: null, ageMs: null, lag: 'none' });
    expect(posted[0]?.lag).toEqual({ amberMs: 1000, redMs: 2000 });
    await host.handle(OPEN);
    await settle();
    clock.advance(500);
    await settle();
    clock.advance(100);
    const last = posted.at(-1) as SnapshotMessage;
    expect(last.dro.axes[0]).toMatchObject({ axis: 'x', machine: 3.5 });
    expect(last.dro.machineSource.label).toBe('polled mpo');
  });
});
