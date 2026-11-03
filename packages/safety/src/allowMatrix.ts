/**
 * The allow-matrix (ROADMAP P0-10, SAFETY §4.1, §3; T-S3, T-S58, T-S62).
 *
 * A declarative table over base state × overlay × intent. `allowed()`
 * answers the state-level question for every cell; the machine session adds
 * the per-intent context gates that are not state (facts, freshness, the
 * controlling tab, confirmations) when those intents arrive in later phases.
 *
 * The normative rule of SAFETY §4.1 overrides every row: Feedhold, Stop job
 * and Spindle/coolant off now are allowed in every state and every overlay in
 * which the port is open, and nothing here gates them on facts, profiles,
 * auth, the advisory, the wake lock, page visibility or the release.
 *
 * Phase 0 (this release) opens no port, so every motion, write and connect
 * intent is denied with "not available in this release" (ROADMAP P0-10).
 * The state-level rules below are already the full design, and the tests
 * run them with every release gate open too, so turning a gate on later
 * cannot weaken them unnoticed.
 *
 * Account and cloud state are not part of the statechart (SAFETY §3): the
 * cloud intents appear here only so that "denied while LIVE" is decided in
 * the same table and generated test (RUN_PLAN §5.5, T-S58). A change to this
 * file needs owner review (SAFETY §8, CODEOWNERS).
 */

/** Base states of the connection and motion statechart (SAFETY §3). */
export const BASE_STATES = Object.freeze([
  'NOT_CONNECTED',
  'PORT_REQUEST',
  'OPENING',
  'IDENTIFYING',
  'READING',
  /** The board's id does not match the selected profile: the user picks the machine. */
  'BLOCKED',
  'CONNECTED_UNKNOWN',
  'IDLE_UNHOMED',
  'IDLE_HOMED',
  'JOGGING',
  'HOMING',
  'SETTINGS_WRITE',
  'JOB_LOADED',
  'PREFLIGHT_OK',
  /** SAFETY §3 "JOB_LOADED → PREFLIGHT_OK | BLOCKED": named apart from the machine BLOCKED above. */
  'PREFLIGHT_BLOCKED',
  'ARMED',
  'PREAMBLE',
  'RUNNING',
  'HOLD_REQUESTED',
  'HELD',
  'BARRIER_DRAINING',
  'PROGRAM_PAUSED',
  'END_HOLDBACK',
  'DONE',
  'STOPPING_JOB',
  'ALARM',
  'SHUTDOWN',
  'PANIC',
  'INTERLOCK',
  'BOOTLOADER_MODE',
] as const);

export type BaseState = (typeof BASE_STATES)[number];

/** Overlays, in precedence order (SAFETY §3: FAULT > LOST > ORPHANED_MOTION > UNKNOWN > STALE > READ_ONLY > NEEDS_REVIEW). */
export const OVERLAYS = Object.freeze(['FAULT', 'LOST', 'ORPHANED_MOTION', 'UNKNOWN', 'STALE', 'READ_ONLY', 'NEEDS_REVIEW'] as const);

export type Overlay = (typeof OVERLAYS)[number];

/** Every intent the matrix decides (SAFETY §4.1 rows, RUN_PLAN §5.5 cloud intents). */
export const INTENTS = Object.freeze([
  'feedhold',
  'stopJob',
  'spindleOffNow',
  'read',
  'enq',
  'resetController',
  'ackFault',
  'acknowledgeLost',
  'positionVerify',
  'keepBoardSettings',
  'jog',
  'home',
  'consoleLine',
  'spindleOn',
  'setWorkZero',
  /** Phase 2: rapid to work zero, Z raised first in machine coordinates (WORKSPACE_FEATURES Jog). */
  'goToZero',
  /** Phase 2: `{"clear":null}` after the user read why the controller alarmed (C13). */
  'clearAlarm',
  /** Phase 2 (amendment 2026-11-02): `G28.3` sets the machine position here without moving, for machines without homing switches (C26). */
  'setMachinePosition',
  /** Phase 2 (amendment 2026-11-02): a temporary offset, `G92` (C27), and clearing it, `G92.1` (C28). Not saved on the controller. */
  'tempOffset',
  /** Phase 2 (amendment 2026-11-02): select the work coordinate system, `G54`..`G59` (C29). */
  'selectCoordSystem',
  /**
   * The session's own status-report configuration at connect (amendment 2026-11-02, H64): the persisted
   * status report list (`{sr:{...}}`), `sv`, an absurd `si`, and the RAM-only heartbeat (`{"rt":{"hb":N}}`).
   * Never a user request: the session issues it once per link and reads every value back.
   */
  'configureReports',
  'optionalStop',
  /**
   * Phase 3 (jobs, owner 2026-11-02; SAFETY §4.4a): start streaming the loaded job, from idle, after the start
   * preconditions (C30-C32, C36). The session itself checks the job, the line mode and the board.
   */
  'startJob',
  /** Phase 3: one line of the running job, written only while RUNNING (the streamer's own lines). */
  'jobLine',
  /**
   * Phase 3: the line-mode switch `{"rxm":1}` for a job and the write that puts the board's own value back
   * (SAFETY H77): its own reviewed intent, never a settings write. Only while nothing moves.
   */
  'lineMode',
  /** Phase 3: the RAM-only `rt` lines of a job, the job flag (`{"rt":{"job":N}}`) and the feed-limit window (`{"rt":{"fi":N}}`). */
  'jobRuntime',
  /** Phase 3: the window's breakpoints for the loaded job. Writes nothing to the controller. */
  'jobBreakpoints',
  'settingsWrite',
  'applyProfile',
  'flash',
  'loadJob',
  'loadLibraryJob',
  'arm',
  'start',
  'resume',
  'connect',
  'disconnect',
  'signOut',
  'switchAccount',
  'deleteArmedFile',
  'changeProfile',
  'forgetMachine',
  'cloudSync',
] as const);

export type Intent = (typeof INTENTS)[number];

/**
 * What kind of intent this is. `stop` is the normative stop class.
 * `motion`, `write`, `settings`, `reports` and `port` are the kinds a release can hold back.
 * `reports` (the session's status-report configuration, amendment 2026-11-02) is on only where the
 * release says so: it writes the persisted status report list, so it is never on in a read-only release.
 * `settings` (settings writes, SAFETY §4.6, amendment 2026-11-02) has a gate of
 * its own, so turning on other writes (work zero) never turns on settings
 * writes, and the reverse.
 */
export type IntentKind = 'stop' | 'read' | 'recovery' | 'session' | 'motion' | 'write' | 'settings' | 'reports' | 'jobs' | 'flash' | 'port' | 'job' | 'cloud';

/** The stop-class intents of the normative rule (SAFETY §4.1). */
export const STOP_CLASS: readonly Intent[] = Object.freeze(['feedhold', 'stopJob', 'spindleOffNow']);

/** What `allowed` needs to know about the session. Account state is deliberately absent (SAFETY §3, D1). */
export interface MatrixSnapshot {
  readonly base: BaseState;
  readonly overlays: readonly Overlay[];
  /** The capability probe has classified the board (SAFETY §3; ORPHANED_MOTION unclassified allows only `!` and reset). */
  readonly classified: boolean;
  /** The classified dialect answers ENQ (`caps.enq`, `tinyg-en` only; T-S24b). */
  readonly enqCapable: boolean;
}

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly remedy: string; readonly citation: string };

/** Which intent kinds this release enables. */
export interface Release {
  readonly name: string;
  readonly motion: boolean;
  readonly write: boolean;
  readonly port: boolean;
  /**
   * Settings writes (kind `settings`). Absent means false. Turned on only by
   * the settings-write phase switch (settingsPhase.ts) for the bench and
   * staging environments.
   */
  readonly settings?: boolean;
  /**
   * The session's status-report configuration (kind `reports`, amendment 2026-11-02, H64): it may set the
   * board's persisted status report list, `sv` and an absurd `si`, and turn on the RAM-only heartbeat.
   * Absent means false. On with the Phase 2 motion release (bench and staging only).
   */
  readonly reports?: boolean;
  /**
   * Phase 3 jobs (kind `jobs`, owner 2026-11-02, SAFETY §4.4a): start a job, stream its lines, switch the board
   * to line mode for it and put the value back, and the job's RAM-only `rt` lines. Absent means false. Turned on
   * only by the jobs phase switch (jobsPhase.ts) for the bench and staging environments, on top of motion.
   */
  readonly jobs?: boolean;
  /**
   * The firmware update (kind `flash`, owner 2026-11-03, SAFETY §4.8 as amended): the session's `{"boot":1}` into
   * the bootloader, after its own idle gate. Absent means false. Turned on only by the flasher phase switch
   * (flasherPhase.ts) for the bench and staging environments.
   */
  readonly flash?: boolean;
}

/** This release: Phase 0, no serial (ROADMAP P0-10, RUN_PLAN §11). */
export const CURRENT_RELEASE: Release = Object.freeze({ name: 'Phase 0', motion: false, write: false, port: false });

/**
 * Phase 1, bench read-only (ROADMAP P1-02, RUN_PLAN §11): a port may be
 * opened (`connect`), and nothing that moves the machine or writes to it is
 * allowed. With this release the only machine-path intents the matrix allows
 * are reads, the liveness probe (classified `tinyg-en` only), `ackFault`
 * and the stop class; `resetController` (^X) is a write and stays denied.
 * The machine session still maps Stop job and Spindle off to `!` alone in
 * this phase (SAFETY §4.4 READ_ONLY row): no ^D, `%` or M-code is ever sent.
 * The machine session uses this release in every build that has a
 * transport. Production does not get one: its deploy refuses any artifact
 * that carries the transport chunk and it serves `serial=()` (P1-09).
 */
export const PHASE_1_RELEASE: Release = Object.freeze({ name: 'Phase 1', motion: false, write: false, port: true });

/**
 * Phase 2, bench motion (owner, 2026-11-02; SAFETY §4.5b): Phase 1 plus the
 * motion intents (jog, go to zero, set work zero, spindle and coolant,
 * clear alarm, resume of a hold this session made). Settings writes are a
 * separate kind (`settings`), added on top by `withSettingsWrites` where the
 * settings switch allows it (settingsPhase.ts). The machine worker uses this release only where
 * the motion capability flag is on (bench and staging origins; never
 * production, apps/web/src/machine-worker/motionFlag.ts).
 */
export const PHASE_2_RELEASE: Release = Object.freeze({ name: 'Phase 2', motion: true, write: false, port: true, reports: true });

/**
 * Phase 1 plus settings writes (SAFETY §4.6, amendment 2026-11-02): as
 * `PHASE_1_RELEASE`, and the `settings` kind is on, so `settingsWrite` is
 * decided by its row (idle, approved firmware, no overlay but NEEDS_REVIEW).
 * Motion and every other write stay off. The machine worker uses it only
 * where `settingsWritesEnabled` says so (bench and staging, never production).
 */
export const PHASE_1_SETTINGS_RELEASE: Release = Object.freeze({ name: 'Phase 1 + settings writes', motion: false, write: false, port: true, settings: true });

/** Base states in which the serial port is open (from the first read of IDENTIFYING onwards). */
export const PORT_OPEN_STATES: ReadonlySet<BaseState> = new Set(
  BASE_STATES.filter((s) => s !== 'NOT_CONNECTED' && s !== 'PORT_REQUEST' && s !== 'OPENING'),
);

const IDLE: readonly BaseState[] = ['IDLE_UNHOMED', 'IDLE_HOMED'];

/** States in which a job is active: no new job, no library download, no disconnect (SAFETY §4.1 Load job). */
const JOB_ACTIVE: readonly BaseState[] = [
  'PREAMBLE',
  'RUNNING',
  'HOLD_REQUESTED',
  'HELD',
  'BARRIER_DRAINING',
  'PROGRAM_PAUSED',
  'END_HOLDBACK',
  'STOPPING_JOB',
];

/** Sync pauses here (SAFETY §4.1 Cloud sync, T-S59), and in the transitions into and out of them. */
const SYNC_PAUSED: readonly BaseState[] = ['PREAMBLE', 'RUNNING', 'HOLD_REQUESTED', 'HELD', 'BARRIER_DRAINING', 'END_HOLDBACK', 'STOPPING_JOB'];

const ALL_STATES: readonly BaseState[] = BASE_STATES;
const PORT_OPEN: readonly BaseState[] = [...PORT_OPEN_STATES];
const PORT_OPEN_NOT_BOOTLOADER: readonly BaseState[] = PORT_OPEN.filter((s) => s !== 'BOOTLOADER_MODE');

/** One row of the matrix. */
interface Row {
  readonly kind: IntentKind;
  /** Base states in which the intent is allowed (before overlays). */
  readonly states: readonly BaseState[];
  /** Overlays under which it stays allowed. Any other active overlay denies it. */
  readonly overlays: readonly Overlay[];
  /** Why it is denied in any other base state, and what to do. */
  readonly denied: { readonly reason: string; readonly remedy: string };
  readonly citation: string;
  /** An overlay that must be active for the intent to make sense (ackFault needs FAULT). */
  readonly requires?: Overlay;
}

const PORT_OVERLAYS: readonly Overlay[] = ['FAULT', 'ORPHANED_MOTION', 'UNKNOWN', 'STALE', 'READ_ONLY', 'NEEDS_REVIEW'];

const stopRow = (citation: string): Row => ({
  kind: 'stop',
  states: PORT_OPEN,
  overlays: PORT_OVERLAYS,
  denied: { reason: 'No serial port is open, so nothing can be sent to the controller.', remedy: 'Use your E-stop.' },
  citation,
});

const NOT_IDLE = { reason: 'Only allowed while the machine is idle.', remedy: 'Wait until the machine is idle.' };
const LIVE = {
  reason: 'Not allowed while a machine is connected.',
  remedy: 'Disconnect the machine first.',
};

/** The matrix. Every intent has exactly one row (the generated test checks it). */
const MATRIX: Readonly<Record<Intent, Row>> = Object.freeze({
  feedhold: stopRow('SAFETY §4.1 normative rule; Feedhold row'),
  stopJob: stopRow('SAFETY §4.1 normative rule; Stop job row'),
  spindleOffNow: stopRow('SAFETY §4.1 normative rule; Spindle/coolant off now row'),
  read: {
    kind: 'read',
    states: PORT_OPEN_NOT_BOOTLOADER,
    overlays: PORT_OVERLAYS,
    denied: { reason: 'Reads need an open port and are never sent to the bootloader.', remedy: 'Connect, or leave bootloader mode.' },
    citation: 'SAFETY §4.1 Read row',
  },
  enq: {
    kind: 'read',
    states: PORT_OPEN_NOT_BOOTLOADER,
    overlays: PORT_OVERLAYS,
    denied: { reason: 'The liveness probe needs an open port and is never sent to the bootloader.', remedy: 'Connect, or leave bootloader mode.' },
    citation: 'SAFETY §4.1 Liveness probe row; T-S24b',
  },
  resetController: {
    kind: 'write',
    states: PORT_OPEN_NOT_BOOTLOADER,
    overlays: PORT_OVERLAYS,
    denied: { reason: 'Reset controller is never sent to the bootloader and needs an open port.', remedy: 'Use the reset button on the board.' },
    citation: 'SAFETY §4.1 Reset controller row; §3 ^X rule',
  },
  ackFault: {
    kind: 'recovery',
    states: PORT_OPEN,
    overlays: PORT_OVERLAYS,
    requires: 'FAULT',
    denied: { reason: 'There is no fault to acknowledge here.', remedy: 'Nothing to do.' },
    citation: 'SAFETY §3 FAULT exits',
  },
  acknowledgeLost: {
    kind: 'session',
    states: ALL_STATES,
    overlays: [...OVERLAYS],
    requires: 'LOST',
    denied: { reason: 'The connection is not lost.', remedy: 'Nothing to do.' },
    citation: 'SAFETY §3 LOST overlay',
  },
  // NEEDS_REVIEW (amended 2026-11-03): after a firmware update the board restarted (UNKNOWN) and its settings differ
  // from this computer's reference (NEEDS_REVIEW); the restore needs UNKNOWN cleared, and confirming moves nothing.
  positionVerify: {
    kind: 'session',
    states: ['CONNECTED_UNKNOWN'],
    overlays: ['UNKNOWN', 'NEEDS_REVIEW'],
    denied: { reason: 'Position verification is only offered while the position is untrusted.', remedy: 'Nothing to do.' },
    citation: 'SAFETY §3 CONNECTED_UNKNOWN; §4.1 Anything else row',
  },
  keepBoardSettings: {
    kind: 'session',
    states: PORT_OPEN_NOT_BOOTLOADER,
    overlays: ['NEEDS_REVIEW'],
    requires: 'NEEDS_REVIEW',
    denied: { reason: 'There is no settings difference to resolve.', remedy: 'Nothing to do.' },
    citation: 'SAFETY §4.1 Anything else row (NEEDS_REVIEW), C23, T-S70',
  },
  // JOGGING: the next short step of the jog already running (a hold-jog or a long step fed in pieces, §4.5b).
  // The session itself refuses to START a jog unless the base state is idle.
  // PROGRAM_PAUSED (Phase 3): jogging to the change position during a manual tool change; the session allows it only then.
  jog: { kind: 'motion', states: [...IDLE, 'JOGGING', 'PROGRAM_PAUSED'], overlays: [], denied: NOT_IDLE, citation: 'SAFETY §4.1 Jog row; §4.5b; §4.4a tool change' },
  goToZero: { kind: 'motion', states: [...IDLE, 'JOGGING'], overlays: [], denied: NOT_IDLE, citation: 'SAFETY §4.1 Jog row; §4.5b Go to zero' },
  clearAlarm: {
    kind: 'motion',
    states: ['ALARM'],
    overlays: [],
    denied: { reason: 'There is no alarm to clear.', remedy: 'Nothing to do.' },
    citation: 'SAFETY §3 From ALARM (C13); §4.5b',
  },
  // HOMING: the G28.2 line of the homing just started is written after the base moved to HOMING (as JOGGING
  // for the jog row). The session itself refuses to START homing unless idle or CONNECTED_UNKNOWN.
  home: {
    kind: 'motion',
    states: [...IDLE, 'CONNECTED_UNKNOWN', 'HOMING'],
    overlays: ['UNKNOWN'],
    denied: NOT_IDLE,
    citation: 'SAFETY §4.1 Home row; normative rule (denied under FAULT, STALE and ORPHANED_MOTION); amendment 2026-11-02',
  },
  // G28.3 is a way out of UNKNOWN for a machine without homing switches (amendment 2026-11-02, H67), so UNKNOWN allows it.
  setMachinePosition: {
    kind: 'motion',
    states: [...IDLE, 'CONNECTED_UNKNOWN'],
    overlays: ['UNKNOWN'],
    denied: NOT_IDLE,
    citation: 'SAFETY §4.5b Set machine position (amendment 2026-11-02); H67; C26',
  },
  tempOffset: { kind: 'motion', states: IDLE, overlays: [], denied: NOT_IDLE, citation: 'SAFETY §4.5b Temporary offset (amendment 2026-11-02); H68; C27, C28' },
  selectCoordSystem: { kind: 'motion', states: IDLE, overlays: [], denied: NOT_IDLE, citation: 'SAFETY §4.5b Work coordinate system (amendment 2026-11-02); C29' },
  // Moves nothing: allowed with an untrusted position (UNKNOWN) and a settings drift (NEEDS_REVIEW). Never under
  // READ_ONLY (an unapproved build is never written to), ORPHANED_MOTION, STALE or FAULT, and never in ALARM (the
  // firmware refuses SETs while alarmed; the session configures after the alarm is cleared).
  configureReports: {
    kind: 'reports',
    states: [...IDLE, 'CONNECTED_UNKNOWN'],
    overlays: ['UNKNOWN', 'NEEDS_REVIEW'],
    denied: { reason: 'Status reports are configured only while the machine is idle.', remedy: 'Wait until the machine is idle.' },
    citation: 'SAFETY §4.2 (amendment 2026-11-02, push-driven state); H64',
  },
  consoleLine: { kind: 'motion', states: IDLE, overlays: [], denied: NOT_IDLE, citation: 'SAFETY §4.1 Console line row' },
  spindleOn: { kind: 'motion', states: IDLE, overlays: [], denied: NOT_IDLE, citation: 'SAFETY §4.1 Manual spindle/coolant on row' },
  // Kind `motion`: setting work zero is part of motion control (P2 in WORKSPACE_FEATURES), not a settings write (§4.5b).
  // PROGRAM_PAUSED (Phase 3): the optional Z re-zero during a manual tool change; the session allows it only then.
  setWorkZero: { kind: 'motion', states: [...IDLE, 'PROGRAM_PAUSED'], overlays: [], denied: NOT_IDLE, citation: 'SAFETY §4.1 Set work zero row; §4.5b; §4.4a tool change' },
  startJob: {
    kind: 'jobs',
    states: IDLE,
    overlays: [],
    denied: { reason: 'A job starts only while the machine is idle, with nothing in the way.', remedy: 'Wait until the machine is idle, and clear any warning first.' },
    citation: 'SAFETY §4.4a Start (Phase 3); §4.1 Start row',
  },
  jobLine: {
    kind: 'jobs',
    states: ['RUNNING'],
    overlays: [],
    denied: { reason: 'Job lines are sent only while the job runs.', remedy: 'Resume the job, or stop it.' },
    citation: 'SAFETY §4.4a streaming (Phase 3); H70, H76',
  },
  lineMode: {
    kind: 'jobs',
    states: [...IDLE, 'CONNECTED_UNKNOWN', 'PREAMBLE'],
    overlays: ['UNKNOWN', 'NEEDS_REVIEW'],
    denied: { reason: 'The line-mode setting is changed only while the machine is idle.', remedy: 'Wait until the machine is idle.' },
    citation: 'SAFETY §4.4a line mode (Phase 3); H77',
  },
  jobRuntime: {
    kind: 'jobs',
    states: [...IDLE, 'PREAMBLE', 'RUNNING', 'HELD', 'PROGRAM_PAUSED'],
    overlays: [],
    denied: { reason: 'The job flag and the feed-limit period are sent only around a job.', remedy: 'Nothing to do.' },
    citation: 'SAFETY §4.4a job flag and feed-limit period (Phase 3); MACHINING_ASSISTANT feed-limit step 3',
  },
  jobBreakpoints: {
    kind: 'session',
    states: PORT_OPEN,
    overlays: PORT_OVERLAYS,
    denied: { reason: 'Breakpoints are kept only while a board is connected.', remedy: 'Connect first.' },
    citation: 'SAFETY §4.4a breakpoints (Phase 3); H75',
  },
  optionalStop: { kind: 'write', states: IDLE, overlays: [], denied: NOT_IDLE, citation: 'SAFETY §4.1 Optional stop row' },
  settingsWrite: {
    kind: 'settings',
    // CONNECTED_UNKNOWN (amendment 2026-11-02): a settings write moves nothing, so an untrusted position
    // does not stop it. The session still proves the board idle with polled reads before every write
    // (stat idle or end, hold 0, vel 0, qr = plannerBlocks), and the UNKNOWN overlay still denies it.
    states: [...IDLE, 'CONNECTED_UNKNOWN'],
    overlays: ['NEEDS_REVIEW'],
    denied: { reason: 'Settings are written only while idle with no job loaded or armed.', remedy: 'Wait until the machine is idle and unload the job.' },
    citation: 'SAFETY §4.1 Settings write row; Anything else row (NEEDS_REVIEW via C19); amendment 2026-11-02',
  },
  applyProfile: {
    kind: 'write',
    states: IDLE,
    overlays: ['NEEDS_REVIEW'],
    denied: { reason: 'A stored profile is applied only while idle with no job loaded or armed.', remedy: 'Wait until the machine is idle and unload the job.' },
    citation: 'SAFETY §4.1 Apply stored profile row',
  },
  // Kind `flash` (amended 2026-11-03): only with the flasher phase switch. READ_ONLY is allowed because an old or
  // unapproved build is exactly what an update replaces (the old-firmware gate); UNKNOWN and NEEDS_REVIEW because
  // entering the bootloader moves nothing. FAULT, LOST, ORPHANED_MOTION and STALE deny it, and so does any state
  // but idle: the session also proves the board at rest with polled reads right before `{"boot":1}`.
  flash: {
    kind: 'flash',
    states: [...IDLE, 'CONNECTED_UNKNOWN'],
    overlays: ['READ_ONLY', 'UNKNOWN', 'NEEDS_REVIEW'],
    denied: { reason: 'Firmware is updated only while the machine is idle, never in an alarm or with motion queued.', remedy: 'Wait until the machine is idle.' },
    citation: 'SAFETY §4.1 Flash row (amended 2026-11-03); §4.8',
  },
  loadJob: {
    kind: 'job',
    states: ALL_STATES.filter((s) => !JOB_ACTIVE.includes(s) && s !== 'BOOTLOADER_MODE'),
    overlays: [],
    denied: { reason: 'A job cannot be loaded while another job is active.', remedy: 'Stop or finish the current job first.' },
    citation: 'SAFETY §4.1 Load job row',
  },
  loadLibraryJob: {
    kind: 'job',
    states: ALL_STATES.filter((s) => !JOB_ACTIVE.includes(s) && s !== 'BOOTLOADER_MODE'),
    overlays: [],
    denied: { reason: 'Library downloads are paused while a job is active.', remedy: 'Stop or finish the current job first.' },
    citation: 'SAFETY §4.1 Load job row (library); H39',
  },
  arm: {
    kind: 'motion',
    states: ['PREFLIGHT_OK'],
    overlays: [],
    denied: { reason: 'A job can be armed only after preflight passes.', remedy: 'Load a job and run preflight.' },
    citation: 'SAFETY §4.1 Arm row',
  },
  start: {
    kind: 'motion',
    states: ['ARMED'],
    overlays: [],
    denied: { reason: 'A job starts only from ARMED.', remedy: 'Arm the job first.' },
    citation: 'SAFETY §4.1 Start row; T-S3',
  },
  resume: {
    kind: 'motion',
    states: ['HELD', 'PROGRAM_PAUSED'],
    overlays: [],
    denied: { reason: 'Resume is only for a held or paused job started in this session.', remedy: 'Use Stop job to end the job.' },
    citation: 'SAFETY §4.1 Resume row',
  },
  connect: {
    kind: 'port',
    states: ['NOT_CONNECTED'],
    overlays: [],
    denied: { reason: 'Already connected.', remedy: 'Disconnect first.' },
    citation: 'SAFETY §3 NOT_CONNECTED',
  },
  disconnect: {
    kind: 'session',
    states: ALL_STATES.filter((s) => s !== 'NOT_CONNECTED' && !JOB_ACTIVE.includes(s) && !['JOGGING', 'HOMING', 'SETTINGS_WRITE', 'BOOTLOADER_MODE'].includes(s)),
    // Under ORPHANED_MOTION too (owner, 2026-11-03, OD-12): closing the port writes nothing and changes nothing on
    // the board; refusing it only kept the user in a session that could do nothing but `!`. The machine is stopped
    // by Stop job, Reset controller or the E-stop, never by a disconnect; the next connect lands in UNKNOWN (H14).
    overlays: ['FAULT', 'UNKNOWN', 'STALE', 'READ_ONLY', 'NEEDS_REVIEW', 'ORPHANED_MOTION'],
    denied: {
      reason: 'Disconnecting now would leave the machine running what it has queued.',
      remedy: 'Use Stop job, or wait for the move or write to finish.',
    },
    citation: 'SAFETY §3 (NOT_CONNECTED only by explicit Disconnect); H1',
  },
  signOut: { kind: 'cloud', states: ['NOT_CONNECTED'], overlays: [], denied: LIVE, citation: 'SAFETY §4.1 Sign out row; T-S58' },
  switchAccount: { kind: 'cloud', states: ['NOT_CONNECTED'], overlays: [], denied: LIVE, citation: 'SAFETY §4.1 Sign out row; T-S58' },
  deleteArmedFile: { kind: 'cloud', states: ['NOT_CONNECTED'], overlays: [], denied: LIVE, citation: 'SAFETY §4.1 Sign out row; T-S58' },
  changeProfile: { kind: 'cloud', states: ['NOT_CONNECTED'], overlays: [], denied: LIVE, citation: 'SAFETY §4.1 Sign out row; T-S58' },
  forgetMachine: {
    kind: 'cloud',
    states: ['NOT_CONNECTED'],
    overlays: [],
    denied: LIVE,
    citation: 'SAFETY §4.1 Destructive device-safety row',
  },
  cloudSync: {
    kind: 'cloud',
    states: ALL_STATES.filter((s) => !SYNC_PAUSED.includes(s)),
    overlays: [...OVERLAYS],
    denied: { reason: 'Sync pauses while a job is running, held, draining or stopping.', remedy: 'Sync resumes on its own afterwards.' },
    citation: 'SAFETY §4.1 Cloud sync row; T-S59',
  },
});

/** Why each overlay denies an intent it does not list. */
const OVERLAY_DENIAL: Readonly<Record<Overlay, { readonly reason: string; readonly remedy: string }>> = Object.freeze({
  FAULT: { reason: 'A fault is latched: only reads, stops, reset and acknowledging the fault are allowed.', remedy: 'Use Stop job or Reset controller, then acknowledge the fault.' },
  LOST: { reason: 'The connection is lost: nothing can be sent.', remedy: 'Use your E-stop, then acknowledge and reconnect.' },
  ORPHANED_MOTION: { reason: 'The machine has motion left from a previous session: it can only be stopped.', remedy: 'Use Stop job or Reset controller.' },
  UNKNOWN: { reason: 'The machine position is not trusted.', remedy: 'Home the machine or verify the position.' },
  STALE: { reason: 'The controller has stopped answering: only reads and stops are allowed.', remedy: 'Wait for the controller to answer, or use Stop job.' },
  READ_ONLY: { reason: 'This firmware is not approved for control: only reads and stops are allowed.', remedy: 'Update the firmware, or use your usual sender.' },
  NEEDS_REVIEW: { reason: "The board's settings differ from the profile.", remedy: 'Review the difference first.' },
});

const NOT_IN_RELEASE = {
  reason: 'Not available in this release.',
  remedy: 'This version of run.synthetos.com does not connect to machines yet.',
};

function deny(reason: string, remedy: string, citation: string): Decision {
  return { allowed: false, reason, remedy, citation };
}

/**
 * Decides one cell. Fails closed: an intent or state the table does not
 * know is denied.
 */
export function allowed(snapshot: MatrixSnapshot, intent: Intent, release: Release = CURRENT_RELEASE): Decision {
  const row = (MATRIX as Readonly<Record<string, Row | undefined>>)[intent];
  if (row === undefined || !(BASE_STATES as readonly string[]).includes(snapshot.base)) {
    return deny('Unknown request.', 'Reload the page.', 'SAFETY §4.1 (fail closed)');
  }
  const overlays = new Set(snapshot.overlays);
  if (
    (row.kind === 'motion' && !release.motion) ||
    (row.kind === 'write' && !release.write) ||
    (row.kind === 'settings' && release.settings !== true) ||
    (row.kind === 'reports' && release.reports !== true) ||
    (row.kind === 'jobs' && release.jobs !== true) ||
    (row.kind === 'flash' && release.flash !== true) ||
    (row.kind === 'port' && !release.port)
  ) {
    return deny(NOT_IN_RELEASE.reason, NOT_IN_RELEASE.remedy, `ROADMAP P0-10 (${release.name})`);
  }
  // The normative rule: stop-class depends on nothing but an open port.
  if (row.kind === 'stop') {
    return PORT_OPEN_STATES.has(snapshot.base) && !overlays.has('LOST') ? { allowed: true } : deny(row.denied.reason, row.denied.remedy, row.citation);
  }
  if (row.requires !== undefined && !overlays.has(row.requires)) return deny(row.denied.reason, row.denied.remedy, row.citation);
  if (!row.states.includes(snapshot.base)) return deny(row.denied.reason, row.denied.remedy, row.citation);
  for (const overlay of OVERLAYS) {
    if (overlays.has(overlay) && !row.overlays.includes(overlay)) {
      const d = OVERLAY_DENIAL[overlay];
      return deny(d.reason, d.remedy, `SAFETY §3 ${overlay}; §4.1 Anything else row`);
    }
  }
  // ORPHANED_MOTION on an unclassified board: only `!` and Reset controller (SAFETY §3, T-S86).
  if (overlays.has('ORPHANED_MOTION') && !snapshot.classified && (row.kind === 'read' || row.kind === 'session')) {
    return deny('The board is not classified yet: only Pause and Reset controller can be sent.', 'Use Stop job or Reset controller.', 'SAFETY §3 ORPHANED_MOTION; T-S86');
  }
  if (intent === 'enq' && !(snapshot.classified && snapshot.enqCapable)) {
    return deny('This controller does not answer the liveness probe.', 'Nothing to do.', 'SAFETY §4.1 Liveness probe row; T-S24b');
  }
  return { allowed: true };
}

/** The row's kind, for UIs and tests. */
export function intentKind(intent: Intent): IntentKind {
  return MATRIX[intent].kind;
}

/** True when the session is LIVE for the cloud rules: any state except NOT_CONNECTED, or an unacknowledged LOST (SAFETY §4.1). */
export function isLive(snapshot: Pick<MatrixSnapshot, 'base' | 'overlays'>): boolean {
  return snapshot.base !== 'NOT_CONNECTED' || snapshot.overlays.includes('LOST');
}
