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
import { openConfirmedPort, openRequest } from '../src/live/mount.ts';
import { createTransportSource } from '../src/machine-worker/transport.ts';
import { approvalEnvironment, approvedBuildsFor } from '../src/machine-worker/approval.ts';
import { motionEnabledFor, releaseFor } from '../src/machine-worker/motionFlag.ts';
import { PHASE_1_RELEASE, PHASE_2_RELEASE, type Release } from '@synthetos/safety';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RELEASE_KEYS, SIGNING_PREFIX, type ReleaseKey } from '@synthetos/protocol';

/** The worker's navigator on a desktop OS: Node's own (`Node.js/<v>`) is not one, and T-S77 refuses an OS it cannot tell. */
const DESKTOP_NAVIGATOR = Object.freeze({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', maxTouchPoints: 0 });
vi.stubGlobal('navigator', DESKTOP_NAVIGATOR);

/** Edge-next answers (footer rev 3) for the probe and READING, keyed by token. */
const EN: Readonly<Record<string, string>> = {
  sr: '{"r":{"sr":{"posx":0,"vel":0,"stat":1}},"f":[3,0,10]}',
  fb: '{"r":{"fb":450.02},"f":[3,0,10]}',
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
  // The rest of the connect-time state read (amendment 2026-11-02).
  home: '{"r":{"home":0},"f":[3,0,10]}',
  hom: '{"r":{"hom":{"x":0,"y":0,"z":0}},"f":[3,0,10]}',
  coor: '{"r":{"coor":1},"f":[3,0,10]}',
  dist: '{"r":{"dist":0},"f":[3,0,10]}',
  tool: '{"r":{"tool":0},"f":[3,0,10]}',
  pos: '{"r":{"pos":{"x":12.5,"y":0,"z":0}},"f":[3,0,10]}',
  ofs: '{"r":{"ofs":{"x":0,"y":0,"z":0}},"f":[3,0,10]}',
  g92: '{"r":{"g92":{"x":0,"y":0,"z":0}},"f":[3,0,10]}',
  g28: '{"r":{"g28":{"x":0,"y":0,"z":0}},"f":[3,0,10]}',
  g30: '{"r":{"g30":{"x":0,"y":0,"z":0}},"f":[3,0,10]}',
  spe: '{"r":{"spe":0},"f":[3,0,10]}',
  spc: '{"r":{"spc":0},"f":[3,0,10]}',
  spd: '{"r":{"spd":0},"f":[3,0,10]}',
  sps: '{"r":{"sps":0},"f":[3,0,10]}',
  cof: '{"r":{"cof":0},"f":[3,0,10]}',
  com: '{"r":{"com":0},"f":[3,0,10]}',
  sv: '{"r":{"sv":1},"f":[3,0,10]}',
  si: '{"r":{"si":250},"f":[3,0,10]}',
  // No heartbeat on this scripted board.
  rt: '{"r":{},"f":[3,100,10]}',
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

  readonly #answers: Record<string, string>;

  constructor(info: TransportInfo = { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 }, answers: Readonly<Record<string, string>> = EN) {
    this.#info = info;
    this.#answers = { unit: '{"r":{"unit":1},"f":[3,0,10]}', xvm: '{"r":{"xvm":16000},"f":[3,0,10]}', ...answers };
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
    // The status report list (amendment 2026-11-02): replaced, answered with its values, read back by {"sr":null}.
    const list = /^\{sr:\{(.*)\}\}\n$/.exec(text);
    if (list !== null && !this.silent) {
      const body = `{${(list[1] as string).split(',').map((p) => p.split(':')[0] as string).map((k) => `"${k}":${k === 'coor' || k === 'unit' || k === 'stat' ? 1 : k === 'qr' ? 32 : 0}`).join(',')}}`;
      this.#answers['sr'] = `{"r":{"sr":${body}},"f":[3,0,10]}`;
      queueMicrotask(() => this.feed(`{"r":{"sr":${body}},"f":[3,0,10]}\n`));
      return;
    }
    const set = /^\{"([a-z0-9_]+)":(-?[0-9.]+)\}\n$/.exec(text);
    if (set !== null && !this.silent) {
      // A settings write: stored, echoed (read back by the next GET).
      const [, key, value] = set as unknown as [string, string, string];
      this.#answers[key] = `{"r":{"${key}":${value}},"f":[3,0,10]}`;
      queueMicrotask(() => this.feed(`{"r":{"${key}":${value}},"f":[3,0,10]}\n`));
      return;
    }
    const m = /^\{"?([^":]+)"?:null\}\n$/.exec(text);
    const reply = m === null || this.silent ? undefined : this.#answers[m[1] as string];
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
    expect(parseRequest(OPEN)).toEqual({ ...OPEN, boardId: null, previousSessionEnded: false });
    expect(parseRequest({ ...OPEN, boardId: 'ABC-1' })).toEqual({ ...OPEN, boardId: 'ABC-1', previousSessionEnded: false });
    expect(parseRequest({ ...OPEN, boardId: null })).toEqual({ ...OPEN, boardId: null, previousSessionEnded: false });
  });

  it('accepts open with previousSessionEnded (W6), a boolean only', () => {
    expect(parseRequest({ ...OPEN, previousSessionEnded: true })).toEqual({ ...OPEN, boardId: null, previousSessionEnded: true });
    expect(parseRequest({ ...OPEN, boardId: 'ABC-1', previousSessionEnded: false })).toEqual({ ...OPEN, boardId: 'ABC-1', previousSessionEnded: false });
    expect(parseRequest({ ...OPEN, previousSessionEnded: 'yes' })).toBeNull();
    expect(parseRequest({ ...OPEN, previousSessionEnded: 1 })).toBeNull();
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
    expect(await host.handle(OPEN)).toEqual({ v: 3, ok: false, kind: 'open', code: 'unavailable', message: 'no confirmed port selection' });
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

  it('opens through the guard with the session options, probes from {sr:null}, and reports the session in status', async () => {
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t));
    expect(await host.handle(OPEN)).toEqual({ v: 3, ok: true, kind: 'open', info: { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 } });
    expect(t.opened).toEqual([SESSION_OPEN_OPTIONS]);
    expect([...SESSION_BAUD_RATES]).toEqual([SESSION_OPEN_OPTIONS.baudRate]);
    await settle();
    expect(t.writes[0]).toBe('{sr:null}\n');
    expect(t.writes.every((w) => /^\{"?[a-z0-9_]+"?:null\}\n$/.test(w))).toBe(true);
    expect(await host.handle(STATUS)).toMatchObject({
      status: { source: 'fake', state: 'open', session: { base: 'CONNECTED_UNKNOWN', classification: { dialectId: 'tinyg-en', mode: 'readOnly' }, identity: { id: 'EN-1' } } },
    });
  });

  it('a W6 marker (previousSessionEnded) makes the connect start in the UNKNOWN overlay (SAFETY §3); a plain open does not', async () => {
    // The window's open request carries the W6 state (mount.ts openRequest).
    expect(openRequest(PORT, true)).toEqual({ ...OPEN, boardId: null, previousSessionEnded: true });
    const marked = new MachineWorkerHost(source('fake', () => new BoardTransport()));
    expect(await marked.handle(openRequest(PORT, true))).toMatchObject({ ok: true, kind: 'open' });
    await settle();
    const after = await marked.handle(STATUS);
    if (!after.ok || after.kind !== 'status') throw new Error('status refused');
    expect(after.status.session?.overlays).toContain('UNKNOWN');

    const plain = new MachineWorkerHost(source('fake', () => new BoardTransport()));
    await plain.handle(OPEN);
    await settle();
    const fresh = await plain.handle(STATUS);
    if (!fresh.ok || fresh.kind !== 'status') throw new Error('status refused');
    expect(fresh.status.session?.overlays).not.toContain('UNKNOWN');
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
    expect(await new MachineWorkerHost(source('serial', () => null)).handle({ v: 3, kind: 'prepare', port: PORT })).toMatchObject({ code: 'unavailable', message: 'the granted ports changed or the selection expired' });
    expect(await new MachineWorkerHost(source('none', () => null)).handle(OPEN)).toMatchObject({ code: 'unavailable', message: 'this build cannot connect to a controller' });
    const failing = new MachineWorkerHost(source('serial', () => Promise.reject(new Error('picker dismissed')) as Promise<never>));
    expect(await failing.handle({ v: 3, kind: 'prepare', port: PORT })).toMatchObject({ code: 'unavailable', message: 'the granted ports could not be verified' });
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
    await host.handle({ v: 3, kind: 'prepare', port: { usbVendorId: 0x2341, usbProductId: 0x003e, grantIndex: 3 } });
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

describe('P1-07: the position from the connect-time read and pushed reports, and the drift report', () => {
  it('parses exactly { v: 3, kind: drift, epoch } with a whole, non-negative epoch', () => {
    expect(parseRequest({ v: 3, kind: 'drift', epoch: 2 })).toEqual({ v: 3, kind: 'drift', epoch: 2 });
    expect(parseRequest({ v: 3, kind: 'drift', epoch: 2, resolved: true })).toEqual({ v: 3, kind: 'drift', epoch: 2, resolved: true });
    expect(parseRequest({ v: 3, kind: 'drift', epoch: 2, resolved: false })).toBeNull();
    for (const bad of [{ v: 3, kind: 'drift' }, { v: 3, kind: 'drift', epoch: -1 }, { v: 3, kind: 'drift', epoch: 1.5 }, { v: 3, kind: 'drift', epoch: '1' }, { v: 3, kind: 'drift', epoch: 1, extra: 1 }]) {
      expect(parseRequest(bad)).toBeNull();
    }
  });

  it('the host never polls: after the connect-time read nothing is written while idle, and drift raises NEEDS_REVIEW', async () => {
    const clock = new TestClock();
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t), clock);
    clock.advance(2000);
    expect(t.writes).toEqual([]);
    await host.handle(OPEN);
    await settle();
    expect(host.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    expect(t.writes).toContain('{"mpo":null}\n');
    expect(t.writes).toContain('{"spe":null}\n');
    const after = t.writes.length;
    clock.advance(4000);
    await settle();
    // Push-driven (amendment 2026-11-02): no mpo or readout poll; the watchdog's fallback ask comes only after 5 s.
    expect(t.writes.slice(after)).toEqual([]);
    expect(host.session.snapshot.live.mpo).toMatchObject({ x: 3.5 });
    expect(host.session.snapshot.live.spe).toBe(0);

    const epoch = host.session.snapshot.epoch;
    expect(await host.handle({ v: 3, kind: 'drift', epoch: epoch + 1 })).toEqual({ v: 3, ok: true, kind: 'drift' });
    expect(host.session.snapshot.overlays).not.toContain('NEEDS_REVIEW');
    expect(await host.handle({ v: 3, kind: 'drift', epoch })).toEqual({ v: 3, ok: true, kind: 'drift' });
    expect(host.session.snapshot.overlays).toContain('NEEDS_REVIEW');
    // Kept as the reference (C23): resolved for this link only (OD-13 §5).
    expect(await host.handle({ v: 3, kind: 'drift', epoch: epoch + 1, resolved: true })).toEqual({ v: 3, ok: true, kind: 'drift' });
    expect(host.session.snapshot.overlays).toContain('NEEDS_REVIEW');
    expect(await host.handle({ v: 3, kind: 'drift', epoch, resolved: true })).toEqual({ v: 3, ok: true, kind: 'drift' });
    expect(host.session.snapshot.overlays).not.toContain('NEEDS_REVIEW');
  });

  it('every posted snapshot carries its DRO view, computed on the worker clock, and the lag thresholds of its silence window', async () => {
    const clock = new TestClock();
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t), clock);
    const posted: SnapshotMessage[] = [];
    await host.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => posted.push(m) });
    expect(posted[0]?.dro.machineSource).toEqual({ label: 'status report', at: null, ageMs: null, lag: 'none' });
    expect(posted[0]?.lag).toEqual({ amberMs: 5600, redMs: 7000 });
    await host.handle(OPEN);
    await settle();
    clock.advance(500);
    await settle();
    clock.advance(100);
    const last = posted.at(-1) as SnapshotMessage;
    expect(last.dro.axes[0]).toMatchObject({ axis: 'x', machine: 3.5 });
    expect(last.dro.machineSource.label).toBe('status report');
  });
});


describe('serial selection preparation', () => {
  it('does not acquire or open a live port without preparation', async () => {
    const board = new BoardTransport();
    const s = source('serial', () => board);
    const host = new MachineWorkerHost(s, new TestClock());
    expect(await host.handle(OPEN)).toMatchObject({ ok: false, code: 'unavailable' });
    expect(s.requests).toBe(0);
    expect(board.opened).toEqual([]);
  });

  it('holds the prepared unopened transport, consumes its ticket once, and never reselects', async () => {
    const board = new BoardTransport();
    const replacement = new BoardTransport();
    let current = board;
    const s = source('serial', () => current);
    const host = new MachineWorkerHost(s, new TestClock());
    const prep = await host.handle({ v: 3, kind: 'prepare', port: PORT });
    expect(prep).toMatchObject({ ok: true, kind: 'prepare' });
    expect(board.opened).toEqual([]);
    if (!prep.ok || prep.kind !== 'prepare') throw new Error('no preparation');
    current = replacement;
    expect(await host.handle({ ...OPEN, preparation: prep.preparation })).toMatchObject({ ok: true });
    expect(board.opened).toHaveLength(1);
    expect(replacement.opened).toEqual([]);
    expect(s.requests).toBe(1);
    await host.handle({ v: 3, kind: 'close' });
    expect(await host.handle({ ...OPEN, preparation: prep.preparation })).toMatchObject({ ok: false });
  });
});


it('the UI confirms only after worker preparation, and never opens after a failed confirmation', async () => {
  for (const valid of [false, true]) {
    const calls: string[] = [];
    const result = await openConfirmedPort(async (request) => {
      calls.push(request.kind);
      if (request.kind === 'prepare') return { v: 3, ok: true, kind: 'prepare', preparation: 7 };
      expect(request).toMatchObject({ kind: 'open', preparation: 7, previousSessionEnded: true });
      return { v: 3, ok: true, kind: 'open', info: { kind: 'sim' } };
    }, PORT, async () => { calls.push('confirm'); return valid; }, true);
    expect(result.ok).toBe(valid);
    expect(calls).toEqual(valid ? ['prepare', 'confirm', 'open'] : ['prepare', 'confirm']);
  }
});

it('serial preparations expire, are bound to the selector, and are invalidated by disconnect', async () => {
  const board = new BoardTransport();
  const clock = new TestClock();
  const s = source('serial', () => board);
  const host = new MachineWorkerHost(s, clock);
  const prep = await host.handle({ v: 3, kind: 'prepare', port: PORT });
  if (!prep.ok || prep.kind !== 'prepare') throw new Error('no preparation');
  expect(await host.handle({ ...OPEN, preparation: prep.preparation, port: { ...PORT, grantIndex: 1 } })).toMatchObject({ ok: false });
  clock.advance(15_000);
  expect(await host.handle({ ...OPEN, preparation: prep.preparation })).toMatchObject({ ok: false });
  const fresh = await host.handle({ v: 3, kind: 'prepare', port: PORT });
  if (!fresh.ok || fresh.kind !== 'prepare') throw new Error('no preparation');
  await host.handle({ v: 3, kind: 'close' });
  expect(await host.handle({ ...OPEN, preparation: fresh.preparation })).toMatchObject({ ok: false });
  expect(board.opened).toEqual([]);
});

it('a late preparation cannot replace a newer one or survive a disconnect', async () => {
  for (const disconnect of [false, true]) {
    const old = new BoardTransport();
    const fresh = new BoardTransport();
    let resolve!: (port: Transport) => void;
    let calls = 0;
    const host = new MachineWorkerHost({ kind: 'serial', request: () => ++calls === 1 ? new Promise<Transport>((r) => { resolve = r; }) : Promise.resolve(fresh) }, new TestClock());
    const first = host.handle({ v: 3, kind: 'prepare', port: PORT });
    const second = await host.handle({ v: 3, kind: 'prepare', port: PORT });
    if (disconnect) await host.handle({ v: 3, kind: 'close' });
    resolve(old);
    expect(await first).toMatchObject({ ok: false });
    if (!second.ok || second.kind !== 'prepare') throw new Error('no preparation');
    expect((await host.handle({ ...OPEN, preparation: second.preparation })).ok).toBe(!disconnect);
    expect(old.opened).toEqual([]);
    await host.handle({ v: 3, kind: 'close' });
  }
});

it('copies snapshot arrays and refuses malformed preparation tickets', () => {
  const grantSnapshot = ['1027:24597'];
  const parsed = parseRequest({ v: 3, kind: 'prepare', port: { ...PORT, grantSnapshot } });
  grantSnapshot[0] = '1:2';
  expect(parsed).toMatchObject({ port: { grantSnapshot: ['1027:24597'] } });
  for (const preparation of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) expect(parseRequest({ ...OPEN, preparation })).toBeNull();
  expect(parseRequest({ v: 3, kind: 'prepare', port: PORT, extra: 1 })).toBeNull();
});

it('preparation never waits ahead of safety intents, and late or non-idle selections refuse', async () => {
  const board = new BoardTransport();
  const clock = new TestClock();
  let resolve!: (port: Transport) => void;
  const host = new MachineWorkerHost({ kind: 'serial', request: () => new Promise<Transport>((r) => { resolve = r; }) }, clock);
  const pending = host.handle({ v: 3, kind: 'prepare', port: PORT });
  expect(await host.handle({ v: 3, kind: 'intent', intent: 'feedhold' })).toMatchObject({ kind: 'intent' });
  clock.advance(15_000);
  resolve(board);
  expect(await pending).toMatchObject({ ok: false });
  expect(board.opened).toEqual([]);
  const live = new MachineWorkerHost(source('fake', () => new BoardTransport()), new TestClock());
  await live.handle(OPEN);
  expect(await live.handle({ v: 3, kind: 'prepare', port: PORT })).toMatchObject({ ok: false });
  await live.handle({ v: 3, kind: 'close' });
  const mobile = new MachineWorkerHost(source('serial', () => board), new TestClock(), { userAgent: 'Android' });
  expect(await mobile.handle({ v: 3, kind: 'prepare', port: PORT })).toMatchObject({ code: 'platform' });
});

it('the UI never opens on missing, throwing or refused confirmation', async () => {
  const call = vi.fn(async () => ({ v: 3 as const, ok: true as const, kind: 'prepare' as const, preparation: 1 }));
  expect((await openConfirmedPort(call, PORT, undefined, false)).ok).toBe(false);
  expect(call).not.toHaveBeenCalled();
  expect((await openConfirmedPort(call, PORT, () => Promise.reject(new Error('gone')), false)).ok).toBe(false);
  expect(call).toHaveBeenCalledTimes(1);
  const confirm = vi.fn(async () => true);
  expect((await openConfirmedPort(async () => ({ v: 3, ok: false, kind: 'prepare', code: 'unavailable', message: 'gone' }), PORT, confirm, false)).ok).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------- P1-03: the signed approved-builds manifest in the worker

const COMMITTED_MANIFEST = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../firmware/approved-builds.json'), 'utf8')) as {
  format: string;
  channels: { channel: string; kid: string; payload: string; sig: string }[];
};
const BENCH_ORIGIN = 'http://localhost:8793';
const STAGING_ORIGIN = 'https://staging.run.synthetos.com';
const PRODUCTION_ORIGIN = 'https://run.synthetos.com';
const VALID_NOW = new Date('2026-11-06T12:00:00Z');

/** The committed file with the bench channel's payload replaced (signature kept). */
function tampered(): unknown {
  const copy = structuredClone(COMMITTED_MANIFEST);
  const bench = copy.channels.find((c) => c.channel === 'bench');
  if (bench === undefined) throw new Error('no bench channel');
  bench.payload = bench.payload.replace('450.02', '450.03');
  return copy;
}

/** The committed bench payload re-signed with a freshly generated key under the bench key id. */
async function wrongKey(): Promise<unknown> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const copy = structuredClone(COMMITTED_MANIFEST);
  for (const c of copy.channels) {
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(SIGNING_PREFIX + c.payload));
    c.sig = Buffer.from(new Uint8Array(sig)).toString('base64');
  }
  return copy;
}

/** A host whose worker verifies `file` for `origin` at `now`, against the release keys (or `keys`). */
function approvingHost(t: BoardTransport, file: unknown, origin: string, now: Date = VALID_NOW, keys?: readonly ReleaseKey[], release?: Release): MachineWorkerHost {
  return new MachineWorkerHost(
    source('fake', () => t),
    new TestClock(),
    undefined,
    {
      file,
      origin,
      verify: (f, o) => approvedBuildsFor(f, { origin: o, now, ...(keys === undefined ? {} : { keys }) }),
    },
    release,
  );
}

async function classifyWith(t: BoardTransport, host: MachineWorkerHost): Promise<{ mode: string; reason: string; dialectId: string | null }> {
  expect(await host.handle(OPEN)).toMatchObject({ ok: true, kind: 'open' });
  await settle();
  const status = await host.handle(STATUS);
  if (!status.ok || status.kind !== 'status') throw new Error('status refused');
  const c = status.status.session.classification;
  if (c === null) throw new Error('not classified');
  void t;
  return { mode: c.mode, reason: c.reason, dialectId: c.dialectId };
}

describe('P1-03: the worker classifies against the bundled, signed approved-builds manifest', () => {
  it('maps origins to environments: production and staging hosts as named, plain-HTTP loopback as staging, anything else none', () => {
    expect(approvalEnvironment(PRODUCTION_ORIGIN)).toBe('production');
    expect(approvalEnvironment(STAGING_ORIGIN)).toBe('staging');
    expect(approvalEnvironment(BENCH_ORIGIN)).toBe('staging');
    expect(approvalEnvironment('http://127.0.0.1:4173')).toBe('staging');
    for (const o of ['https://localhost:8793', 'http://run.synthetos.com', 'http://localhost.evil.example', 'http://10.0.0.2:8793', 'https://run-abc.workers.dev', 'null', '']) expect(approvalEnvironment(o)).toBeNull();
  });

  it('valid: the committed bench channel (owner bench key, staging) approves edge-next 450.02 on the bench and staging origins', async () => {
    const out = await approvedBuildsFor(COMMITTED_MANIFEST, { origin: BENCH_ORIGIN, now: VALID_NOW });
    expect(out.approved.environment).toBe('staging');
    expect(out.approved.builds).toEqual([expect.objectContaining({ channel: 'bench', dialect: 'tinyg-en', fb: 450.02, fbs: null })]);
    expect(out.channels).toEqual([{ channel: 'bench', accepted: true }, { channel: 'release', accepted: false, rejection: 'wrong-environment-for-channel' }]);
    for (const origin of [BENCH_ORIGIN, STAGING_ORIGIN]) {
      const t = new BoardTransport();
      expect(await classifyWith(t, approvingHost(t, COMMITTED_MANIFEST, origin))).toEqual({ mode: 'full', reason: 'en-approved', dialectId: 'tinyg-en' });
    }
  });

  it('the real worker path (no test verifier) uses the release keys and the clock: the committed file approves 450.02 on loopback', async () => {
    const t = new BoardTransport();
    const host = new MachineWorkerHost(source('fake', () => t), new TestClock(), undefined, { file: COMMITTED_MANIFEST, origin: BENCH_ORIGIN });
    expect((await classifyWith(t, host)).mode).toBe(new Date() < new Date('2027-05-01T00:00:00Z') ? 'full' : 'readOnly');
    expect(host.session.log().some((e) => e.dir === 'note' && e.text.startsWith('approved builds (staging): bench: accepted'))).toBe(true);
  });

  it('tampered: a changed payload fails its signature, nothing is approved, the board stays READ_ONLY', async () => {
    const out = await approvedBuildsFor(tampered(), { origin: BENCH_ORIGIN, now: VALID_NOW });
    expect(out.approved.builds).toEqual([]);
    expect(out.channels[0]).toEqual({ channel: 'bench', accepted: false, rejection: 'bad-signature' });
    const t = new BoardTransport();
    expect(await classifyWith(t, approvingHost(t, tampered(), BENCH_ORIGIN))).toMatchObject({ mode: 'readOnly', reason: 'en-not-approved' });
  });

  it('wrong key: a payload signed by any key but the compiled-in bench key is refused (bad signature under that kid; unknown kid)', async () => {
    const file = await wrongKey();
    expect((await approvedBuildsFor(file, { origin: BENCH_ORIGIN, now: VALID_NOW })).channels[0]).toEqual({ channel: 'bench', accepted: false, rejection: 'bad-signature' });
    const renamed = structuredClone(COMMITTED_MANIFEST);
    for (const c of renamed.channels) c.kid = 'someone-else';
    expect((await approvedBuildsFor(renamed, { origin: BENCH_ORIGIN, now: VALID_NOW })).channels[0]).toEqual({ channel: 'bench', accepted: false, rejection: 'unknown-key' });
    // The bench key is authorised for staging only: even a production-signed payload under it is refused.
    expect(RELEASE_KEYS.find((k) => k.kid === 'owner-bench-2026-11-02')?.environments).toEqual(['staging']);
    const t = new BoardTransport();
    expect(await classifyWith(t, approvingHost(t, file, BENCH_ORIGIN))).toMatchObject({ mode: 'readOnly', reason: 'en-not-approved' });
  });

  it('wrong environment: production reads only the empty release channel; any other origin reads nothing; both stay READ_ONLY', async () => {
    const prod = await approvedBuildsFor(COMMITTED_MANIFEST, { origin: PRODUCTION_ORIGIN, now: VALID_NOW });
    expect(prod.approved).toEqual({ environment: 'production', builds: [] });
    expect(prod.channels[0]).toEqual({ channel: 'bench', accepted: false, rejection: 'wrong-environment-for-channel' });
    const other = await approvedBuildsFor(COMMITTED_MANIFEST, { origin: 'https://run-abc.workers.dev', now: VALID_NOW });
    expect(other.approved.builds).toEqual([]);
    for (const origin of [PRODUCTION_ORIGIN, 'https://run-abc.workers.dev']) {
      const t = new BoardTransport();
      expect(await classifyWith(t, approvingHost(t, COMMITTED_MANIFEST, origin))).toMatchObject({ mode: 'readOnly', reason: 'en-not-approved' });
    }
  });

  it('expired: after the channel\'s expiry nothing is approved', async () => {
    const late = new Date('2027-05-01T00:00:00Z');
    expect((await approvedBuildsFor(COMMITTED_MANIFEST, { origin: BENCH_ORIGIN, now: late })).channels[0]).toEqual({ channel: 'bench', accepted: false, rejection: 'expired' });
    const t = new BoardTransport();
    expect(await classifyWith(t, approvingHost(t, COMMITTED_MANIFEST, BENCH_ORIGIN, late))).toMatchObject({ mode: 'readOnly', reason: 'en-not-approved' });
  });

  it('no match: an edge-next board reporting another fb, or an fbs the entry does not name, stays READ_ONLY', async () => {
    const other = new BoardTransport(undefined, { ...EN, fb: '{"r":{"fb":450.01},"f":[3,0,10]}' });
    expect(await classifyWith(other, approvingHost(other, COMMITTED_MANIFEST, BENCH_ORIGIN))).toMatchObject({ mode: 'readOnly', reason: 'en-not-approved', dialectId: 'tinyg-en' });
    const hashed = new BoardTransport(undefined, { ...EN, fbs: '{"r":{"fbs":"450.01-9-gdeadbee"},"f":[3,0,10]}' });
    expect(await classifyWith(hashed, approvingHost(hashed, COMMITTED_MANIFEST, BENCH_ORIGIN))).toMatchObject({ mode: 'readOnly', reason: 'en-not-approved' });
  });

  it('stock 449: no manifest can lift stock edge-0.97 out of READ_ONLY', async () => {
    const stock: Record<string, string> = {
      ...EN,
      fb: '{"r":{"fb":449.01},"f":[3,0,10]}',
      fbs: '{"r":{},"f":[3,100,10]}',
      spep: '{"r":{},"f":[3,100,10]}',
      prbp: '{"r":{},"f":[3,100,10]}',
      fstk: '{"r":{},"f":[3,100,10]}',
      os: '{"r":{},"f":[3,100,10]}',
      spph: '{"r":{},"f":[3,100,10]}',
    };
    const t = new BoardTransport(undefined, stock);
    expect(await classifyWith(t, approvingHost(t, COMMITTED_MANIFEST, BENCH_ORIGIN))).toEqual({ mode: 'readOnly', reason: 'stock-449', dialectId: 'tinyg-449-stock' });
  });

  it('a manifest is taken only while not connected; a malformed file approves nothing', async () => {
    const t = new BoardTransport();
    const host = approvingHost(t, COMMITTED_MANIFEST, BENCH_ORIGIN);
    await classifyWith(t, host);
    expect(host.session.useApprovedBuilds({ environment: 'staging', builds: [] })).toBe(false);
    expect((await approvedBuildsFor({ format: 'nope' }, { origin: BENCH_ORIGIN, now: VALID_NOW })).approved.builds).toEqual([]);
    expect((await approvedBuildsFor(null, { origin: BENCH_ORIGIN, now: VALID_NOW })).approved.builds).toEqual([]);
  });
});

// ---------------------------------------------------------------- settings writes through the worker (amendment 2026-11-02)

describe('settingWrite: the phase switch and the worker request', () => {
  it('parses exactly { v, kind: settingWrite, key, value } with a short key and a finite number', () => {
    expect(parseRequest({ v: 3, kind: 'settingWrite', key: 'xvm', value: 1234 })).toEqual({ v: 3, kind: 'settingWrite', key: 'xvm', value: 1234 });
    for (const bad of [
      { v: 3, kind: 'settingWrite', key: 'xvm' },
      { v: 3, kind: 'settingWrite', key: '', value: 1 },
      { v: 3, kind: 'settingWrite', key: 'x'.repeat(17), value: 1 },
      { v: 3, kind: 'settingWrite', key: 'xvm', value: '1234' },
      { v: 3, kind: 'settingWrite', key: 'xvm', value: Number.NaN },
      { v: 3, kind: 'settingWrite', key: 'xvm', value: 1, extra: 1 },
    ]) expect(parseRequest(bad)).toBeNull();
  });

  it('the worker turns settings writes on only for staging and the loopback bench; production and unknown origins stay read-only', () => {
    const at = (origin: string | null) => new MachineWorkerHost(source('fake', () => new BoardTransport()), new TestClock(), undefined, origin === null ? null : { file: COMMITTED_MANIFEST, origin }, origin === null ? undefined : releaseFor(origin));
    expect(at(BENCH_ORIGIN).release.settings).toBe(true);
    expect(at(STAGING_ORIGIN).release.settings).toBe(true);
    expect(at(PRODUCTION_ORIGIN).release.settings).toBeUndefined();
    expect(at('https://run-abc.workers.dev').release.settings).toBeUndefined();
    expect(at(null).release.settings).toBeUndefined();
  });

  it('production: a settings write is denied with "Not available in this release" and nothing is written', async () => {
    const t = new BoardTransport();
    const host = approvingHost(t, COMMITTED_MANIFEST, PRODUCTION_ORIGIN, VALID_NOW, undefined, releaseFor(PRODUCTION_ORIGIN));
    await classifyWith(t, host);
    expect(await host.handle({ v: 3, kind: 'settingWrite', key: 'xvm', value: 1234 })).toMatchObject({ ok: false, code: 'denied', message: 'Not available in this release.' });
    expect(t.writes.some((w) => w.includes('1234'))).toBe(false);
  });

  it('bench: an approved, idle board takes the write: gate reads, the write, the read-back; the snapshot says verified', async () => {
    // The bench release is Phase 2 with settings writes, so READING also reads `home` (the board then rests in IDLE_UNHOMED).
    const t = new BoardTransport(undefined, { ...EN, home: '{"r":{"home":0},"f":[3,0,10]}' });
    const host = approvingHost(t, COMMITTED_MANIFEST, BENCH_ORIGIN, VALID_NOW, undefined, releaseFor(BENCH_ORIGIN));
    await classifyWith(t, host);
    expect(await host.handle({ v: 3, kind: 'settingWrite', key: 'xvm', value: 1234 })).toEqual({ v: 3, ok: true, kind: 'settingWrite', id: 1 });
    await settle();
    expect(host.session.snapshot.settingWrite).toMatchObject({ id: 1, key: 'xvm', outcome: 'verified' });
    const after = t.writes.slice(t.writes.indexOf('{"stat":null}\n', t.writes.length - 8));
    expect(after).toEqual(['{"stat":null}\n', '{"hold":null}\n', '{"vel":null}\n', '{"qr":null}\n', '{"unit":null}\n', '{"xvm":1234}\n', '{"xvm":null}\n']);
    // An unapproved board (READ_ONLY) on the bench is not written.
    const ro = new BoardTransport(undefined, { ...EN, fb: '{"r":{"fb":450.01},"f":[3,0,10]}' });
    const roHost = approvingHost(ro, COMMITTED_MANIFEST, BENCH_ORIGIN, VALID_NOW, undefined, releaseFor(BENCH_ORIGIN));
    await classifyWith(ro, roHost);
    expect(await roHost.handle({ v: 3, kind: 'settingWrite', key: 'xvm', value: 1234 })).toMatchObject({ ok: false, code: 'denied' });
  });
});

describe('Phase 2: motion commands through the worker (SAFETY §4.5b, T-S92, T-S93)', () => {
  const EN_MOTION = { ...EN, home: '{"r":{"home":0},"f":[3,0,10]}', unit: '{"r":{"unit":1},"f":[3,0,10]}' };
  const phase2Host = (t: BoardTransport, origin: string): MachineWorkerHost =>
    new MachineWorkerHost(
      source('fake', () => t),
      new TestClock(),
      undefined,
      { file: COMMITTED_MANIFEST, origin, verify: (f, o) => approvedBuildsFor(f, { origin: o, now: VALID_NOW }) },
      releaseFor(origin),
    );

  it('the motion flag is on for loopback and staging only; production and every other origin keep Phase 1', () => {
    for (const o of [BENCH_ORIGIN, 'http://127.0.0.1:4173', 'http://localhost', STAGING_ORIGIN]) {
      expect(motionEnabledFor(o), o).toBe(true);
      // Phase 2 composed with the settings-write, jobs and flasher switches: all on in the staging environment.
      expect(releaseFor(o)).toMatchObject({ ...PHASE_2_RELEASE, name: 'Phase 2 + settings writes + jobs + flasher', settings: true, jobs: true, flash: true });
    }
    for (const o of [PRODUCTION_ORIGIN, 'http://run.synthetos.com', 'https://localhost:8793', 'https://run-abc.workers.dev', 'http://10.0.0.2:8793', 'null', '']) {
      expect(motionEnabledFor(o), o).toBe(false);
      expect(releaseFor(o)).toBe(PHASE_1_RELEASE);
    }
  });

  it('on the bench origin a jog reaches the board as a motion line; the snapshot carries the flag', async () => {
    const t = new BoardTransport(undefined, EN_MOTION);
    const host = phase2Host(t, BENCH_ORIGIN);
    expect((await classifyWith(t, host)).mode).toBe('full');
    expect(host.session.snapshot.base).toBe('IDLE_UNHOMED');
    const reply = await host.handle({ v: 3, kind: 'motion', command: { op: 'jog', axes: { x: 1 }, distanceMm: 0.1, feed: 600 } });
    expect(reply).toMatchObject({ ok: true, kind: 'motion' });
    await settle();
    // The jog's units line goes first, on its own answered line (independent review 2026-11-03, R2); the piece follows its answer.
    expect(t.writes).toContain('G21\n');
    const posted: SnapshotMessage[] = [];
    await host.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => posted.push(m) });
    expect(posted.at(-1)?.motion).toBe(true);
  });

  it('every command maps to its session intent; the production origin refuses them all and writes nothing', async () => {
    const commands = [
      { op: 'jogRenew' },
      { op: 'jogRelease' },
      { op: 'spindleOn', direction: 'cw', rpm: 1000 },
      { op: 'coolantOn', which: 'mist' },
      { op: 'spindleOff' },
      { op: 'coolantOff' },
      { op: 'goToZero', axes: ['z'], safeZ: 0 },
      { op: 'resume' },
      { op: 'clearAlarm' },
      { op: 'positionVerify' },
    ] as const;
    const t = new BoardTransport(undefined, EN_MOTION);
    const host = phase2Host(t, BENCH_ORIGIN);
    await classifyWith(t, host);
    const outcomes = [];
    for (const command of commands) outcomes.push((await host.handle({ v: 3, kind: 'motion', command })).ok);
    // Allowed now: release (nothing to release), spindle and coolant on and off, go to zero. Refused: no hold jog to
    // renew, no hold to resume, no alarm to clear, no UNKNOWN to verify.
    expect(outcomes).toEqual([false, true, true, true, true, true, true, false, false, false]);
    // The changes (amendment 2026-11-02) each run to their read-back before anything else moves: one host each.
    const changes = [
      { op: 'setZero', axes: ['x'] },
      { op: 'tempOffset', axes: ['x'] },
      { op: 'clearTempOffset' },
      { op: 'selectCoord', system: 2 },
      { op: 'setPosition', axes: ['x', 'y', 'z'] },
    ] as const;
    const lines = ['G10 L20 P1 X0\n', 'G92 X0\n', 'G92.1\n', 'G55\n', 'G28.3 X0 Y0 Z0\n'];
    for (const [i, command] of changes.entries()) {
      const ct = new BoardTransport(undefined, EN_MOTION);
      const ch = phase2Host(ct, BENCH_ORIGIN);
      await classifyWith(ct, ch);
      const r = await ch.handle({ v: 3, kind: 'motion', command });
      expect(r.ok, `${command.op} ${JSON.stringify(r)}`).toBe(true);
      await settle();
      expect(ct.writes, command.op).toContain(lines[i]);
    }
    // Homing needs its axis settings read: without them it is refused with the reason.
    expect(await host.handle({ v: 3, kind: 'motion', command: { op: 'home', axes: ['x'] } })).toMatchObject({ ok: false, code: 'denied' });

    const p = new BoardTransport();
    const prod = phase2Host(p, PRODUCTION_ORIGIN);
    await classifyWith(p, prod);
    const before = p.writes.filter((w) => !w.startsWith('{')).length;
    for (const command of [{ op: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 }, { op: 'home', axes: ['x'] }, { op: 'setZero', axes: ['x'] }, { op: 'tempOffset', axes: ['x'] }, { op: 'clearTempOffset' }, { op: 'selectCoord', system: 2 }, { op: 'setPosition', axes: ['x'] }, ...commands.filter((c) => c.op !== 'jogRelease' && c.op !== 'spindleOff' && c.op !== 'coolantOff')]) {
      const reply = await prod.handle({ v: 3, kind: 'motion', command });
      expect(reply.ok, command.op).toBe(false);
    }
    await settle();
    expect(p.writes.filter((w) => !w.startsWith('{')).length).toBe(before);
  });

  it('parses motion commands strictly', () => {
    const ok = [
      { op: 'jog', axes: { x: 1, y: -1 }, distanceMm: null, feed: 600 },
      { op: 'goToZero', axes: ['x', 'y', 'z'], safeZ: -1 },
      { op: 'setZero', axes: ['a'] },
      { op: 'spindleOn', direction: 'ccw', rpm: 5000 },
      { op: 'coolantOn', which: 'flood' },
      { op: 'resume' },
      { op: 'home', axes: ['z', 'x'] },
      { op: 'setPosition', axes: ['x'] },
      { op: 'tempOffset', axes: ['y'] },
      { op: 'clearTempOffset' },
      { op: 'selectCoord', system: 6 },
    ];
    for (const command of ok) expect(parseRequest({ v: 3, kind: 'motion', command }), JSON.stringify(command)).not.toBeNull();
    const bad: unknown[] = [
      null,
      [],
      { op: 'jog', axes: { x: 1 }, distanceMm: 1 },
      { op: 'jog', axes: { x: 2 }, distanceMm: 1, feed: 1 },
      { op: 'jog', axes: { w: 1 }, distanceMm: 1, feed: 1 },
      { op: 'jog', axes: {}, distanceMm: 1, feed: 1 },
      { op: 'jog', axes: [], distanceMm: 1, feed: 1 },
      { op: 'jog', axes: { x: 1 }, distanceMm: Number.NaN, feed: 1 },
      { op: 'jog', axes: { x: 1 }, distanceMm: 1, feed: Number.POSITIVE_INFINITY },
      { op: 'goToZero', axes: ['x', 'x'], safeZ: 0 },
      { op: 'goToZero', axes: [], safeZ: 0 },
      { op: 'goToZero', axes: 'x', safeZ: 0 },
      { op: 'goToZero', axes: ['q'], safeZ: 0 },
      { op: 'goToZero', axes: ['x'] },
      { op: 'setZero', axes: ['x'], extra: 1 },
      { op: 'spindleOn', direction: 'up', rpm: 1 },
      { op: 'spindleOn', direction: 'cw', rpm: '1' },
      { op: 'coolantOn', which: 'air' },
      { op: 'resume', now: true },
      { op: 'home', axes: [] },
      { op: 'home', axes: ['x'], extra: 1 },
      { op: 'clearTempOffset', axes: ['x'] },
      { op: 'selectCoord', system: 0 },
      { op: 'selectCoord', system: 7 },
      { op: 'selectCoord', system: 1.5 },
      { op: 'selectCoord' },
      { op: 'raw', line: 'G0 X0' },
      Object.create({ op: 'resume' }) as unknown,
    ];
    for (const command of bad) expect(parseRequest({ v: 3, kind: 'motion', command }), JSON.stringify(command)).toBeNull();
    expect(parseRequest({ v: 3, kind: 'motion', command: { op: 'resume' }, extra: 1 })).toBeNull();
  });
});

describe('Phase 3: job commands through the worker (SAFETY §4.4a, T-S117)', () => {
  const EN_MOTION = { ...EN, home: '{"r":{"home":0},"f":[3,0,10]}', unit: '{"r":{"unit":1},"f":[3,0,10]}' };
  const host3 = (t: BoardTransport, origin: string): MachineWorkerHost =>
    new MachineWorkerHost(
      source('fake', () => t),
      new TestClock(),
      undefined,
      { file: COMMITTED_MANIFEST, origin, verify: (f, o) => approvedBuildsFor(f, { origin: o, now: VALID_NOW }) },
      releaseFor(origin),
    );

  it('the jobs switch is on with the motion release on loopback and staging only; production never gets it', () => {
    for (const o of [BENCH_ORIGIN, STAGING_ORIGIN]) expect(releaseFor(o).jobs, o).toBe(true);
    for (const o of [PRODUCTION_ORIGIN, 'https://run-abc.workers.dev', '']) expect(releaseFor(o).jobs, o).toBeUndefined();
  });

  it('job commands reach the session: production refuses them and writes nothing; the snapshot carries the switch', async () => {
    const p = new BoardTransport();
    const prod = host3(p, PRODUCTION_ORIGIN);
    await classifyWith(p, prod);
    const before = p.writes.length;
    for (const command of [
      { op: 'load', name: 'a.nc', text: 'G0 X1\nM30', c22: false },
      { op: 'start', breakpoints: [], confirm: { unhomed: true, workZero: true, spindle: true } },
      { op: 'resume', skip: false, spindleRestart: false },
      { op: 'breakpoints', lines: [3] },
      { op: 'unload' },
    ] as const) {
      const reply = await prod.handle({ v: 3, kind: 'job', command });
      expect(reply, command.op).toMatchObject({ ok: false, code: 'denied' });
    }
    expect(await prod.handle({ v: 3, kind: 'job', command: { op: 'lineModeMemory', epoch: prod.session.snapshot.epoch, remembered: 0 } })).toEqual({ v: 3, ok: true, kind: 'job' });
    await settle();
    expect(p.writes.length).toBe(before);
    const posted: SnapshotMessage[] = [];
    await prod.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => posted.push(m) });
    expect(posted.at(-1)).toMatchObject({ jobs: false, jobElapsedMs: null });
    const t = new BoardTransport(undefined, EN_MOTION);
    const bench = host3(t, BENCH_ORIGIN);
    await classifyWith(t, bench);
    const benchPosted: SnapshotMessage[] = [];
    await bench.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => benchPosted.push(m) });
    expect(benchPosted.at(-1)?.jobs).toBe(true);
    // Start with nothing loaded is refused by the session, with its reason.
    expect(await bench.handle({ v: 3, kind: 'job', command: { op: 'start', breakpoints: [], confirm: { unhomed: true, workZero: true, spindle: true } } })).toMatchObject({ ok: false, code: 'denied', message: 'No job is loaded and checked.' });
  });

  it('parses job commands strictly', () => {
    const good = [
      { op: 'load', name: 'a.nc', text: 'G0', c22: true },
      { op: 'unload' },
      { op: 'start', breakpoints: [1, 2], confirm: { unhomed: false, workZero: true, spindle: false } },
      { op: 'resume', skip: true, spindleRestart: false },
      { op: 'breakpoints', lines: [] },
      { op: 'lineModeMemory', epoch: 3, remembered: null },
      { op: 'lineModeMemory', epoch: 3, remembered: 1 },
    ];
    for (const command of good) expect(parseRequest({ v: 3, kind: 'job', command }), JSON.stringify(command)).not.toBeNull();
    const bad: unknown[] = [
      { op: 'load', name: '', text: 'G0', c22: false },
      { op: 'load', name: 'a', text: '', c22: false },
      { op: 'load', name: 'a', text: 'G0', c22: 'no' },
      { op: 'load', name: 'a'.repeat(201), text: 'G0', c22: false },
      { op: 'load', name: 'a', text: 'G0' },
      { op: 'unload', now: true },
      { op: 'start', breakpoints: [0], confirm: { unhomed: false, workZero: true, spindle: false } },
      { op: 'start', breakpoints: [1.5], confirm: { unhomed: false, workZero: true, spindle: false } },
      { op: 'start', breakpoints: 'x', confirm: { unhomed: false, workZero: true, spindle: false } },
      { op: 'start', breakpoints: [], confirm: { unhomed: 'yes', workZero: true, spindle: false } },
      { op: 'start', breakpoints: [], confirm: { unhomed: false, workZero: true } },
      { op: 'start', breakpoints: [] },
      { op: 'resume', skip: 1, spindleRestart: false },
      { op: 'resume' },
      { op: 'breakpoints', lines: new Array(1001).fill(1) },
      { op: 'lineModeMemory', epoch: -1, remembered: 0 },
      { op: 'lineModeMemory', epoch: 1, remembered: 2 },
      { op: 'lineModeMemory', epoch: 1.5, remembered: 0 },
      { op: 'stream', line: 'G0 X0' },
      'load',
    ];
    for (const command of bad) expect(parseRequest({ v: 3, kind: 'job', command }), JSON.stringify(command)).toBeNull();
    expect(parseRequest({ v: 3, kind: 'job', command: { op: 'unload' }, extra: 1 })).toBeNull();
  });
});
