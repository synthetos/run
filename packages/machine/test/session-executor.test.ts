/**
 * `MachineSession`, the executor around the reducer (ROADMAP P1-02): the
 * transport lifecycle, T-S5 (XOFF part: `!` is written at once while lines
 * wait), write failures, the link dropping, and the final write gate.
 */
import { describe, expect, it } from 'vitest';
import { PHASE_1_RELEASE, CURRENT_RELEASE } from '@synthetos/safety';
import { BYTE } from '@synthetos/protocol';
import { MachineSession, checkWrite, escape, initialState, type PortSelector, type SessionClock, type Transport, type TransportInfo, type TransportOpenOptions, type TransportSource } from '../src/index.ts';
import { Driver, EN_ANSWERS, EN_READY_BANNER, TG_ANSWERS } from './sessionDriver.ts';
import { PORT } from './simTransport.ts';

/** A clock whose timers the test fires by hand. */
class ManualClock implements SessionClock {
  t = 0;
  readonly timers = new Map<number, { at: number; cb: () => void }>();
  #next = 1;
  now(): number {
    return this.t;
  }
  setTimeout(cb: () => void, ms: number): number {
    const id = this.#next++;
    this.timers.set(id, { at: this.t + ms, cb });
    return id;
  }
  clearTimeout(id: number): void {
    this.timers.delete(id);
  }
  /** Moves time forward, firing due timers in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].cb();
    }
    this.t = end;
  }
}

const decoder = new TextDecoder();

/** A transport the test drives: reads are pushed, writes are answered by a script. */
class ScriptTransport implements Transport {
  readonly writes: string[] = [];
  readonly opened: TransportOpenOptions[] = [];
  closed = 0;
  /** Answers a GET line (without LF) with a reply line, or nothing. */
  responder: ((line: string) => string | undefined) | undefined;
  failWrites: Error | undefined;
  failOpen: Error | undefined;
  /** When set, open() waits for it. */
  openGate: Promise<void> | undefined;
  dropDuringOpen = false;
  #queue: (Uint8Array | Error | null)[] = [];
  #wake: (() => void) | undefined;
  readonly #listeners: (() => void)[] = [];
  readonly #info: TransportInfo;

  constructor(info: TransportInfo = { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 }, responder: ((line: string) => string | undefined) | undefined = enResponder) {
    this.#info = info;
    this.responder = responder;
  }

  info(): TransportInfo {
    return this.#info;
  }
  async open(options: TransportOpenOptions): Promise<void> {
    if (this.openGate !== undefined) await this.openGate;
    if (this.failOpen !== undefined) throw this.failOpen;
    this.opened.push(options);
    if (this.dropDuringOpen) this.drop();
  }
  async writeLine(line: Uint8Array): Promise<void> {
    if (this.failWrites !== undefined) throw this.failWrites;
    const text = decoder.decode(line);
    this.writes.push(text);
    const reply = text.endsWith('\n') ? this.responder?.(text.slice(0, -1)) : undefined;
    if (reply !== undefined) queueMicrotask(() => this.push(`${reply}\n`));
  }
  get readable(): AsyncIterable<Uint8Array> {
    const next = async (): Promise<IteratorResult<Uint8Array>> => {
      for (;;) {
        const item = this.#queue.shift();
        if (item === null) return { done: true, value: undefined };
        if (item instanceof Error) throw item;
        if (item !== undefined) return { done: false, value: item };
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
      }
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
  push(data: string | Uint8Array): void {
    this.#queue.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    this.#wake?.();
  }
  /** The stream ends (null) or fails. */
  end(error?: Error): void {
    this.#queue.push(error ?? null);
    this.#wake?.();
  }
  async close(): Promise<void> {
    this.closed += 1;
    this.end();
  }
  onDisconnect(callback: () => void): void {
    this.#listeners.push(callback);
  }
  drop(): void {
    for (const l of this.#listeners) l();
    this.end(new Error('NetworkError'));
  }
}

function enResponder(line: string): string | undefined {
  const m = /^\{"([^"]+)":null\}$/.exec(line);
  return m === null ? undefined : EN_ANSWERS[m[1] as string];
}

function source(make: () => Transport | null | Promise<Transport | null>, kind: TransportSource['kind'] = 'fake'): TransportSource & { selectors: PortSelector[] } {
  const s = {
    kind,
    selectors: [] as PortSelector[],
    request: async (port: PortSelector) => {
      s.selectors.push(port);
      return make();
    },
  };
  return s;
}

/** Lets every pending promise chain run (each macrotask turn drains the microtask queue). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
};

function setup(transports: ScriptTransport[] = [new ScriptTransport()], options: Partial<ConstructorParameters<typeof MachineSession>[0]> = {}) {
  const clock = new ManualClock();
  let i = 0;
  const src = source(() => transports[i++] ?? null);
  const session = new MachineSession({ source: src, clock, ...options });
  return { clock, session, src, t: transports[0] as ScriptTransport };
}

describe('MachineSession: connecting', () => {
  it('connects, probes from {"sr":null}, reads, and resolves connect() with the port identity', async () => {
    const { session, t, src } = setup();
    const seen: string[] = [];
    session.subscribe((s) => seen.push(s.base));
    const outcome = session.connect(PORT);
    await settle();
    expect(await outcome).toEqual({ ok: true, info: { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 } });
    expect(src.selectors).toEqual([PORT]);
    expect(t.opened).toEqual([{ baudRate: 115200, flowControl: 'none', bufferSize: 256 }]);
    expect(t.writes[0]).toBe('{"sr":null}\n');
    expect(session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    expect(t.writes).toHaveLength(17);
    expect([...new Set(seen)]).toEqual(['PORT_REQUEST', 'OPENING', 'IDENTIFYING', 'READING', 'CONNECTED_UNKNOWN']);
    expect(session.state.classification?.dialectId).toBe('tinyg-en');
    const log = session.log();
    expect(log[0]).toMatchObject({ dir: 'tx', text: '{"sr":null}\\n' });
    expect(log.some((e) => e.dir === 'rx' && e.text.includes('"fb":450.01'))).toBe(true);
  });

  it('connect() is denied when already connected, and the decision says why', async () => {
    const { session } = setup();
    void session.connect(PORT);
    await settle();
    expect(await session.connect(PORT)).toMatchObject({ ok: false, code: 'denied', decision: { allowed: false, reason: 'Already connected.' } });
  });

  it('no granted port: unavailable (and "this build cannot connect" for a source of kind none)', async () => {
    const none = new MachineSession({ source: source(() => null, 'none'), clock: new ManualClock() });
    expect(await none.connect(PORT)).toEqual({ ok: false, code: 'unavailable', reason: 'this build cannot connect to a controller' });
    const fake = new MachineSession({ source: source(() => null), clock: new ManualClock() });
    expect(await fake.connect(PORT)).toEqual({ ok: false, code: 'unavailable', reason: 'no port was chosen' });
    expect(fake.snapshot.base).toBe('NOT_CONNECTED');
    const broken = new MachineSession({
      source: source(() => {
        throw new Error('boom');
      }),
      clock: new ManualClock(),
    });
    expect(await broken.connect(PORT)).toEqual({ ok: false, code: 'unavailable', reason: 'the transport source failed: boom' });
    const odd = new MachineSession({
      source: source(() => {
        throw 'text';
      }),
      clock: new ManualClock(),
    });
    expect(await odd.connect(PORT)).toMatchObject({ reason: 'the transport source failed: text' });
  });

  it('a port the guard refuses (the Due programming port) or that fails to open: open-failed, nothing written', async () => {
    const due = new ScriptTransport({ kind: 'serial', usbVendorId: 0x2341, usbProductId: 0x003d });
    const a = setup([due]);
    const outcome = await a.session.connect(PORT);
    expect(outcome).toMatchObject({ ok: false, code: 'open-failed' });
    expect(due.opened).toEqual([]);
    expect(a.session.log().some((e) => e.dir === 'note' && e.text.startsWith('open refused'))).toBe(true);
    const failing = new ScriptTransport();
    failing.failOpen = new Error('port busy');
    const b = setup([failing]);
    expect(await b.session.connect(PORT)).toEqual({ ok: false, code: 'open-failed', reason: 'the port was not opened: port busy' });
  });

  it('the link dropping while the port opens: open-failed, and the port is closed', async () => {
    const t = new ScriptTransport();
    t.dropDuringOpen = true;
    const { session } = setup([t]);
    const outcome = session.connect(PORT);
    await settle();
    expect(await outcome).toEqual({ ok: false, code: 'open-failed', reason: 'the link dropped while the port was opening' });
    await settle();
    expect(t.closed).toBe(1);
    expect(t.writes).toEqual([]);
  });

  it('disconnecting while the port is being found abandons it (the transport is never opened)', async () => {
    let release: (t: Transport) => void = () => undefined;
    const t = new ScriptTransport();
    const session = new MachineSession({ source: source(() => new Promise<Transport>((r) => (release = r))), clock: new ManualClock() });
    const outcome = session.connect(PORT);
    await settle();
    expect(session.snapshot.base).toBe('PORT_REQUEST');
    expect(await session.disconnect()).toEqual({ allowed: true });
    release(t);
    expect(await outcome).toEqual({ ok: false, code: 'open-failed', reason: 'the connection attempt was abandoned' });
    await settle();
    expect(t.opened).toEqual([]);
  });

  it('disconnecting while the port opens closes it as soon as it has opened', async () => {
    const t = new ScriptTransport();
    let open: () => void = () => undefined;
    t.openGate = new Promise((r) => (open = r));
    const { session } = setup([t]);
    void session.connect(PORT);
    await settle();
    expect(session.snapshot.base).toBe('OPENING');
    void session.disconnect();
    open();
    await settle();
    expect(t.closed).toBe(1);
    expect(t.writes).toEqual([]);
    expect(session.snapshot.base).toBe('NOT_CONNECTED');
  });

  it('a new connect waits for the previous port to close: two ports are never held', async () => {
    const first = new ScriptTransport();
    const second = new ScriptTransport();
    let finish: () => void = () => undefined;
    first.close = async () => {
      first.closed += 1;
      await new Promise<void>((r) => (finish = r));
      first.end();
    };
    const { session, src } = setup([first, second]);
    void session.connect(PORT);
    await settle();
    const closing = session.disconnect();
    void session.connect(PORT);
    await settle();
    expect(src.selectors).toHaveLength(1);
    finish();
    await closing;
    await settle();
    expect(src.selectors).toHaveLength(2);
    expect(second.writes[0]).toBe('{"sr":null}\n');
  });

  it('a port whose close fails is still released by the session (the error never escapes)', async () => {
    const t = new ScriptTransport();
    t.close = async () => {
      t.closed += 1;
      t.end();
      throw new Error('close failed');
    };
    const { session } = setup([t]);
    void session.connect(PORT);
    await settle();
    expect(await session.disconnect()).toEqual({ allowed: true });
    expect(t.closed).toBe(1);
    expect(session.snapshot.base).toBe('NOT_CONNECTED');
  });

  it('disconnecting while the port opens, with a close that fails: still closed, no error escapes', async () => {
    const t = new ScriptTransport();
    let open: () => void = () => undefined;
    t.openGate = new Promise((r) => (open = r));
    t.close = async () => {
      t.closed += 1;
      throw new Error('close failed');
    };
    const { session } = setup([t]);
    void session.connect(PORT);
    await settle();
    void session.disconnect();
    open();
    await settle();
    expect(t.closed).toBe(1);
  });

  it('disconnecting a connect that is still waiting for the previous port to close abandons it', async () => {
    const first = new ScriptTransport();
    const second = new ScriptTransport();
    let finish: () => void = () => undefined;
    first.close = async () => {
      first.closed += 1;
      await new Promise<void>((r) => (finish = r));
      first.end();
    };
    const { session, src } = setup([first, second]);
    void session.connect(PORT);
    await settle();
    void session.disconnect();
    const pending = session.connect(PORT);
    await settle();
    const secondDisconnect = session.disconnect();
    finish();
    expect(await secondDisconnect).toEqual({ allowed: true });
    expect(await pending).toMatchObject({ ok: false, reason: 'the connection attempt was abandoned' });
    await settle();
    expect(src.selectors).toHaveLength(1);
    expect(second.opened).toEqual([]);
  });

  it('disconnect when denied resolves at once with the decision', async () => {
    const { session } = setup();
    expect(await session.disconnect()).toMatchObject({ allowed: false });
  });
});

describe('T-S5 (XOFF part): realtime bytes bypass the XOFF gate', () => {
  it('while the board has sent XOFF, a read waits and ! is written at once; the read goes after XON', async () => {
    const { session, t } = setup();
    void session.connect(PORT);
    await settle();
    t.push(Uint8Array.of(0x13));
    await settle();
    expect(session.snapshot.xoff).toBe(true);
    expect(session.read(['posx'])).toEqual({ allowed: true });
    await settle();
    expect(t.writes.at(-1)).toBe('{"ex":null}\n');
    expect(session.feedhold()).toEqual({ allowed: true });
    await settle();
    expect(t.writes.at(-1)).toBe('!');
    t.push(Uint8Array.of(0x11));
    await settle();
    expect(t.writes.slice(-2)).toEqual(['!', '{"posx":null}\n']);
    expect(session.snapshot.values['posx']).toMatchObject({ value: 1.5 });
  });

  it('a line waiting under XOFF that the matrix no longer allows when XON comes is dropped, not written', async () => {
    const t = new ScriptTransport();
    t.responder = (line) => (line === '{"fb":null}' ? undefined : enResponder(line));
    const { session } = setup([t]);
    void session.connect(PORT);
    await settle();
    // fb is in flight; XOFF arrives, then fb's answer, so fv is asked for and waits.
    t.push(Uint8Array.of(0x13));
    t.push(`${EN_ANSWERS.fb}\n`);
    await settle();
    expect(session.state.writing?.token).toBe('fv');
    // A report showing motion: ORPHANED_MOTION while unclassified, so no read is allowed any more.
    t.push('{"sr":{"vel":50}}\n');
    await settle();
    t.push(Uint8Array.of(0x11));
    await settle();
    expect(t.writes).toEqual(['{"sr":null}\n', '{"fb":null}\n']);
    expect(session.state.writing).toBeNull();
    expect(session.log().some((e) => e.dir === 'note' && e.text.startsWith('not written'))).toBe(true);
  });
  it('a board that resets while it has sent XOFF comes back without XOFF: the waiting line goes and the probe restarts', async () => {
    // The firmware starts every boot in XON and never sends XON for it (@cite EN xio/xio_usart.c:128-130).
    const t = new ScriptTransport();
    t.responder = (line) => (line === '{"fb":null}' ? undefined : enResponder(line));
    const { session, clock } = setup([t]);
    void session.connect(PORT);
    await settle();
    t.push(Uint8Array.of(0x13));
    t.push(`${EN_ANSWERS.fb}\n`);
    await settle();
    expect(session.state.writing?.token).toBe('fv');
    expect(t.writes).toEqual(['{"sr":null}\n', '{"fb":null}\n']);
    // The board resets: its READY banner, and no XON.
    t.responder = enResponder;
    t.push(`${EN_READY_BANNER}\n`);
    await settle();
    expect(session.snapshot.xoff).toBe(false);
    clock.advance(1000);
    await settle();
    // The line that waited is dropped, never written to the rebooted board: the probe starts again from {"sr":null}.
    expect(t.writes.slice(0, 3)).toEqual(['{"sr":null}\n', '{"fb":null}\n', '{"sr":null}\n']);
    expect(session.log().some((e) => e.dir === 'note' && e.text.startsWith('not written: the board reset'))).toBe(true);
    expect(session.state.probe?.next).toBeGreaterThan(0);
  });
});

describe('MachineSession: failures', () => {
  it('a write failure latches FAULT; the guard then refuses every line, but ! still goes', async () => {
    const t = new ScriptTransport();
    const { session } = setup([t]);
    void session.connect(PORT);
    await settle();
    t.failWrites = new Error('USB stalled');
    session.read(['posx']);
    await settle();
    expect(session.snapshot.fault).toMatchObject({ cause: 'writeFailed' });
    t.failWrites = undefined;
    expect(session.feedhold()).toEqual({ allowed: true });
    await settle();
    expect(t.writes.at(-1)).toBe('!');
    session.read(['mpox']);
    await settle();
    expect(t.writes.at(-1)).toBe('!');
    expect(session.snapshot.fault?.cause).toBe('writeFailed');
  });

  it('a failing realtime write is a FAULT too', async () => {
    const t = new ScriptTransport();
    const { session } = setup([t]);
    void session.connect(PORT);
    await settle();
    t.failWrites = new Error('gone');
    session.feedhold();
    await settle();
    expect(session.snapshot.fault).toMatchObject({ cause: 'writeFailed' });
  });

  it('the link dropping is LOST: the port is closed; acknowledging it and reconnecting starts UNKNOWN from {"sr":null}', async () => {
    const first = new ScriptTransport();
    const second = new ScriptTransport();
    const { session } = setup([first, second]);
    void session.connect(PORT);
    await settle();
    first.drop();
    await settle();
    expect(session.snapshot.overlays[0]).toBe('LOST');
    expect(first.closed).toBe(1);
    expect(session.feedhold().allowed).toBe(false);
    expect(session.acknowledgeLost()).toEqual({ allowed: true });
    expect(session.snapshot.base).toBe('NOT_CONNECTED');
    void session.connect(PORT);
    await settle();
    expect(second.writes[0]).toBe('{"sr":null}\n');
    expect(session.snapshot.overlays).toEqual(['UNKNOWN', 'READ_ONLY']);
  });

  it('the stream ending without a close is LOST as well', async () => {
    const t = new ScriptTransport();
    const { session } = setup([t]);
    void session.connect(PORT);
    await settle();
    t.end();
    await settle();
    expect(session.snapshot.overlays[0]).toBe('LOST');
  });

  it('timers come from the clock: 3 s of silence after {"sr":null} is ORPHANED_MOTION', async () => {
    const t = new ScriptTransport(undefined, () => undefined);
    const { session, clock } = setup([t]);
    void session.connect(PORT);
    await settle();
    clock.advance(2999);
    expect(session.snapshot.overlays).toEqual([]);
    clock.advance(1);
    expect(session.snapshot.overlays).toEqual(['ORPHANED_MOTION']);
    expect(clock.timers.size).toBe(0);
  });

  it('a timer re-armed before it fires replaces the old one; a cancelled timer never fires', async () => {
    const t = new ScriptTransport(undefined, () => undefined);
    const { session, clock } = setup([t]);
    void session.connect(PORT);
    await settle();
    t.push('{"sr":{"fv":0.970,"fb":450.01,"hp":1,"hv":8,"id":"EN-1","msg":"Initializing"}}\n');
    await settle();
    t.push('{"sr":{"fv":0.970,"fb":450.01,"hp":1,"hv":8,"id":"EN-1","msg":"SYSTEM READY"}}\n');
    await settle();
    expect(clock.timers.size).toBe(1);
    void session.disconnect();
    expect(clock.timers.size).toBe(0);
  });

  it('a listener that throws never breaks the session; unsubscribe stops the calls', async () => {
    const { session } = setup();
    let calls = 0;
    const off = session.subscribe(() => {
      calls++;
      throw new Error('ui bug');
    });
    void session.connect(PORT);
    await settle();
    expect(session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    const before = calls;
    off();
    session.feedhold();
    expect(calls).toBe(before);
  });

  it('every request goes through the same path: other intents are decided and denied', async () => {
    const { session } = setup();
    expect(session.request({ intent: 'jog' })).toMatchObject({ allowed: false });
    expect(session.stopJob()).toMatchObject({ allowed: false });
    expect(session.spindleOffNow()).toMatchObject({ allowed: false });
    expect(session.ackFault()).toMatchObject({ allowed: false });
    expect(session.enq()).toMatchObject({ allowed: false });
  });

  it('the log keeps the newest entries only', async () => {
    const { session } = setup([new ScriptTransport()], { logLimit: 5 });
    void session.connect(PORT);
    await settle();
    expect(session.log()).toHaveLength(5);
    expect(session.log().at(-1)?.text).toContain('"ex":1');
  });

  it('the session defaults to the Phase 1 release and NO_APPROVED_BUILDS', async () => {
    const { session } = setup();
    void session.connect(PORT);
    await settle();
    expect(session.snapshot.classification?.mode).toBe('readOnly');
    const phase0 = setup([new ScriptTransport()], { release: CURRENT_RELEASE });
    expect(await phase0.session.connect(PORT)).toMatchObject({ ok: false, code: 'denied' });
  });

  it('ENQ goes out as one byte on approved edge-next', async () => {
    const t = new ScriptTransport();
    const { session } = setup([t], {
      manifest: { environment: 'staging', builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: '' }] },
    });
    void session.connect(PORT);
    await settle();
    expect(session.enq()).toEqual({ allowed: true });
    await settle();
    expect(t.writes.at(-1)).toBe('\u0005');
    t.push('{"ack":true}\n');
    await settle();
    expect(session.snapshot.lastAckAt).toBe(0);
  });
});

describe('checkWrite: the last gate before the transport', () => {
  const connectedState = (): ReturnType<typeof initialState> => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS);
    return d.state;
  };
  const identifyingState = (): ReturnType<typeof initialState> => {
    const d = new Driver();
    d.open();
    return d.state;
  };
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

  it('allows an allowlisted GET and !, and nothing the matrix denies now', () => {
    const s = connectedState();
    expect(checkWrite(s, s, PHASE_1_RELEASE, bytes('{"posx":null}\n'), 'read')).toBeUndefined();
    expect(checkWrite(s, s, PHASE_1_RELEASE, Uint8Array.of(BYTE.FEEDHOLD), 'feedhold')).toBeUndefined();
    expect(checkWrite(initialState(), s, PHASE_1_RELEASE, Uint8Array.of(BYTE.FEEDHOLD), 'feedhold')).toMatchObject({ kind: 'denied' });
  });

  it('judges a GET by the token rule of the state that asked for it', () => {
    const probe = identifyingState();
    const s = connectedState();
    // fbs is a probe token, not on any allowlist: fine when the probe asked, refused when a classified state did.
    expect(checkWrite(s, probe, PHASE_1_RELEASE, bytes('{"fbs":null}\n'), 'read')).toBeUndefined();
    expect(checkWrite(s, s, PHASE_1_RELEASE, bytes('{"fbs":null}\n'), 'read')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(s, probe, PHASE_1_RELEASE, bytes('{"posx":null}\n'), 'read')).toMatchObject({ kind: 'refused' });
  });

  it('refuses bytes that break the Phase 1 rules, and a write issued as the wrong intent', () => {
    const s = connectedState();
    expect(checkWrite(s, s, PHASE_1_RELEASE, Uint8Array.of(BYTE.RESET), 'feedhold')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(s, s, PHASE_1_RELEASE, Uint8Array.of(BYTE.KILL), 'feedhold')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(s, s, PHASE_1_RELEASE, bytes('G0 X10\n'), 'read')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(s, s, PHASE_1_RELEASE, bytes('{"md":null}\n'), 'read')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(s, s, PHASE_1_RELEASE, Uint8Array.of(BYTE.FEEDHOLD), 'read')).toMatchObject({ kind: 'refused', reason: 'a feedhold write was issued as read' });
    expect(checkWrite(s, s, PHASE_1_RELEASE, bytes('{"posx":null}\n'), 'feedhold')).toMatchObject({ kind: 'refused', reason: 'a get write was issued as feedhold' });
    expect(checkWrite(s, s, PHASE_1_RELEASE, Uint8Array.of(BYTE.ENQ), 'enq')).toBeUndefined();
    const tg = new Driver();
    tg.open();
    tg.answer(TG_ANSWERS);
    expect(checkWrite(tg.state, tg.state, PHASE_1_RELEASE, Uint8Array.of(BYTE.ENQ), 'enq')).toMatchObject({ kind: 'denied' });
  });

  it('escape() shows control bytes, backslashes and line feeds', () => {
    expect(escape(Uint8Array.of(0x21, 0x05, 0x5c, 0x0a, 0x41))).toBe('!\\x05\\x5c\\nA');
  });
});
