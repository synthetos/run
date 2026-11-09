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
import type { StartMode } from './fileModes.ts';
import type { TravelCheck } from './travelTypes.ts';
import type { ApprovedBuilds, Banner, ClassifyReason, Dialect, DialectId, FooterRev, Inbound, JsonValue, MachineClass, ProbeKey, Response } from '@synthetos/protocol';
import type { BaseState, Decision, Intent, Overlay, Release, SentLine } from '@synthetos/safety';
import type { PortSelector, TransportInfo } from '../transport.ts';
import type { ReportStep } from './reports.ts';
import type { ProbeZState } from './probe/state.ts';

/**
 * The base states the session can be in (a subset of the allow-matrix's `BASE_STATES`). The last six are
 * reached only with a motion release (Phase 2, SAFETY §4.5b): idle (homed or not), a jog or go-to-zero in
 * progress, a hold of motion this session sent, the Stop job sequence, and a controller alarm.
 */
export type SessionBase = Extract<
  BaseState,
  | 'NOT_CONNECTED'
  | 'PORT_REQUEST'
  | 'OPENING'
  | 'IDENTIFYING'
  | 'READING'
  | 'BLOCKED'
  | 'CONNECTED_UNKNOWN'
  | 'IDLE_UNHOMED'
  | 'IDLE_HOMED'
  | 'JOGGING'
  | 'HOMING'
  | 'HELD'
  | 'STOPPING_JOB'
  | 'ALARM'
  | 'PREAMBLE'
  | 'RUNNING'
  | 'PROGRAM_PAUSED'
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
  'HOMING',
  'HELD',
  'STOPPING_JOB',
  'ALARM',
  'PREAMBLE',
  'RUNNING',
  'PROGRAM_PAUSED',
]);

/** Bases after the board was identified and read: the link is in use (watchdog, reports). */
export const READY_BASES: ReadonlySet<SessionBase> = new Set(['CONNECTED_UNKNOWN', 'IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING', 'HOMING', 'HELD', 'STOPPING_JOB', 'ALARM', 'PREAMBLE', 'RUNNING', 'PROGRAM_PAUSED']);

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
   * Watchdog fallback (SAFETY §4.2 as amended 2026-11-02): only while the board's heartbeat is not on (before
   * the connect-time configuration, or firmware without `rt`). After this much received silence on an idle,
   * classified link the session asks for proof of life once (ENQ on EN, else a `stat` GET).
   */
  readonly livenessIdleMs: number;
  /** Watchdog: no byte within this after asking for proof of life is unexpected silence → STALE (SAFETY §4.2, T-S11). */
  readonly staleAfterMs: number;
  /**
   * With the heartbeat on (amendment 2026-11-02): no status report, heartbeat or answer for this long is
   * "No reports from the board" → STALE. Nothing is sent to ask; the heartbeat is the proof of life.
   */
  readonly reportSilenceMs: number;
}

export const DEFAULT_TIMINGS: SessionTimings = Object.freeze({
  firstAnswerMs: 3000,
  probeAnswerMs: 3000,
  readAnswerMs: 2000,
  bannerSettleMs: 300,
  bannerWaitMs: 3000,
  verifyIntervalMs: 250,
  livenessIdleMs: 5000,
  staleAfterMs: 2000,
  reportSilenceMs: 3000,
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
/**
 * Push-driven state (amendment 2026-11-02): `seed` is the full state read once after identification and the
 * single read-back after run changed a value (set zero, G92, G28.3, a coordinate system, homing); `report` is
 * one line of the status-report configuration (a write, or its read-back GET).
 */
/**
 * Phase 3 jobs (SAFETY §4.4a): `job` is one line of the running job (data, many may be owed at once in line
 * mode), `jobPrep` a read taken when a job is loaded (the board's limits, offsets and modes for the sanitiser),
 * `lineMode` the line-mode read, write or read-back (`rxm`, H77), `jobRuntime` a RAM-only `rt` line of the job
 * (the job flag, the feed-limit window).
 */
export type ReadPurpose =
  | 'splice'
  | 'probe'
  | 'reading'
  | 'request'
  | 'verify'
  | 'liveness'
  | 'poll'
  | 'motion'
  | 'gate'
  | 'setting'
  | 'readback'
  | 'seed'
  | 'report'
  | 'job'
  | 'jobPrep'
  | 'lineMode'
  | 'jobRuntime'
  /** The firmware update (SAFETY §4.8 as amended 2026-11-03): the idle gate before `{"boot":1}`, and that line. */
  | 'bootGate'
  | 'boot'
  /** OD-14: a setting the session needs to read the board at all (`{jv:4}` when GETs answer empty), written once at connect. */
  | 'normalize'
  /** Probe Z (SAFETY §4.5c): its settings reads, the input poll, its own lines (with `line`) and the zero's read-back. */
  | 'probeZ'
  /** `unit` and `dist` read before run changes them, so the modes put back are the board's own (modes.ts). */
  | 'modes';

/** Who a `modes` read is for: a jog, go to zero or Stop job (`motion`), the probe, or a job's tool change. */
export type ModesOwner = 'motion' | 'probe' | 'toolChange';

/** What runs when the last read-back of a change has been answered. */
export type FollowUp = 'homed' | 'positionSet';

export interface PendingRead {
  readonly token: string;
  readonly purpose: ReadPurpose;
  /** `motion` only: the exact line (without LF), checked again by the motion write gate. */
  readonly line?: string;
  /** `motion` only: the allow-matrix intent the line is checked against when it is written. */
  readonly intent?: Intent;
  /** The value of a `setting` line. */
  readonly value?: number;
  /** `seed` only: run after this read is answered (the last read-back of a homing or G28.3). */
  readonly then?: FollowUp;
  /** `job` only: the index of the job line. */
  readonly index?: number;
  /** `modes` only: where the answer is kept. */
  readonly modesFor?: ModesOwner;
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
  | 'stopNotConfirmed'
  /** Phase 3: the controller answered a job line with status 13, a damaged line (E162, H9). */
  | 'damagedLine'
  /** Phase 3: STALE for longer than the limit while a job runs (liveness, SAFETY §3, H71). */
  | 'staleWhileRunning';

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
  /** Where a full session's approval came from (absent: the signed manifest; SAFETY H87). */
  readonly approvalSource?: 'release-list' | 'trusted';
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
  /** Lines read before the first answer on this link: a previous program's unread output, discarded (H49 amendment 2026-11-03). */
  readonly backlog: number;
  /** OD-14: `{jv:4}` was written on this link because GETs answered empty (once per link), and whether it is in flight. */
  readonly normalized: boolean;
  readonly normalizing: boolean;
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
   * The keys of the full status report the board sent in answer to `{sr:null}`: the fields its status list
   * carries. Undefined until that answer arrives. Updated by the read-back after the session set the list.
   */
  readonly srList?: readonly string[];
  /** Overall homing state (`home`, read at connect and after homing): 1 homed. Shown, and decides W34. */
  readonly home?: number;
  /** Active coordinate system (`coor`): 1 = G54 .. 6 = G59, 0 = G53. */
  readonly coor?: number;
  /** Distance mode (`dist`): 0 absolute (G90), 1 incremental (G91). */
  readonly dist?: number;
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
  /**
   * How this link's machine position was last established, for the words only (first-time walk 2026-11-08, S2):
   * `homing` after a homing cycle read back with X, Y and Z homed, `hand` after a G28.3 (set machine position)
   * read back the same way. The board reports `home` 1 after either, so only the session that sent it can tell
   * them apart. Nothing decides on it: placement, the allow-matrix and the unhomed confirmation still read `home`.
   * Reset with the other notices when the link ends.
   */
  readonly position?: { readonly by: 'homing' | 'hand'; readonly at: number };
  /** Homing, set machine position and offsets (amendment 2026-11-02): the last result in plain words. */
  readonly change?: { readonly kind: 'done' | 'refused' | 'failed'; readonly text: string; readonly at: number };
  /** The last connect attempt failed before the port opened. */
  readonly connectFailed?: { readonly code: 'unavailable' | 'open-failed'; readonly reason: string };
  /**
   * The firmware update (SAFETY §4.8 as amended 2026-11-03): `{"boot":1}` went out at `at` on the port `port`, the
   * link was closed, and the board is resetting into its bootloader. The flasher takes the same port from here.
   */
  readonly bootloaderEntered?: { readonly at: number; readonly port: PortSelector; readonly boardId: string | null };
  /** Why the last request to enter the bootloader was not carried out (the idle gate, a lost link). */
  readonly bootRefused?: string;
  /**
   * TinyG 450.02+ (N61): stored settings that would not load were replaced by their defaults at start-up; `text` is
   * the board's own list of them. A notice, never a FAULT: the board runs, on settings the user should check.
   */
  readonly settingsDefaulted?: { readonly text: string; readonly at: number };
}

/** The firmware update's entry into the bootloader, while it is in progress (SAFETY §4.8 as amended). */
export interface BootEntryState {
  readonly phase: 'gate' | 'writing';
  readonly gate: { readonly stat?: number; readonly hold?: number; readonly vel?: number; readonly qr?: number };
}

export interface AckVerify {
  /** Polled round 0 or 1; both must agree (SAFETY §3 FAULT exits, §4.2). */
  readonly round: 0 | 1;
  readonly hold?: number;
  readonly qr?: number;
}

/** One change the session made to a saved reporting setting (W35, W36). */
export interface ReportChange {
  readonly setting: 'sr' | 'sv' | 'si';
  readonly from?: number;
  readonly to?: number;
}

/**
 * The connect-time read and status-report configuration (SAFETY §4.2 as amended 2026-11-02, H64):
 * - `seeding`: the full state read is in progress;
 * - `pending`: read, waiting for a state that allows configuration (idle; not in alarm);
 * - `configuring`: the steps are being sent, one at a time;
 * - `done`, `failed`; `off`: not configured on this link (a release without `reports`, a READ_ONLY or
 *   non-edge-next board, motion from elsewhere).
 */
export interface ReportsState {
  readonly phase: 'idle' | 'seeding' | 'pending' | 'configuring' | 'done' | 'failed' | 'off';
  readonly step: ReportStep | null;
  readonly remaining: readonly ReportStep[];
  /** The heartbeat interval in force on this link (ms), or null: no heartbeat, the watchdog falls back to asking. */
  readonly heartbeatMs: number | null;
  readonly changes: readonly ReportChange[];
  /** Plain words: why a step failed or the configuration was skipped. */
  readonly detail: string | null;
}

/** The liveness window the page shows freshness against (W4, the lag badge). */
export interface LinkWindow {
  readonly heartbeatMs: number | null;
  /** Received silence after which the link is STALE. */
  readonly silenceMs: number;
}

/**
 * Phase 3 (SAFETY §4.4a): what a job is doing.
 * - `loading`: the prep reads are being taken; `ready` / `blocked`: sanitised with the live board's values;
 * - `checking` (base PREAMBLE): Start was allowed; the prep reads are taken again and the file is sanitised again
 *   with the board's current position, offsets, modes and limits before anything is sent (independent review
 *   2026-11-03, R3);
 * - `preparing` (base PREAMBLE): the line mode is checked and set (H77), the job's `rt` lines are sent;
 * - `running`: lines are streamed by the line buffer's free slots; `draining`: feeding stopped before a stop
 *   point (a tool change, a breakpoint, after a program stop line) and the queue is draining; `ending`: every line
 *   is sent and the queue is draining to the end;
 * - `pausing` / `paused`: a Pause (`!`) and its confirmed hold; `refused`: a line was refused and the job is held;
 * - `outputsOff` (base PROGRAM_PAUSED): drained at a tool change; `M5` and `M9` are being answered (independent
 *   review 2026-11-03, R6: the change-ready state is shown only once both are answered with status 0);
 * - `toolChange`, `breakpoint`, `programStop` (base PROGRAM_PAUSED): drained and stopped at the stop point;
 * - `resuming`: the lines that put the machine back after a tool change;
 * - `done`, `stopped`, `failed`: ended.
 */
export type JobPhase =
  | 'loading'
  | 'ready'
  | 'blocked'
  | 'checking'
  | 'preparing'
  | 'running'
  | 'draining'
  | 'ending'
  | 'pausing'
  | 'paused'
  | 'refused'
  | 'outputsOff'
  | 'toolChange'
  | 'breakpoint'
  | 'programStop'
  | 'resuming'
  | 'done'
  | 'stopped'
  | 'failed';

/** Where feeding stops: before `index` (a tool change, a breakpoint), or after it (a program stop line, the end). */
export interface JobStopPoint {
  readonly kind: 'toolChange' | 'breakpoint' | 'barrier' | 'end';
  readonly index: number;
}

export interface JobEvent {
  /** Session time (ms). */
  readonly t: number;
  readonly kind: 'info' | 'warn' | 'toolchange' | 'error';
  readonly text: string;
  /** The file line it is about, when it is about one. */
  readonly line?: number;
}

/** What the sanitiser said, as the page shows it (the lines themselves never leave the worker). */
export interface JobReportSummary {
  readonly blocked: boolean;
  readonly counts: Readonly<Record<'block' | 'warn' | 'change' | 'info', number>>;
  /** The first blocking findings, in plain words with their file line. */
  readonly blocks: readonly { readonly line: number; readonly message: string }[];
  readonly splits: number;
  readonly longestMoveSeconds: number;
  readonly endState: { readonly spindle: 'off' | 'cw' | 'ccw'; readonly mist: boolean; readonly flood: boolean };
  /** File lines of each manual tool change (H74). */
  readonly toolChanges: readonly number[];
  /** Spindle speeds the job commands with M3/M4 (C32), and whether it turns the spindle on at all. */
  readonly startsSpindle: boolean;
  readonly speeds: readonly number[];
  /** Modelled seconds of the whole job (an estimate, SAFETY §4.3). */
  readonly seconds: number;
  /** OD-24: the travel check against the board's soft limits (travelCheck.ts). */
  readonly travel?: TravelCheck;
}

export interface JobState {
  readonly id: number;
  readonly name: string;
  /** FNV-1a of the file text, hex: the page checks it is the file it previewed. */
  readonly hash: string;
  readonly bytes: number;
  readonly phase: JobPhase;
  /**
   * The file text and the C22 answer, kept for the job's life: Start sanitises it again with the board's current
   * values (independent review 2026-11-03, R3). Never posted to the page (the snapshot carries a summary).
   */
  readonly source: { readonly text: string; readonly c22: boolean };
  /** The sanitised lines, frozen (SAFETY §4.7 single source of truth). Empty until sanitised. */
  readonly lines: readonly SentLine[];
  /** Modelled seconds still to run from each line to the end (suffix sums), for the remaining-time estimate. */
  readonly secondsFrom: readonly number[];
  readonly report: JobReportSummary | null;
  /** Index of the next line to send. */
  readonly next: number;
  /** Lines answered (the data answers come in order: every line before this index is answered). */
  readonly acked: number;
  /** Free line-buffer slots in the last footer (line mode `f[2]`), or null before the first. */
  readonly free: number | null;
  /** File lines with a breakpoint (the page's, H75). */
  readonly breakpoints: readonly number[];
  /** The stop point the job last stopped at and was resumed from: it is not stopped at again. */
  readonly passed: number | null;
  readonly stop: JobStopPoint | null;
  /** Polled reads in a row that met the drain or pause condition. */
  readonly confirmed: number;
  readonly refused: { readonly index: number; readonly status: number; readonly text: string } | null;
  readonly toolChange: {
    readonly index: number;
    /** When the job stopped at it: offsets read after this were changed at the change (the Z re-zero, OD-24). */
    readonly stoppedAt?: number;
    readonly tool: number | null;
    readonly spindle: 'off' | 'cw' | 'ccw';
    readonly speed: number | null;
    readonly mist: boolean;
    readonly flood: boolean;
    readonly restartsSpindle: boolean;
    /** Machine position where the job stopped (from reports), to return to at a safe height. */
    readonly at: Readonly<Partial<Record<Axis, number>>>;
    /**
     * The job's units (`unit`, 0 inches) and distance mode (`dist`, 1 incremental) when it stopped, read at rest
     * after M5 and M9 (modes.ts): the return moves run in explicit absolute millimetres, then these are put back
     * before the job goes on (independent review 2026-11-03, R1). Unknown: a return is refused.
     */
    readonly units: number | undefined;
    readonly dist: number | undefined;
  } | null;
  /** Lines still to send to put the machine back before the job continues (after a tool change). */
  readonly resumeSteps: readonly { readonly line: string; readonly intent: Intent }[];
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** When the current pause was asked for (Pause, or a refused line). */
  readonly pauseAt: number | null;
  /** The plain-words result or state (W42, W43, W38, ...). */
  readonly message: string | null;
  readonly events: readonly JobEvent[];
  /** The rxm value found when the job was prepared (H77). */
  readonly rxmFrom: number | null;
  /** The job flag last sent, or null (only with the capability, MACHINING_ASSISTANT feed-limit step 3). */
  readonly jobFlag: 0 | 1 | null;
  /**
   * The feed-limit window of this job (`{"rt":{"fi":N}}`, MACHINING_ASSISTANT appendix, H78): the window's first and
   * latest summaries and the one before the latest (all cumulative since the window opened), the executing move's
   * limit as last pushed, whether a summary said its totals are short, and whether a summary came in a format run
   * does not read.
   */
  readonly feedLimit: FeedLimitState | null;
  /** A liveness FAULT stops the job with the spindle off at this time unless it is stopped first (W33). */
  readonly faultStopAt: number | null;
  /**
   * Where the job ended early (Stop job, Spindle off, a fault): the last line the board took, as it was when the
   * job ended, so the card's progress holds there (first-time walk 2026-11-08, S7). Absent until then.
   */
  readonly stoppedAt?: { readonly n: number; readonly line: number };
  /** Set when a stop sequence for this job is under way (Stop job, a fault). */
  readonly stopping: boolean;
  /** The offsets were queued to be read again after the job ended (jobOffsets.ts). */
  readonly offsetsReread?: true;
  /**
   * OD-19: the modes the preview assumes that the file relies on (`needs`, found at the check), what Start decided
   * to write from the values it read (`modes`), and `written` once that line went into the queue (jobModes.ts).
   */
  /** OD-24: the user confirmed C40 (the travel could not be confirmed) for this Start. */
  readonly travelConfirmed?: boolean;
  readonly startModes?: { readonly needs: readonly StartMode[]; readonly modes: readonly StartMode[]; readonly written: boolean };
}

/**
 * The line-mode setting (`rxm`, H77): what to put back when no job runs, and the read or write in progress.
 * `restore` is the value found when this session last prepared a job, or the page's remembered value; null with
 * `memoryKnown` means nothing is remembered (the default, 0, applies). Without `memoryKnown` and no job this
 * session, nothing is restored.
 */
export interface RxmState {
  /** The board's own value before Run changed it, which is what Run puts back. */
  readonly restore: number | null;
  /** The page has said what this browser remembers of the board (H77); until then nothing is decided at connect. */
  readonly memoryKnown: boolean;
  /**
   * Run changed this board's rxm and has not put it back yet: set when the job's `{"rxm":1}` is queued (or from
   * this browser's record of an earlier link), cleared once `restore` reads back. The page keeps it per board, and
   * only a pending record is ever acted on at connect.
   */
  readonly pending: boolean;
  /** A board found in line mode outside a job, with no record that Run changed it, was logged and left as found. */
  readonly leftAsFound: boolean;
  readonly step: { readonly kind: 'read' | 'write' | 'readback'; readonly purpose: 'job' | 'restore'; readonly value: 0 | 1 } | null;
  /** The footer revision the answer to the write is expected to carry (it changes with the mode). */
  readonly footerExpect: FooterRev | null;
  /** The last value read or written and confirmed, or null. */
  readonly current: number | null;
  /** The last thing the session changed, for W39 and W44. */
  readonly changed: { readonly kind: 'job' | 'restore'; readonly from: number; readonly to: number } | null;
  readonly detail: string | null;
}

/**
 * One polled read cycle (`stat`, `hold`, `vel`, `qr`; SAFETY §4.2, §4.5b) as it is being answered: only values
 * the board answered with status 0 IN THIS CYCLE, never the shared live view (which pushed reports also change).
 * The motion and job layers confirm a hold, a flush or a drain only from a complete, successful cycle; a rejected,
 * missing or damaged answer marks the cycle `failed` and it proves nothing (independent review 2026-11-03, R5;
 * H56, H69). Null between cycles.
 */
export interface PollCycle {
  readonly stat?: number;
  readonly hold?: number;
  readonly vel?: number;
  readonly qr?: number;
  readonly failed: boolean;
}

/** A complete poll cycle: every value answered with status 0. */
export type PolledValues = Readonly<Required<Pick<PollCycle, 'stat' | 'hold' | 'vel' | 'qr'>>>;

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
  /** The poll cycle being answered (independent review 2026-11-03, R5), or null. */
  readonly polled: PollCycle | null;
  /** The current or last settings write, or null (SAFETY §4.6, amendment 2026-11-02). */
  readonly settingWrite: SettingWriteState | null;
  /** The firmware update's entry into the bootloader in progress, or null (SAFETY §4.8 as amended 2026-11-03). */
  readonly bootEntry: BootEntryState | null;
  /** The connect-time read and report configuration (amendment 2026-11-02). */
  readonly reports: ReportsState;
  readonly link: LinkWindow;
  /** Phase 3: the loaded or running job, or null (SAFETY §4.4a). */
  readonly job: JobState | null;
  /** Phase 3: the line-mode setting (H77). */
  readonly rxm: RxmState;
  /** The `rt` leaves `{"rt":null}` answered with at connect: the job flag and the feed-limit window need theirs. */
  readonly rtLeaves: readonly string[];
  /** Probe Z (SAFETY §4.5c, H90): the guided probe, from the touch test to "The plate is off". */
  readonly probeZ: ProbeZState;
  /**
   * OD-19: the board's units (`unit`, 0 inches) and distance mode (`dist`, 1 relative) as last read, or as set by a
   * line of run's own that the board answered with status 0; unknown while a job's lines run (boardModes.ts). Never
   * taken from a pushed report.
   */
  readonly boardModes: { readonly units: number | undefined; readonly dist: number | undefined };
  /**
   * OD-19: an alarm ended a jog, go to zero or probe of run's, which had left `G91` (and `G21`): after a Clear alarm
   * answered with status 0, `G90` (and `G20` when the units read before it were inches) goes out (alarmRestore.ts).
   */
  readonly alarmRestore: { readonly units: number | undefined; readonly cleared: boolean } | null;
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

/** `home`: G28.2 (amendment 2026-11-02). `change`: one line that changes a value but moves nothing (G10 L20, G92, G92.1, G28.3, G54..G59). */
export type MotionOp = 'jog' | 'goToZero' | 'home' | 'change';

/** What a `change` sets (decides its read-back). */
export type ChangeKind = 'setZero' | 'setPosition' | 'tempOffset' | 'clearTempOffset' | 'selectCoord';

/**
 * - `feed`: lines (jog pieces or go-to-zero steps) are still being sent;
 * - `drain`: waiting for polled idle (two consecutive reads) before the next step or the finish;
 * - `hold`: `!` written, waiting for the hold to complete (polled);
 * - `flush`: `%` written, waiting for hold 0 and an empty planner;
 * - `held`: a Pause of this session's motion is confirmed (base HELD);
 * - `finish`: the closing lines (`M5`, `M9`, `G90`) are being sent;
 * - `homing`: G28.2 sent; pushed reports say when it may have ended, two polled reads confirm it;
 * - `readback`: homing ended; its single read-back (hom, mpo, pos, home) is being answered.
 */
export type MotionPhase = 'feed' | 'drain' | 'hold' | 'flush' | 'held' | 'finish' | 'homing' | 'readback';

/** Why a hold was started: the user's Pause, a release or lost keep-alive of a hold jog, or Stop job / Spindle off. */
/** `homeAbort`: Pause during homing ends the homing (hold, then flush); the machine is then not homed. */
export type HoldReason = 'pause' | 'release' | 'keepalive' | 'stopJob' | 'refused' | 'homeAbort';

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
  /** `unit` read before a jog or go to zero changed it (0 inches; modes.ts): restored at the end. Unknown: not restored. */
  readonly units: number | undefined;
  /** `dist` read the same way (1 incremental): go to zero and a jog during a job's tool change restore it (Phase 3). */
  readonly dist?: number | undefined;
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
  /** `home`: the axes asked for. `change`: what it sets. */
  readonly axes?: readonly JogAxis[];
  readonly change?: ChangeKind;
  /** `home`: a poll or report has shown the homing cycle running (stat homing, or moving). */
  readonly seen?: boolean;
  /**
   * `change` of an offset (G10 L20, G54..G59): the line, how many times it was written, and when it is written
   * again after a status 13 (buffer full) refusal (firmware bug hunt 2026-11-02, cause unknown: up to 3 attempts).
   */
  readonly line?: string;
  readonly attempts?: number;
  readonly retryAt?: number | null;
}

/** `watchdog`: the receive-silence watchdog (SAFETY §4.2). `motion`: the motion layer's poll and keep-alive tick. */
/** `job`: the job layer's poll tick (drain, pause, the planner gauge) and its deadlines. */
/** `probe`: Probe Z's input poll (every 150 ms in its steps) and its time limits. */
export type TimerId = 'answer' | 'settle' | 'verify' | 'watchdog' | 'motion' | 'job' | 'probe';

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
  // --- Amendment 2026-11-02: homing, set machine position, temporary offset, coordinate system.
  | { readonly intent: 'home'; readonly axes: readonly JogAxis[] }
  | { readonly intent: 'setMachinePosition'; readonly axes: readonly JogAxis[] }
  | { readonly intent: 'tempOffset'; readonly axes: readonly JogAxis[] }
  | { readonly intent: 'tempOffset'; readonly clear: true }
  | { readonly intent: 'selectCoordSystem'; readonly system: number }
  | { readonly intent: 'spindleOn'; readonly output: 'spindle'; readonly direction: 'cw' | 'ccw'; readonly rpm: number }
  | { readonly intent: 'spindleOn'; readonly output: 'mist' | 'flood' }
  | { readonly intent: 'clearAlarm' }
  | { readonly intent: 'positionVerify' }
  /** Release a hold jog (`!`, then `%` once held). Stop class: never gated. */
  | { readonly intent: 'feedhold'; readonly release: true }
  /** Spindle or coolant off alone, idle (Phase 2). Stop class. */
  | { readonly intent: 'spindleOffNow'; readonly outputs: 'spindle' | 'coolant' }
  /** One settings write (SAFETY §4.6, amendment 2026-11-02): gate reads, `{"<key>":<value>}`, then a read-back. */
  | { readonly intent: 'settingsWrite'; readonly key: string; readonly value: number }
  /** The firmware update (SAFETY §4.8 as amended 2026-11-03): the idle gate, then `{"boot":1}`, then the link closes. */
  | { readonly intent: 'flash' }
  // --- Phase 3 jobs (SAFETY §4.4a). Denied by the matrix and the session under any release without jobs.
  /** Load a job (the file text, sanitised here with the live board's values), or unload it (`job: null`). */
  | { readonly intent: 'loadJob'; readonly job: { readonly name: string; readonly text: string; readonly c22: boolean } | null }
  /** Start the loaded job. `confirm`: the page's confirmations (C36 unhomed, C31 work zero, C32 spindle). */
  | { readonly intent: 'startJob'; readonly breakpoints: readonly number[]; readonly confirm: { readonly unhomed: boolean; readonly workZero: boolean; readonly spindle: boolean; readonly travel?: boolean } }
  /** Resume a paused or stopped job. `skip`: continue past a refused line (C33). `spindleRestart`: C35 accepted. */
  | { readonly intent: 'resume'; readonly skip?: boolean; readonly spindleRestart?: boolean }
  | { readonly intent: 'jobBreakpoints'; readonly lines: readonly number[] }
  // --- Probe Z (SAFETY §4.5c, H90). Decided again by the session every time.
  /** Start (or restart) the touch test with the owner's plan, mm and mm/min. */
  | { readonly intent: 'probeZ'; readonly step: 'touch'; readonly thicknessMm: number; readonly depthMm: number; readonly feed: number }
  /** Start the probe after C39, with the plan the touch test holds. */
  | { readonly intent: 'probeZ'; readonly step: 'start'; readonly confirm: true }
  | { readonly intent: 'probeZ'; readonly step: 'retest' }
  /** Cancel before the probe, and "The plate is off". Neither writes anything. */
  | { readonly intent: 'probeZClose'; readonly step: 'cancel' | 'plateOff' }
  /** Any other allow-matrix intent: always denied (decided, never silently dropped). */
  | {
      readonly intent: Exclude<
        Intent,
        | 'connect'
        | 'disconnect'
        | 'feedhold'
        | 'stopJob'
        | 'spindleOffNow'
        | 'ackFault'
        | 'acknowledgeLost'
        | 'enq'
        | 'read'
        | 'jog'
        | 'goToZero'
        | 'setWorkZero'
        | 'spindleOn'
        | 'clearAlarm'
        | 'resume'
        | 'positionVerify'
        | 'settingsWrite'
        | 'flash'
        | 'home'
        | 'setMachinePosition'
        | 'tempOffset'
        | 'selectCoordSystem'
        | 'loadJob'
        | 'startJob'
        | 'jobBreakpoints'
        | 'probeZ'
        | 'probeZClose'
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
  | { readonly type: 'lineWritten'; readonly epoch: number; readonly seq: number; readonly at?: number }
  /** Line `seq` was not written: by the time it reached the transport the matrix no longer allowed it. `index`: a job line's. */
  | { readonly type: 'lineDropped'; readonly epoch: number; readonly seq: number; readonly index?: number }
  | { readonly type: 'writeFailed'; readonly epoch: number; readonly at: number; readonly detail: string }
  | { readonly type: 'writeRefused'; readonly epoch: number; readonly at: number; readonly detail: string }
  | { readonly type: 'linkLost'; readonly epoch: number; readonly at: number }
  | { readonly type: 'timer'; readonly id: TimerId; readonly seq: number; readonly at: number }
  /** A settings drift check found a difference to the profile (NEEDS_REVIEW; its producer arrives with the drift check). */
  | { readonly type: 'driftDetected'; readonly epoch: number }
  /** The user kept the board's settings as this computer's reference (C23, writes nothing): NEEDS_REVIEW is resolved (OD-13 §5). */
  | { readonly type: 'driftResolved'; readonly epoch: number }
  /** Phase 3 (H77): the page's remembered line mode for this board (0 or 1), or null when it remembers none. */
  | { readonly type: 'lineModeMemory'; readonly epoch: number; readonly remembered: number | null };

/**
 * The realtime bytes a session may write: `!` and ENQ, and with a motion release `%` and `~`; ^D (`kill`) only for
 * Stop job or Spindle off while a probe runs (SAFETY §4.5c "Stops"). Never ^X.
 */
export type RealtimeName = 'feedhold' | 'enq' | 'flush' | 'resume' | 'kill';

/** The command kinds of the job layer's lines in the write gate (SAFETY §4.4a). */
export type JobLineKind = 'job' | 'lineMode' | 'jobRuntime';

export type SessionEffect =
  | { readonly kind: 'acquireTransport'; readonly epoch: number; readonly port: PortSelector }
  | { readonly kind: 'open'; readonly epoch: number }
  /**
   * One single-token GET, `{"<token>":null}`, a motion line (`motion`, Phase 2), or (intent `settingsWrite`) one
   * single-token settings write, `{"<token>":<number>}` (the executor appends LF); `seq` numbers it on this link.
   */
  | {
      readonly kind: 'writeLine';
      readonly epoch: number;
      readonly seq: number;
      readonly token: string;
      readonly line: string;
      readonly motion?: { readonly intent: Intent };
      readonly intent?: 'settingsWrite' | 'configureReports' | 'jobLine' | 'lineMode' | 'jobRuntime' | 'flash';
      /** `jobLine`: the job line's index (the write gate checks the bytes are exactly that line). */
      readonly index?: number;
    }
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

/** One feed-limit summary (`fs`, format v1): cumulative since the window opened (MACHINING_ASSISTANT appendix). */
export interface FeedSummary {
  /** Window epoch: a new one zeroes the totals. */
  readonly e: number;
  /** Sequence within the window. */
  readonly q: number;
  /** Milliseconds of cutting time below the programmed feed per cause: axis cap, junction, exact stop, short, single segment, other. */
  readonly c: readonly number[];
  /** Cumulative cutting milliseconds. */
  readonly ct: number;
  /** Cumulative cutting millimetres. */
  readonly cd: number;
}

/** The executing move's feed limit as last pushed (`fl`): rate-limited and coalesced, never a measurement. */
export interface FeedMove {
  /** 0 nothing running, 1 feed move, 2 rapid. */
  readonly k: number;
  /** Cause bits: 1 axis cap, 2 junction, 4 exact stop, 8 short, 16 single segment. */
  readonly m: number;
  /** Percent of the programmed feed the move cruises at (not clamped at 100), null unless a feed move with F. */
  readonly p: number | null;
  /** The executing G-code line, null when nothing runs. */
  readonly n: number | null;
}

export interface FeedLimitState {
  readonly fi: number;
  readonly first: FeedSummary | null;
  readonly prev: FeedSummary | null;
  readonly last: FeedSummary | null;
  readonly move: FeedMove | null;
  readonly short: boolean;
  readonly unsupported: boolean;
}

