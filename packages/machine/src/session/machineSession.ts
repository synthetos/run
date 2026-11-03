/**
 * `MachineSession`: the single writer (ROADMAP P1-02; RUN_PLAN §5.1 rule 1,
 * §5.4; OLD-TP §4.2; SAFETY T-S39).
 *
 * It runs in `machine.worker` and is the only code that writes to the
 * serial port. It owns the reducer's state, carries out the effects the
 * reducer returns, and turns everything that happens (bytes read, writes
 * completing, timers, the link dropping) back into reducer events.
 *
 * Writing:
 * - Lines (GETs) go out one at a time, in order, through a queue that waits
 *   while the board has sent XOFF. Realtime bytes (`!`, ENQ) never wait for
 *   XOFF or for that queue: they are handed to the transport at once
 *   (SAFETY §4.1 Feedhold row "written even under XOFF"; §4.4 step 1). The
 *   `GuardedTransport` still lets a line already being written finish first
 *   (at most one ~32-byte GET), so a `!` never lands inside a line.
 * - Every write passes two independent checks right before the transport:
 *   the allow-matrix for its intent (`read`, `feedhold`, `enq`) in the
 *   current state, and the Phase 1 byte gate (writePolicy.ts). A refusal is
 *   a FAULT, never a send.
 * - The transport is a `GuardedTransport` (no abort, nothing that ends a
 *   line after a failed write, writes serialised), opened with the session
 *   options from dialect data.
 *
 * Nothing here reads an account, a session cookie or the network
 * (DECISIONS D1; RUN_PLAN §5.4 "It has no network code").
 */
import { NO_APPROVED_BUILDS, createInboundDecoder, type ApprovedBuilds, type Inbound } from '@synthetos/protocol';
import { PHASE_1_RELEASE, type Decision, type Intent, type Release } from '@synthetos/safety';
import { GuardedTransport } from '../guardedTransport.ts';
import { EventLog } from '../eventLog.ts';
import { SESSION_OPEN_OPTIONS } from '../openPolicy.ts';
import type { PortSelector, Transport, TransportInfo, TransportSource } from '../transport.ts';
import { initialState, reduce } from './reducer.ts';
import { snapshotOf, type SessionSnapshot } from './snapshot.ts';
import { DEFAULT_TIMINGS, type RealtimeName, type SessionConfig, type SessionEffect, type SessionEvent, type SessionIntent, type SessionState, type SessionTimings, type TimerId } from './types.ts';
import { checkWrite } from './writePolicy.ts';

/** The timer functions the session needs (a real clock in the worker, a virtual one in tests). */
export interface SessionClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export interface MachineSessionOptions {
  readonly source: TransportSource;
  readonly clock: SessionClock;
  /** Default `NO_APPROVED_BUILDS`: every board is classified READ_ONLY. */
  readonly manifest?: ApprovedBuilds;
  /** Default `PHASE_1_RELEASE`. */
  readonly release?: Release;
  readonly timings?: Partial<SessionTimings>;
  /** Entries kept in the TX/RX log. Default 2000. */
  readonly logLimit?: number;
  /** Bound of the wire transcript, in payload bytes. Default `EVENT_LOG_MAX_BYTES`. */
  readonly transcriptMaxBytes?: number;
}

/** The wire transcript of the last link that opened, as JSONL (P1-08). */
export type TranscriptExport =
  | { readonly ok: true; readonly jsonl: string; readonly events: number }
  | { readonly ok: false; readonly reason: string };

/** One line of the session log: bytes written (escaped) or a line received. */
export interface LogEntry {
  readonly t: number;
  readonly dir: 'tx' | 'rx' | 'note';
  readonly text: string;
}

export type ConnectOutcome =
  | { readonly ok: true; readonly info: TransportInfo }
  | { readonly ok: false; readonly code: 'denied'; readonly decision: Extract<Decision, { readonly allowed: false }> }
  | { readonly ok: false; readonly code: 'unavailable' | 'open-failed'; readonly reason: string };

interface Link {
  readonly epoch: number;
  inner: Transport | null;
  guarded: GuardedTransport | null;
  closing: boolean;
  /** Settles when the link is fully closed. */
  closed: Promise<void> | null;
  /** The wire transcript of this link, from the moment its port opened (P1-08). */
  wire: EventLog | null;
}

interface QueuedLine {
  readonly epoch: number;
  readonly seq: number;
  readonly bytes: Uint8Array;
  /** The state in which the reducer asked for this line: its token rule (probe list or allowlist) applies. */
  readonly emitted: SessionState;
  /** A motion line (Phase 2): the matrix intent that issued it. */
  readonly motion?: Intent;
  /** A settings write line (SAFETY §4.6, amendment 2026-11-02). */
  readonly setting?: true;
  /** A report-configuration line (amendment 2026-11-02, H64). */
  readonly report?: true;
  /** Phase 3: a job line (its index), a line-mode write, or a job `rt` line (SAFETY §4.4a). */
  readonly job?: number;
  readonly lineMode?: true;
  readonly jobRuntime?: true;
}

const encoder = new TextEncoder();

export class MachineSession {
  readonly #source: TransportSource;
  readonly #clock: SessionClock;
  #config: SessionConfig;
  readonly #logLimit: number;
  #state: SessionState = initialState();
  #snapshot: SessionSnapshot = snapshotOf(this.#state);
  #link: Link | null = null;
  readonly #events: SessionEvent[] = [];
  #processing = false;
  readonly #timers = new Map<TimerId, number>();
  readonly #listeners = new Set<(snapshot: SessionSnapshot) => void>();
  readonly #log: LogEntry[] = [];
  readonly #wireOptions: { readonly maxBytes?: number };
  /** The transcript of the most recent link that opened (it stays after a disconnect, for export). */
  #wire: EventLog | null = null;
  /** The board's XOFF, as the executor saw it in the byte stream (lines wait; realtime does not). */
  #xoff = false;
  #xonWaiters: (() => void)[] = [];
  readonly #lines: QueuedLine[] = [];
  #lineWorker = false;
  #lastDecision: { readonly intent: Intent; readonly decision: Decision } | null = null;

  constructor(options: MachineSessionOptions) {
    this.#source = options.source;
    this.#clock = options.clock;
    this.#config = Object.freeze({
      release: options.release ?? PHASE_1_RELEASE,
      manifest: options.manifest ?? NO_APPROVED_BUILDS,
      timings: Object.freeze({ ...DEFAULT_TIMINGS, ...options.timings }),
    });
    this.#logLimit = options.logLimit ?? 2000;
    this.#wireOptions = options.transcriptMaxBytes === undefined ? {} : { maxBytes: options.transcriptMaxBytes };
  }

  /** The current snapshot. */
  get snapshot(): SessionSnapshot {
    return this.#snapshot;
  }

  /** The reducer state (tests and the worker's status reply). */
  get state(): SessionState {
    return this.#state;
  }

  /** Calls `listener` with every new snapshot. Returns the unsubscribe function. */
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * The wire transcript (`{t, dir, hex}` JSONL) of the most recent link that
   * opened, including one that has since disconnected. Refused when no port
   * has opened yet, or when the transcript passed its bound (a partial one
   * would not replay).
   */
  exportTranscript(): TranscriptExport {
    const wire = this.#wire;
    if (wire === null) return Object.freeze({ ok: false, reason: 'no port has been opened in this session' });
    try {
      return Object.freeze({ ok: true, jsonl: wire.toJsonl(), events: wire.events().length });
    } catch (error) {
      return Object.freeze({ ok: false, reason: describe(error) });
    }
  }

  /** A copy of the TX/RX log, oldest first. */
  log(): readonly LogEntry[] {
    return this.#log.slice();
  }

  /**
   * Connect to the port the window chose. Resolves when the port is open
   * (the probe has started) or the attempt failed.
   */
  connect(port: PortSelector, options: { readonly expectedDeviceId?: string | null; readonly unknown?: boolean } = {}): Promise<ConnectOutcome> {
    const decision = this.#intent({ intent: 'connect', port, expectedDeviceId: options.expectedDeviceId ?? null, unknown: options.unknown === true });
    if (!decision.allowed) return Promise.resolve({ ok: false, code: 'denied', decision });
    const epoch = this.#state.epoch;
    // Settles on the first snapshot that leaves PORT_REQUEST/OPENING for this epoch, or moves to another one.
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe((s) => {
        if (s.epoch === epoch && (s.base === 'PORT_REQUEST' || s.base === 'OPENING')) return;
        unsubscribe();
        const state = this.#state;
        if (state.epoch === epoch && state.portInfo !== null) {
          resolve({ ok: true, info: state.portInfo });
          return;
        }
        const failed = state.notices.connectFailed ?? { code: 'open-failed' as const, reason: 'the connection attempt was abandoned' };
        resolve({ ok: false, code: failed.code, reason: failed.reason });
      });
    });
  }

  /** Disconnect. Resolves once the port is closed (or at once when the matrix denies it). */
  async disconnect(): Promise<Decision> {
    const link = this.#link;
    const decision = this.#intent({ intent: 'disconnect' });
    // The close effect ran during the intent, so the link's close has started.
    if (decision.allowed && link !== null) await link.closed;
    return decision;
  }

  /** Pause: `!` (SAFETY §4.4). Allowed whenever the port is open. */
  feedhold(): Decision {
    return this.#intent({ intent: 'feedhold' });
  }

  /** Phase 1 / READ_ONLY: `!` plus "Use your E-stop" (SAFETY §4.4). */
  stopJob(): Decision {
    return this.#intent({ intent: 'stopJob' });
  }

  /** Phase 1 / READ_ONLY: `!` plus "Use your E-stop" (SAFETY §4.4). */
  spindleOffNow(): Decision {
    return this.#intent({ intent: 'spindleOffNow' });
  }

  ackFault(): Decision {
    return this.#intent({ intent: 'ackFault' });
  }

  acknowledgeLost(): Decision {
    return this.#intent({ intent: 'acknowledgeLost' });
  }

  /** The EN liveness probe (used by the watchdog, P1-04). */
  enq(): Decision {
    return this.#intent({ intent: 'enq' });
  }

  /** Queue GETs of allowlisted tokens; values appear in `snapshot.values`. */
  read(tokens: readonly string[]): Decision {
    return this.#intent({ intent: 'read', tokens: [...tokens] });
  }

  /**
   * The settings drift check found a difference for the link `epoch`
   * (ROADMAP P1-07; RUN_PLAN §7.2 step 6): NEEDS_REVIEW. It only adds an
   * overlay, so it can never loosen a gate; a report for an earlier link,
   * or with the link down, is ignored by the reducer.
   */
  reportDrift(epoch: number): void {
    this.#dispatch({ type: 'driftDetected', epoch });
  }

  /**
   * One settings write (SAFETY §4.6, amendment 2026-11-02): decided by the allow-matrix (the settings
   * kind, idle, approved board), screened against the schema, then the idle gate reads, the write and a
   * read-back, one line at a time. The result appears in `snapshot.settingWrite`.
   */
  writeSetting(key: string, value: number): Decision {
    return this.#intent({ intent: 'settingsWrite', key, value });
  }

  /**
   * The verified approved-builds manifest the next connect classifies against
   * (ROADMAP P1-03). The worker verifies the signed file before each connect
   * and hands the result here. Taken only while NOT_CONNECTED, so a session in
   * progress is never reclassified; returns false (and changes nothing)
   * otherwise. `note` goes to the session log.
   */
  useApprovedBuilds(manifest: ApprovedBuilds, note?: string): boolean {
    if (this.#state.base !== 'NOT_CONNECTED' || this.#state.overlays.includes('LOST')) return false;
    this.#config = Object.freeze({ ...this.#config, manifest });
    if (note !== undefined) this.#note(note);
    return true;
  }

  /**
   * Phase 3 (SAFETY §4.4a): load a job (the file text; the session sanitises it with the live board's values) or
   * unload it (null). Decided by the matrix and the session (jobs release, approved edge-next board, idle).
   */
  loadJob(job: { readonly name: string; readonly text: string; readonly c22?: boolean } | null): Decision {
    return this.#intent({ intent: 'loadJob', job: job === null ? null : { name: job.name, text: job.text, c22: job.c22 === true } });
  }

  /** Phase 3: start the loaded job, with the page's breakpoints and confirmations. */
  startJob(breakpoints: readonly number[], confirm: { readonly unhomed: boolean; readonly workZero: boolean; readonly spindle: boolean }): Decision {
    return this.#intent({ intent: 'startJob', breakpoints: [...breakpoints], confirm: { ...confirm } });
  }

  /** Phase 3: the page's breakpoints for the loaded job. */
  setBreakpoints(lines: readonly number[]): Decision {
    return this.#intent({ intent: 'jobBreakpoints', lines: [...lines] });
  }

  /**
   * Phase 3 (H77): the page's remembered line-mode value for the board on link `epoch` (0 or 1), or null when it
   * remembers none. It writes nothing by itself; a board left in line mode outside a job is put back to it.
   */
  rememberLineMode(epoch: number, remembered: number | null): void {
    this.#dispatch({ type: 'lineModeMemory', epoch, remembered });
  }

  /** Any other intent: decided by the matrix and the session (always denied in Phase 1). */
  request(request: SessionIntent): Decision {
    return this.#intent(request);
  }

  // --- Event loop -----------------------------------------------------------

  #intent(request: SessionIntent): Decision {
    this.#lastDecision = null;
    this.#dispatch({ type: 'intent', at: this.#clock.now(), request });
    const decided = this.#lastDecision as { readonly intent: Intent; readonly decision: Decision } | null;
    /* c8 ignore next -- every intent transition carries exactly one decision (session-reducer tests); fail closed regardless */
    return decided?.decision ?? { allowed: false, reason: 'The request was not decided.', remedy: 'Reload the page.', citation: 'ROADMAP P1-02 (fail closed)' };
  }

  #dispatch(event: SessionEvent): void {
    this.#events.push(event);
    if (this.#processing) return;
    this.#processing = true;
    const before = this.#state;
    try {
      for (let next = this.#events.shift(); next !== undefined; next = this.#events.shift()) {
        const { state, effects } = reduce(this.#config, this.#state, next);
        this.#state = state;
        for (const effect of effects) this.#run(effect);
      }
    } finally {
      this.#processing = false;
    }
    if (this.#state !== before) {
      this.#snapshot = snapshotOf(this.#state);
      for (const listener of [...this.#listeners]) {
        try {
          listener(this.#snapshot);
        } catch {
          // A listener's failure never reaches the machine path.
        }
      }
    }
  }

  #run(effect: SessionEffect): void {
    switch (effect.kind) {
      case 'decision':
        this.#lastDecision = { intent: effect.intent, decision: effect.decision };
        return;
      case 'log':
        this.#note(effect.text);
        return;
      case 'acquireTransport':
        void this.#acquire(effect.epoch, effect.port);
        return;
      case 'open':
        void this.#open(effect.epoch);
        return;
      case 'writeLine': {
        this.#lines.push({
          epoch: effect.epoch,
          seq: effect.seq,
          bytes: encoder.encode(`${effect.line}\n`),
          emitted: this.#state,
          ...(effect.motion === undefined ? {} : { motion: effect.motion.intent }),
          ...(effect.intent === 'settingsWrite' ? { setting: true as const } : {}),
          ...(effect.intent === 'configureReports' ? { report: true as const } : {}),
          ...(effect.intent === 'jobLine' ? { job: effect.index as number } : {}),
          ...(effect.intent === 'lineMode' ? { lineMode: true as const } : {}),
          ...(effect.intent === 'jobRuntime' ? { jobRuntime: true as const } : {}),
        });
        void this.#drainLines();
        return;
      }
      case 'writeRealtime':
        void this.#writeRealtime(effect.epoch, effect.name, effect.byte, effect.intent);
        return;
      case 'tightenLineCap': {
        const guarded = this.#currentGuarded(effect.epoch);
        try {
          guarded?.tightenLineCap(effect.maxLineBytes);
        } catch {
          // Already at least as tight.
        }
        return;
      }
      case 'close':
        this.#close(effect.epoch);
        return;
      case 'armTimer': {
        const old = this.#timers.get(effect.id);
        if (old !== undefined) this.#clock.clearTimeout(old);
        // A fired handle is always the current one: re-arming and cancelling clear the old handle first.
        const handle = this.#clock.setTimeout(() => {
          this.#timers.delete(effect.id);
          this.#dispatch({ type: 'timer', id: effect.id, seq: effect.seq, at: this.#clock.now() });
        }, effect.ms);
        this.#timers.set(effect.id, handle);
        return;
      }
      case 'cancelTimer': {
        // The reducer cancels only timers it armed and that have not fired, so the handle is present.
        this.#clock.clearTimeout(this.#timers.get(effect.id) as number);
        this.#timers.delete(effect.id);
        return;
      }
    }
  }

  // --- Link -----------------------------------------------------------------

  #currentGuarded(epoch: number): GuardedTransport | null {
    const link = this.#link;
    return link !== null && link.epoch === epoch && !link.closing ? link.guarded : null;
  }

  async #acquire(epoch: number, port: PortSelector): Promise<void> {
    // A previous link may still be closing: never hold two ports.
    const previous = this.#link;
    // A previous link has always started closing before a new connect is allowed.
    if (previous !== null) await previous.closed;
    // Disconnected while the previous port was closing: do not even ask for the port.
    if (this.#state.epoch !== epoch) return;
    const link: Link = { epoch, inner: null, guarded: null, closing: false, closed: null, wire: null };
    this.#link = link;
    let inner: Transport | null;
    try {
      inner = await this.#source.request(port);
    } catch (error) {
      this.#dispatch({ type: 'transportUnavailable', epoch, reason: `the transport source failed: ${describe(error)}` });
      return;
    }
    if (link.closing || this.#state.epoch !== epoch) return; // abandoned; the inner transport was never opened
    if (inner === null) {
      const why = this.#source.kind === 'none' ? 'this build cannot connect to a controller' : 'no port was chosen';
      this.#dispatch({ type: 'transportUnavailable', epoch, reason: why });
      return;
    }
    link.inner = inner;
    this.#dispatch({ type: 'transportAcquired', epoch });
  }

  async #open(epoch: number): Promise<void> {
    // Emitted in the same turn as transportAcquired, which #acquire dispatched with this link's inner transport set.
    const link = this.#link as Link;
    const guarded = new GuardedTransport(link.inner as Transport);
    link.guarded = guarded;
    guarded.onDisconnect(() => this.#dispatch({ type: 'linkLost', epoch, at: this.#clock.now() }));
    try {
      await guarded.open(SESSION_OPEN_OPTIONS);
    } catch (error) {
      this.#note(`open refused: ${describe(error)}`);
      this.#dispatch({ type: 'openFailed', epoch, reason: `the port was not opened: ${describe(error)}` });
      return;
    }
    // Disconnected while opening: #close already closed the guard (a guard that is opening closes once it opens).
    if (link.closing) return;
    // A disconnect during the open was recorded by the guard from construction.
    if (guarded.disconnected) {
      this.#dispatch({ type: 'openFailed', epoch, reason: 'the link dropped while the port was opening' });
      this.#close(epoch);
      return;
    }
    this.#xoff = false;
    link.wire = new EventLog(this.#clock.now(), this.#wireOptions);
    this.#wire = link.wire;
    void this.#read(link, guarded);
    this.#dispatch({ type: 'opened', epoch, info: guarded.info() });
  }

  async #read(link: Link, guarded: GuardedTransport): Promise<void> {
    const decoder = createInboundDecoder();
    try {
      for await (const chunk of guarded.readable) {
        if (link.closing) break;
        link.wire?.rx(this.#clock.now(), chunk);
        for (const event of decoder.push(chunk)) this.#inbound(link.epoch, event);
      }
    } catch {
      // A disconnect errors the stream.
    }
    // The stream ended or failed without a close in progress: the link is gone.
    if (!link.closing) this.#dispatch({ type: 'linkLost', epoch: link.epoch, at: this.#clock.now() });
  }

  #inbound(epoch: number, event: Inbound): void {
    if (event.kind === 'FlowSignal') {
      this.#xoff = event.signal === 'xoff';
      if (!this.#xoff) this.#releaseXon();
    } else {
      this.#append({ t: this.#clock.now(), dir: 'rx', text: event.line });
      // A boot banner means the board restarted, and it always starts in XON without sending one
      // (@cite EN xio/xio_usart.c:128-130; TG xio/xio_usart.c:128-130): an XOFF from before the reset no longer holds.
      if (event.kind === 'Banner' && this.#xoff) {
        this.#xoff = false;
        this.#releaseXon();
      }
    }
    this.#dispatch({ type: 'inbound', epoch, at: this.#clock.now(), event });
  }

  #close(epoch: number): void {
    const link = this.#link;
    if (link === null || link.epoch !== epoch) return;
    link.closing = true;
    this.#releaseXon();
    // Every queued line belongs to this link or an older one: none of them may be written now.
    this.#lines.length = 0;
    const guarded = link.guarded;
    link.closed = guarded === null ? Promise.resolve() : guarded.close().catch(() => undefined);
  }

  // --- Writing --------------------------------------------------------------

  async #drainLines(): Promise<void> {
    if (this.#lineWorker) return;
    this.#lineWorker = true;
    try {
      for (let item = this.#lines.shift(); item !== undefined; item = this.#lines.shift()) {
        // Lines wait while the board has sent XOFF; realtime bytes do not (they never enter this queue).
        while (this.#xoff && this.#currentGuarded(item.epoch) !== null) await new Promise<void>((resolve) => this.#xonWaiters.push(resolve));
        const guarded = this.#currentGuarded(item.epoch);
        if (guarded === null) continue;
        // The board reset while this line waited (its XOFF ended with the boot banner): the probe starts
        // again from {sr:null} (PN §2.3 step 0), so nothing from before the reset is written ahead of it.
        if (this.#state.probe !== null && this.#state.probe.settling !== 'none') {
          this.#note('not written: the board reset while this line waited; the probe starts again from {sr:null}');
          this.#dispatch({ type: 'lineDropped', epoch: item.epoch, seq: item.seq });
          continue;
        }
        const check =
          item.motion !== undefined
            ? checkWrite(this.#state, item.emitted, this.#config.release, item.bytes, 'motion', item.motion)
            : item.job !== undefined
              ? checkWrite(this.#state, item.emitted, this.#config.release, item.bytes, 'jobLine', undefined, item.job)
              : checkWrite(this.#state, item.emitted, this.#config.release, item.bytes, writeIntentOf(item));
        if (check !== undefined) {
          this.#note(check.reason);
          /* c8 ignore next -- the reducer only asks for GETs readable when it asks, so 'refused' needs a bug there; checkWrite's tests cover it */
          const event: SessionEvent =
            check.kind === 'denied'
              ? { type: 'lineDropped', epoch: item.epoch, seq: item.seq, ...(item.job === undefined ? {} : { index: item.job }) }
              : { type: 'writeRefused', epoch: item.epoch, at: this.#clock.now(), detail: check.reason };
          this.#dispatch(event);
          continue;
        }
        this.#append({ t: this.#clock.now(), dir: 'tx', text: escape(item.bytes) });
        this.#wireTx(item.bytes);
        try {
          await guarded.writeLine(item.bytes);
        } catch (error) {
          this.#dispatch({ type: 'writeFailed', epoch: item.epoch, at: this.#clock.now(), detail: describe(error) });
          continue;
        }
        this.#dispatch({ type: 'lineWritten', epoch: item.epoch, seq: item.seq });
      }
    } finally {
      this.#lineWorker = false;
    }
  }

  async #writeRealtime(epoch: number, name: RealtimeName, byte: number, issuedBy?: Intent): Promise<void> {
    const guarded = this.#currentGuarded(epoch);
    const bytes = Uint8Array.of(byte);
    const check = checkWrite(this.#state, this.#state, this.#config.release, bytes, name, issuedBy);
    /* c8 ignore start -- a realtime byte is written in the same turn the reducer allowed it on an open link, so the link cannot be closing and the matrix cannot have changed; the reducer only emits ! and an allowed ENQ. checkWrite's own tests cover every outcome. */
    if (guarded === null) return;
    if (check !== undefined) {
      this.#note(check.reason);
      if (check.kind === 'refused') this.#dispatch({ type: 'writeRefused', epoch, at: this.#clock.now(), detail: check.reason });
      return;
    }
    /* c8 ignore stop */
    this.#append({ t: this.#clock.now(), dir: 'tx', text: escape(bytes) });
    this.#wireTx(bytes);
    try {
      await guarded.writeLine(bytes);
    } catch (error) {
      this.#dispatch({ type: 'writeFailed', epoch, at: this.#clock.now(), detail: describe(error) });
    }
  }

  /**
   * Called only with a current guard for the link, which opened (so its transcript exists).
   * It must never throw: it runs just before the `!` is written, and a recording fault may not stop that.
   */
  #wireTx(bytes: Uint8Array): void {
    /* c8 ignore next -- a current guard always belongs to a link whose port opened; never throw ahead of the write regardless */
    this.#link?.wire?.tx(this.#clock.now(), bytes);
  }

  #releaseXon(): void {
    const waiters = this.#xonWaiters;
    this.#xonWaiters = [];
    for (const resolve of waiters) resolve();
  }

  #note(text: string): void {
    this.#append({ t: this.#clock.now(), dir: 'note', text });
  }

  #append(entry: LogEntry): void {
    this.#log.push(Object.freeze(entry));
    if (this.#log.length > this.#logLimit) this.#log.splice(0, this.#log.length - this.#logLimit);
  }
}

function writeIntentOf(item: QueuedLine): 'settingsWrite' | 'configureReports' | 'lineMode' | 'jobRuntime' | 'read' {
  if (item.setting === true) return 'settingsWrite';
  if (item.report === true) return 'configureReports';
  if (item.lineMode === true) return 'lineMode';
  if (item.jobRuntime === true) return 'jobRuntime';
  return 'read';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Printable ASCII as is; everything else as `\xNN`, `\n` as `\n`. */
export function escape(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b === 0x0a) out += '\\n';
    else if (b >= 0x20 && b <= 0x7e && b !== 0x5c) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return out;
}
