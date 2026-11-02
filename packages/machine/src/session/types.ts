/**
 * Types of the read-only `MachineSession` statechart (ROADMAP P1-02;
 * SAFETY §3, §4.1; OLD-TP §4.2 "the statechart is a pure reducer:
 * (state, event) → (state, effects[])").
 *
 * Phase 1 covers the connection path only: NOT_CONNECTED → PORT_REQUEST →
 * OPENING → IDENTIFYING → READING → CONNECTED_UNKNOWN, plus BLOCKED (the
 * board's id is not the expected machine's), with every overlay.
 *
 * What the reducer can ask for is closed by these types. There is no effect
 * that writes arbitrary bytes: a line is always a single-token GET, and the
 * only realtime bytes are the feedhold and ENQ. ^X (0x18), ^D (0x04), `%`,
 * `~`, G-code and settings writes cannot be expressed (T-S26, T-S24a), and
 * the session's write gate (writePolicy.ts) checks the bytes again before
 * they reach the transport.
 *
 * Everything here is controller-neutral: dialects are looked up by id and
 * every TinyG fact comes from dialect data (RUN_PLAN §5.1 rules 4 and 5).
 */
import type { ApprovedBuilds, Banner, ClassifyReason, Dialect, DialectId, FooterRev, Inbound, JsonValue, MachineClass, ProbeKey, Response } from '@synthetos/protocol';
import type { BaseState, Decision, Intent, Overlay, Release } from '@synthetos/safety';
import type { PortSelector, TransportInfo } from '../transport.ts';

/**
 * The base states the session can be in (a subset of the allow-matrix's `BASE_STATES`). The last six are
 * reached only with a motion release (Phase 2, SAFETY §4.5b): idle (homed or not), a jog or go-to-zero in
 * progress, a hold of motion this session sent, the Stop job sequence, and a controller alarm.
 */
export type SessionBase = Extract<
  BaseState,
  'NOT_CONNECTED' | 'PORT_REQUEST' | 'OPENING' | 'IDENTIFYING' | 'READING' | 'BLOCKED' | 'CONNECTED_UNKNOWN' | 'IDLE_UNHOMED' | 'IDLE_HOMED' | 'JOGGING' | 'HELD' | 'STOPPING_JOB' | 'ALARM'
>;

export const SESSION_BASES: readonly SessionBase[] = Object.freeze([
  'NOT_CONNECTED',
  'PORT_REQUEST',
  'OPENING',
  'IDENTIFYING',
  'READING',
  'BLOCKED',
  'CONNECTED_UNKNOWN',
  'IDLE_UNHOMED',
  'IDLE_HOMED',
  'JOGGING',
  'HELD',
  'STOPPING_JOB',
  'ALARM',
]);

/** Bases after the board was identified and read: the link is in use (watchdog, polling). */
export const READY_BASES: ReadonlySet<SessionBase> = new Set(['CONNECTED_UNKNOWN', 'IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING', 'HELD', 'STOPPING_JOB', 'ALARM']);

/** Timing of the read-only session. Every value is in milliseconds. */
export interface SessionTimings {
  /** No answer to the first `{sr:null}` within this → ORPHANED_MOTION, unclassified (PN §2.3 step 0). */
  readonly firstAnswerMs: number;
  /** No answer to any later probe GET within this → ORPHANED_MOTION (continued silence, PN §2.3 step 0). */
  readonly probeAnswerMs: number;
  /** No answer to a read after classification within this → STALE (SAFETY §4.2). */
  readonly readAnswerMs: number;
  /** Quiet time after a READY banner before the probe restarts (the board reset during the probe). */
  readonly bannerSettleMs: number;
  /** How long to wait for SYSTEM READY after a boot banner (PN §2.3 step 1). */
  readonly bannerWaitMs: number;
  /** Interval between the two polled reads that verify an `ackFault` (SAFETY §4.2 "two consecutive polled reads"). */
  readonly verifyIntervalMs: number;
  /**
   * Watchdog (SAFETY §4.2): received silence on an idle, classified link
   * after which the session asks for proof of life (ENQ on EN, else a
   * `stat` GET). An idle board says nothing on its own (filtered reports).
   */
  readonly livenessIdleMs: number;
  /** Watchdog: no byte within this after asking for proof of life is unexpected silence → STALE (SAFETY §4.2, T-S11). */
  readonly staleAfterMs: number;
}

export const DEFAULT_TIMINGS: SessionTimings = Object.freeze({
  firstAnswerMs: 3000,
  probeAnswerMs: 3000,
  readAnswerMs: 2000,
  bannerSettleMs: 300,
  bannerWaitMs: 3000,
  verifyIntervalMs: 250,
  livenessIdleMs: 1000,
  staleAfterMs: 2000,
});

/** Probe restarts after the board resets during the probe, before the session gives up with a FAULT. */
export const MAX_PROBE_RESTARTS = 3;

/** Reads queued at once by `read` requests (each is one line, sent one at a time). */
export const MAX_QUEUED_READS = 64;

export interface SessionConfig {
  /** The allow-matrix release the session enforces. Phase 1: `PHASE_1_RELEASE`. */
  readonly release: Release;
  /** The verified approved-builds manifest used to classify (`NO_APPROVED_BUILDS` keeps every board READ_ONLY). */
  readonly manifest: ApprovedBuilds;
  readonly timings: SessionTimings;
}

/** Why a read is in flight. */
/** `liveness`: the watchdog's proof-of-life GET where ENQ is not available (SAFETY §4.2). */
/**
 * `poll`: a polled read of the motion layer (SAFETY §4.2, §4.5b). `motion`: a motion line (Phase 2), never a GET.
 * Settings writes (SAFETY §4.6, amendment 2026-11-02): `gate` is a polled read of the idle gate right before a
 * write, `setting` is the write itself (`{"<key>":<value>}`), `readback` reads the key back.
 */
export type ReadPurpose = 'splice' | 'probe' | 'reading' | 'request' | 'verify' | 'liveness' | 'poll' | 'motion' | 'gate' | 'setting' | 'readback';

export interface PendingRead {
  readonly token: string;
  readonly purpose: ReadPurpose;
  /** `motion` only: the exact line (without LF), checked again by the motion write gate. */
  readonly line?: string;
  /** `motion` only: the allow-matrix intent the line is checked against when it is written. */
  readonly intent?: Intent;
  /** The value of a `setting` line. */
  readonly value?: number;
}

/** How a settings write ended. */
export type SettingWriteOutcome =
  /** Written, and the read-back matches at the table's precision. */
  | 'verified'
  /** Written (status 0), but the read-back differs or could not be read. */
  | 'mismatch'
  /** The board answered the write with a non-zero status: nothing was stored. */
  | 'rejected'
  /** Not written: the idle gate failed (or could not be read). */
  | 'refused'
  /** The write was sent but its answer never came or arrived damaged: the board may or may not hold the value. */
  | 'unconfirmed'
  /** The link dropped, the board reset or a FAULT latched while the write was in progress. */
  | 'interrupted';

/**
 * One settings write in progress or just finished (SAFETY §4.6, amendment 2026-11-02). At most one exists:
 * a new write is refused until this one is `done`.
 */
export interface SettingWriteState {
  /** Increases by one per accepted write on this session (the window matches results by it). */
  readonly id: number;
  readonly key: string;
  readonly value: number;
  readonly phase: 'gate' | 'writing' | 'readback' | 'done';
  /** Polled gate values, as read right before the write. */
  readonly gate: Readonly<Partial<Record<'stat' | 'hold' | 'vel' | 'qr' | 'unit', number>>>;
  /** The board's answer to the write: footer status and the value it echoed. */
  readonly answer?: { readonly status: number; readonly value: JsonValue | null };
  /** An exception report (`er`) the board sent while this write was being answered: its status (106 on EN, 9 on TG). */
  readonly exception?: number;
  /** The value read back after the write. */
  readonly readBack?: JsonValue | null;
  readonly outcome?: SettingWriteOutcome;
  /** Plain words: why it was refused, or what went wrong. */
  readonly detail?: string;
}

/** An answer the board still owes, oldest first (the board answers lines in order). */
export interface Expected extends PendingRead {
  /**
   * Its answer timed out. A late answer may still arrive and is then
   * consumed; if a later line's answer arrives first, this one is dropped
   * as lost.
   */
  readonly late: boolean;
}

export type FaultKind = 'integrity' | 'liveness';

export type FaultCause =
  /** A boot banner after the board was ready: it reset (SAFETY H19, T-S10). */
  | 'bannerAfterReady'
  /** The board kept resetting during the probe. */
  | 'resetLoop'
  | 'writeFailed'
  /** The session's own write gate refused bytes: the code path that built them is the bug. */
  | 'writeRefused'
  | 'unexpectedResponse'
  | 'footerRevisionChanged'
  | 'exceptionReport'
  /** Phase 2: a stop or release sequence timed out waiting for the hold or the flush (W12, SAFETY §4.4). */
  | 'stopNotConfirmed';

export interface FaultInfo {
  readonly cause: FaultCause;
  readonly kind: FaultKind;
  readonly detail: string;
  readonly at: number;
}

/** What the classifier said, without the dialect object (snapshots are posted across threads). */
export interface ClassificationInfo {
  readonly dialectId: DialectId | null;
  readonly mode: 'full' | 'readOnly';
  /** `flowControl`: the classifier said full, but READING found `ex` not 0/1 (RTS/CTS, PN §5.3). */
  readonly reason: ClassifyReason | 'probeFailed' | 'flowControl';
  readonly detail: string;
  readonly upgradeOffer: boolean;
  readonly buildIdentity?: 'fbs' | 'fbOnly';
}

export interface Identity {
  readonly fb?: number;
  readonly fv?: number;
  readonly hp?: number | string;
  readonly hv?: number | string;
  readonly id?: string;
  readonly fbs?: string;
}

/** Progress of the capability probe (PN §2.3). */
export interface ProbeProgress {
  /** Index into `PROBE_STEPS` of the next GET to send. */
  readonly next: number;
  readonly answers: readonly (readonly [ProbeKey, Response])[];
  readonly banner: Banner | undefined;
  /** The single `{sr:null}` repeat after an error answer has been used (PN §2.3 step 0). */
  readonly spliceRetried: boolean;
  /** A boot banner arrived: waiting for the board to settle before the probe restarts. */
  readonly settling: 'none' | 'boot' | 'ready';
  readonly restarts: number;
}

/** Live values from status reports and reads (the DRO and state band source). */
export interface LiveState {
  readonly stat?: number;
  readonly machineClass?: MachineClass;
  readonly hold?: number;
  readonly vel?: number;
  readonly qr?: number;
  /** Flow control mode, read once in READING (0 off, 1 XON/XOFF, 2 RTS/CTS). */
  readonly ex?: number;
  readonly line?: number;
  /** Commanded feed rate (`feed` in a status report), in the board's units per minute, as reported. */
  readonly feed?: number;
  /** The active tool number (`tool` in a status report), as reported; never inferred from G-code. */
  readonly tool?: number;
  /**
   * Spindle and coolant readouts (edge-next `spe`, `spc`, `spd`, `sps`, `cof`, `com`), as reported, when the
   * board's status list carries them. DISPLAY ONLY: they report the outputs as last driven, each field is
   * sampled on its own, and an M5/M9/M30 queued behind a move reads "on" until it runs. Nothing that decides
   * a write, a stop or an overlay may read them (SAFETY §4.4).
   */
  /** Spindle enabled: 1 on, 0 off. */
  readonly spe?: number;
  /** Spindle control: 0 off, 1 CW, 2 CCW. */
  readonly spc?: number;
  /** Direction last driven: 0 CW, 1 CCW (kept while off). */
  readonly spd?: number;
  /** Speed in use after the clamp: commanded, never measured (TinyG has no speed sensor). */
  readonly sps?: number;
  /** Flood coolant output: 1 on, 0 off. */
  readonly cof?: number;
  /** Mist coolant output: 1 on, 0 off. */
  readonly com?: number;
  /**
   * The keys of the full status report the board sent in answer to `{sr:null}` at connect: the fields its
   * status list carries. Undefined until that answer arrives. Read, never written (no sr-list configuration).
   */
  readonly srList?: readonly string[];
  /** Overall homing state (`home`, read at connect in a motion session): 1 homed. Shown, and decides W34. */
  readonly home?: number;
  /** Work position (`posx`..`posc`) and machine position (`mpox`..`mpoc`), as reported. */
  readonly pos: Readonly<Partial<Record<Axis, number>>>;
  readonly mpo: Readonly<Partial<Record<Axis, number>>>;
  readonly unit?: number;
  readonly lastRxAt?: number;
}

export type Axis = 'x' | 'y' | 'z' | 'a' | 'b' | 'c';

/** A value read by a request, with the footer status it came with. */
export interface ReadValue {
  readonly value: JsonValue | null;
  readonly status: number;
  readonly at: number;
}

/** Things the UI must say that are not states (SAFETY §4.4 READ_ONLY row, §3 FAULT exits). */
export interface SessionNotices {
  /** When the last `!` was written for a Pause, Stop job or Spindle off request. */
  readonly pauseRequestedAt?: number;
  /** A Stop job or Spindle off was answered with `!` only: "Use your E-stop or the controller's own stop." */
  readonly adviseEstop: boolean;
  /** Why the last `ackFault` did not complete (it stays latched). */
  readonly ackFaultRefused?: string;
  /**
   * Phase 2 (SAFETY §4.4, §4.5b): the last motion result in plain words, decided from polled state only
   * ("Paused", "Stopped: queue cleared, spindle and coolant off", "Resumed", or why a move ended).
   */
  readonly motion?: { readonly kind: 'paused' | 'stopped' | 'resumed' | 'done' | 'refused' | 'failed'; readonly text: string; readonly at: number };
  /** The last connect attempt failed before the port opened. */
  readonly connectFailed?: { readonly code: 'unavailable' | 'open-failed'; readonly reason: string };
}

export interface AckVerify {
  /** Polled round 0 or 1; both must agree (SAFETY §3 FAULT exits, §4.2). */
  readonly round: 0 | 1;
  readonly hold?: number;
  readonly qr?: number;
}

/** The reducer's whole state. Plain, frozen data. */
export interface SessionState {
  readonly base: SessionBase;
  /** Active overlays, in precedence order (allow-matrix `OVERLAYS`). */
  readonly overlays: readonly Overlay[];
  /** Connection counter: every link event carries the epoch it belongs to; stale ones are ignored. */
  readonly epoch: number;
  readonly port: PortSelector | null;
  /** The id of the machine the user selected, when any (T-S21). */
  readonly expectedDeviceId: string | null;
  /** The next connect starts with the UNKNOWN overlay (after LOST; SAFETY §3). */
  readonly unknownOnNextConnect: boolean;
  /** The board has said XOFF and not yet XON (lines wait; realtime bytes do not). */
  readonly xoff: boolean;
  /** Footer revision of the first response on this link; a change is a FAULT (SAFETY §3). */
  readonly footerRev: FooterRev | undefined;
  readonly probe: ProbeProgress | null;
  /** The board has finished booting and answered: any banner from now on is a reset (SAFETY H19). */
  readonly ready: boolean;
  readonly identity: Identity | null;
  readonly classification: ClassificationInfo | null;
  /** The classified dialect (frozen dialect data), or null: unclassified or not yet probed. Never posted. */
  readonly dialect: Dialect | null;
  /** The opened port's identity. */
  readonly portInfo: TransportInfo | null;
  /** Reads waiting to be written, in order. One line is in flight at a time. */
  readonly queue: readonly PendingRead[];
  /** Written lines whose answers are owed, oldest first. */
  readonly expected: readonly Expected[];
  /** A line handed to the transport whose write has not completed; `seq` is its number on this link. */
  readonly writing: (PendingRead & { readonly seq: number }) | null;
  /** ENQ written, `{"ack":true}` not yet seen (at most one outstanding, SAFETY §4.2). */
  readonly enqOutstanding: boolean;
  readonly lastAckAt?: number;
  /**
   * The watchdog asked for proof of life at `since` (ENQ or a `stat` GET)
   * and nothing has been received since. Silence from now on is unexpected
   * (SAFETY §4.2). Cleared by any received line.
   */
  readonly liveness: { readonly since: number; readonly via: 'enq' | 'get' } | null;
  /** When STALE was entered and how long the link had been silent then (W4 "for N s"). */
  readonly stale: { readonly at: number; readonly silentForMs: number } | null;
  readonly live: LiveState;
  readonly values: Readonly<Record<string, ReadValue>>;
  readonly fault: FaultInfo | null;
  readonly ackVerify: AckVerify | null;
  readonly blocked: { readonly expected: string; readonly reported: string | null } | null;
  readonly notices: SessionNotices;
  /** Armed timers: id → sequence number. A timer event whose number differs is stale. */
  readonly timers: Readonly<Partial<Record<TimerId, number>>>;
  readonly timerSeq: number;
  /** Lines and realtime bytes the reducer has asked for on this link (for the snapshot). */
  readonly sent: { readonly lines: number; readonly realtime: number };
  /** Phase 2: the motion in progress, or null (SAFETY §4.5b). */
  readonly motion: MotionCtx | null;
  /** The current or last settings write, or null (SAFETY §4.6, amendment 2026-11-02). */
  readonly settingWrite: SettingWriteState | null;
}

export type JogAxis = 'x' | 'y' | 'z' | 'a';

/** A jog being fed (SAFETY §4.5b, H50). */
export interface JogFeed {
  readonly axes: Readonly<Partial<Record<JogAxis, 1 | -1>>>;
  /** Distance still to feed per axis, mm; null for a hold jog (until released). */
  readonly remainingMm: number | null;
  readonly feed: number;
  /** Length of one piece, mm. */
  readonly pieceMm: number;
  /** When the page last renewed a hold jog. */
  readonly renewedAt: number;
}

export type MotionOp = 'jog' | 'goToZero';

/**
 * - `feed`: lines (jog pieces or go-to-zero steps) are still being sent;
 * - `drain`: waiting for polled idle (two consecutive reads) before the next step or the finish;
 * - `hold`: `!` written, waiting for the hold to complete (polled);
 * - `flush`: `%` written, waiting for hold 0 and an empty planner;
 * - `held`: a Pause of this session's motion is confirmed (base HELD);
 * - `finish`: the closing lines (`M5`, `M9`, `G90`) are being sent.
 */
export type MotionPhase = 'feed' | 'drain' | 'hold' | 'flush' | 'held' | 'finish';

/** Why a hold was started: the user's Pause, a release or lost keep-alive of a hold jog, or Stop job / Spindle off. */
export type HoldReason = 'pause' | 'release' | 'keepalive' | 'stopJob' | 'refused';

export interface MotionCtx {
  readonly op: MotionOp | 'stop';
  readonly phase: MotionPhase;
  readonly jog: JogFeed | null;
  /** Go-to-zero lines still to send; each waits for polled idle before the next. */
  readonly steps: readonly string[];
  readonly reason: HoldReason | null;
  /** Consecutive polled reads that met the current phase's condition. */
  readonly confirmed: number;
  /** The current hold or flush phase must complete by then (W12 and FAULT otherwise). */
  readonly deadline: number | null;
  /** `unit` when the motion started (0 inches): restored at the end. */
  readonly units: number | undefined;
  /** The base to return to when the motion ends. */
  readonly returnTo: SessionBase;
  /** The board answered a line of this motion with a non-zero status. */
  readonly refusal: string | null;
  /** Poll cycles completed in the current hold step (the first may have been asked before the `!`). */
  readonly holdPolls: number;
  /**
   * Jog pieces believed queued in the planner: `plannerBlocks - qr` at the last poll, plus every piece written
   * since. It only over-counts (the machine consumes blocks meanwhile), so feeding against it stays within the
   * lookahead.
   */
  readonly queued: number;
}

/** `watchdog`: the receive-silence watchdog (SAFETY §4.2). `motion`: the motion layer's poll and keep-alive tick. */
export type TimerId = 'answer' | 'settle' | 'verify' | 'watchdog' | 'motion';

/** Intents the session handles. Everything else is denied (not in Phase 1). */
export type SessionIntent =
  /**
   * `unknown`: the window knows the previous session ended without a clean disconnect (a reload or
   * discard while LIVE, W6), so this connect starts in the UNKNOWN overlay (SAFETY §3).
   */
  | { readonly intent: 'connect'; readonly port: PortSelector; readonly expectedDeviceId: string | null; readonly unknown?: boolean }
  | { readonly intent: 'disconnect' }
  | { readonly intent: 'feedhold' }
  | { readonly intent: 'stopJob' }
  | { readonly intent: 'spindleOffNow' }
  | { readonly intent: 'ackFault' }
  | { readonly intent: 'acknowledgeLost' }
  | { readonly intent: 'enq' }
  | { readonly intent: 'read'; readonly tokens: readonly string[] }
  // --- Phase 2 motion (SAFETY §4.5b). Denied by the matrix under any release without motion.
  /** Start a jog (`distanceMm` per axis; null = hold until released), or renew a hold jog's keep-alive. */
  | { readonly intent: 'jog'; readonly axes: Readonly<Partial<Record<JogAxis, 1 | -1>>>; readonly distanceMm: number | null; readonly feed: number }
  | { readonly intent: 'jog'; readonly renew: true }
  | { readonly intent: 'goToZero'; readonly axes: readonly JogAxis[]; readonly safeZ: number }
  | { readonly intent: 'setWorkZero'; readonly axes: readonly JogAxis[] }
  | { readonly intent: 'spindleOn'; readonly output: 'spindle'; readonly direction: 'cw' | 'ccw'; readonly rpm: number }
  | { readonly intent: 'spindleOn'; readonly output: 'mist' | 'flood' }
  | { readonly intent: 'clearAlarm' }
  | { readonly intent: 'resume' }
  | { readonly intent: 'positionVerify' }
  /** Release a hold jog (`!`, then `%` once held). Stop class: never gated. */
  | { readonly intent: 'feedhold'; readonly release: true }
  /** Spindle or coolant off alone, idle (Phase 2). Stop class. */
  | { readonly intent: 'spindleOffNow'; readonly outputs: 'spindle' | 'coolant' }
  /** One settings write (SAFETY §4.6, amendment 2026-11-02): gate reads, `{"<key>":<value>}`, then a read-back. */
  | { readonly intent: 'settingsWrite'; readonly key: string; readonly value: number }
  /** Any other allow-matrix intent: always denied (decided, never silently dropped). */
  | {
      readonly intent: Exclude<
        Intent,
        'connect' | 'disconnect' | 'feedhold' | 'stopJob' | 'spindleOffNow' | 'ackFault' | 'acknowledgeLost' | 'enq' | 'read' | 'jog' | 'goToZero' | 'setWorkZero' | 'spindleOn' | 'clearAlarm' | 'resume' | 'positionVerify' | 'settingsWrite'
      >;
    };

/** Everything that can happen to the session. */
export type SessionEvent =
  | { readonly type: 'intent'; readonly at: number; readonly request: SessionIntent }
  | { readonly type: 'transportAcquired'; readonly epoch: number }
  | { readonly type: 'transportUnavailable'; readonly epoch: number; readonly reason: string }
  | { readonly type: 'opened'; readonly epoch: number; readonly info: TransportInfo }
  | { readonly type: 'openFailed'; readonly epoch: number; readonly reason: string }
  | { readonly type: 'inbound'; readonly epoch: number; readonly at: number; readonly event: Inbound }
  /** The write of line `seq` completed. */
  | { readonly type: 'lineWritten'; readonly epoch: number; readonly seq: number }
  /** Line `seq` was not written: by the time it reached the transport the matrix no longer allowed a read. */
  | { readonly type: 'lineDropped'; readonly epoch: number; readonly seq: number }
  | { readonly type: 'writeFailed'; readonly epoch: number; readonly at: number; readonly detail: string }
  | { readonly type: 'writeRefused'; readonly epoch: number; readonly at: number; readonly detail: string }
  | { readonly type: 'linkLost'; readonly epoch: number; readonly at: number }
  | { readonly type: 'timer'; readonly id: TimerId; readonly seq: number; readonly at: number }
  /** A settings drift check found a difference to the profile (NEEDS_REVIEW; its producer arrives with the drift check). */
  | { readonly type: 'driftDetected'; readonly epoch: number };

/** The realtime bytes a session may write: `!` and ENQ, and with a motion release `%` and `~`. Never ^D or ^X. */
export type RealtimeName = 'feedhold' | 'enq' | 'flush' | 'resume';

export type SessionEffect =
  | { readonly kind: 'acquireTransport'; readonly epoch: number; readonly port: PortSelector }
  | { readonly kind: 'open'; readonly epoch: number }
  /**
   * One single-token GET, `{"<token>":null}`, a motion line (`motion`, Phase 2), or (intent `settingsWrite`) one
   * single-token settings write, `{"<token>":<number>}` (the executor appends LF); `seq` numbers it on this link.
   */
  | { readonly kind: 'writeLine'; readonly epoch: number; readonly seq: number; readonly token: string; readonly line: string; readonly motion?: { readonly intent: Intent }; readonly intent?: 'settingsWrite' }
  /** `intent`: the allow-matrix intent the byte is checked against (`%` from a stop is `stopJob`, from a release `feedhold`). */
  | { readonly kind: 'writeRealtime'; readonly epoch: number; readonly name: RealtimeName; readonly byte: number; readonly intent?: Intent }
  /** Lower the transport's line cap to the classified dialect's. */
  | { readonly kind: 'tightenLineCap'; readonly epoch: number; readonly maxLineBytes: number }
  | { readonly kind: 'close'; readonly epoch: number }
  | { readonly kind: 'armTimer'; readonly id: TimerId; readonly seq: number; readonly ms: number }
  | { readonly kind: 'cancelTimer'; readonly id: TimerId }
  /** A line for the session log (the probe result, the classification). */
  | { readonly kind: 'log'; readonly text: string }
  /** The answer to an intent. Exactly one per intent event. */
  | { readonly kind: 'decision'; readonly intent: Intent; readonly decision: Decision };

export interface Transition {
  readonly state: SessionState;
  readonly effects: readonly SessionEffect[];
}
