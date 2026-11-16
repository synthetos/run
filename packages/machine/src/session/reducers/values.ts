import {
  PROBE_STEPS,
  type MachineClass
} from '@synthetos/protocol';
import {
  type Axis,
  type LiveState,
  type ReportsState,
  type RxmState
} from '../types.ts';

/** Fresh per reducer, as in the original closure. */
export function createReducerValues() {

  /** OD-14: the margin after a persisted SET's own reply before the next line (TinyG maintainer, N35). */
  const NORMALIZE_SETTLE_MS = 50;

  /** Tokens READING reads, where the dialect's allowlist has them (SAFETY H14 inputs, PN §2.3 step 0). */
  const READING_TOKENS: readonly string[] = Object.freeze(['stat', 'hold', 'vel', 'qr', 'ex']);

  /**
   * `ex` values a full session accepts: FLOW_CONTROL_OFF, FLOW_CONTROL_XON and
   * FLOW_CONTROL_RTS (@cite EN config.h:204-206; TG config.h:206-208).
   * RTS (2) is accepted since OD-33 (2026-11-10): run holds RTS on after every
   * open (rts.ts), and line mode keeps the unanswered bytes far below the
   * board's RTS marks (TinyG B-FC-1, measured on 450.02 and edge-next). An ex
   * that cannot be read, or any other value, still makes the session READ_ONLY
   * (fail closed). Run never writes ex (SAFETY H61).
   */
  const FULL_SESSION_FLOW_CONTROL: ReadonlySet<number> = new Set([0, 1, 2]);

  /** READING's extra tokens in a motion session: the homing state (W34, IDLE_HOMED) and the units to restore after a jog. */
  const MOTION_READING_TOKENS: readonly string[] = Object.freeze(['home', 'unit']);

  /** Tokens the `ackFault` verification reads (SAFETY §3 FAULT exits). */
  const VERIFY_TOKENS: readonly string[] = Object.freeze(['hold', 'qr']);

  /** The probe's tokens: the only GETs written before the board is classified (PN §2.3, probe.ts). */
  const PROBE_TOKENS: ReadonlySet<string> = new Set(PROBE_STEPS.map((s) => s.key));

  const AXES: readonly Axis[] = ['x', 'y', 'z', 'a', 'b', 'c'];

  /** Machine classes that mean the board is moving or about to (unsolicited report while connecting). */
  const MOTION_CLASSES: ReadonlySet<MachineClass> = new Set(['running', 'homing', 'jogging', 'probing']);

  /** Classes READING takes as a controller alarm in a motion session (not motion from elsewhere). */
  const ALARM_CLASSES: ReadonlySet<MachineClass> = new Set(['alarm', 'softAlarm', 'shutdown']);

  const EMPTY_LIVE: LiveState = Object.freeze({ pos: Object.freeze({}), mpo: Object.freeze({}) });

  const REPORTS_IDLE: ReportsState = Object.freeze({ phase: 'idle', step: null, remaining: Object.freeze([]), heartbeatMs: null, changes: Object.freeze([]), detail: null });

  const RXM_IDLE: RxmState = Object.freeze({ restore: null, memoryKnown: false, pending: false, leftAsFound: false, step: null, footerExpect: null, current: null, changed: null, detail: null });

  /** The fallback silence window (no heartbeat) with the default timings. */
  const DEFAULT_SILENCE_MS = 7000;

  /** The ENQ byte when `enqAllowedNow` holds (dialect data: present exactly where `caps.enq`), else undefined. */

  /**
   * TinyG 450.02 statuses (EN error.h:211-212): a persisted setting written while a job runs or has queued work is
   * refused and nothing changes (117, N60; listed in the tinyg-en status table as notAccepted); stored settings that
   * would not load run on their defaults, reported once after the banner (118, N61), which the session turns into a
   * start-up notice instead of a FAULT.
   */
  const TINYG_SETTING_REFUSED_IN_CYCLE = 117;
  const TINYG_SETTINGS_DEFAULTED = 118;

  // --- Intents -------------------------------------------------------------

  const PHASE_1_NOT_HANDLED = {
    reason: 'The machine session does not handle this request in this release.',
    remedy: 'This release only reads the machine; use your usual sender to control it.',
  };

  // --- The firmware update: into the bootloader (SAFETY §4.8 as amended 2026-11-03, H79-H88) -------

  /** The TinyG dialects whose firmware takes `{"boot":1}` (EN `hw_run_boot`; TG and stock 449 the same token). */
  const BOOT_DIALECTS: readonly string[] = ['tinyg-en', 'tinyg-440', 'tinyg-449-stock'];

  /** The exact line that asks the running firmware to reset into its bootloader. Written only by `flash`. */
  const BOOT_LINE = '{"boot":1}';

  /** Raw `stat` values that count as resting without a dialect: READY and PROGRAM_END (SAFETY H14 mitigation 2). */
  const UNCLASSIFIED_RESTING_STAT: ReadonlySet<number> = new Set([1, 4]);

  // --- Watchdog (SAFETY §4.2) -------------------------------------------------

  /** The token of the proof-of-life GET where ENQ is not available. */
  const LIVENESS_TOKEN = 'stat';
  return { NORMALIZE_SETTLE_MS, READING_TOKENS, FULL_SESSION_FLOW_CONTROL, MOTION_READING_TOKENS, VERIFY_TOKENS, PROBE_TOKENS, AXES, MOTION_CLASSES, ALARM_CLASSES, EMPTY_LIVE, REPORTS_IDLE, RXM_IDLE, DEFAULT_SILENCE_MS, TINYG_SETTING_REFUSED_IN_CYCLE, TINYG_SETTINGS_DEFAULTED, PHASE_1_NOT_HANDLED, BOOT_DIALECTS, BOOT_LINE, UNCLASSIFIED_RESTING_STAT, LIVENESS_TOKEN };
}
