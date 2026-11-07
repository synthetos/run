/**
 * Probe Z (SAFETY §4.5c, H90): what the session keeps between events. The page sees a projection of it
 * (view.ts, `ProbeSnapshot`); nothing here is posted as is.
 */
import type { ProbeBlock, ProbeInputReading, ProbeOutcome, ProbePlan, ProbeStep, ProbeTouch } from './types.ts';

/** The switch-mode tokens in switch order: `in1`..`in8` are X min, X max, Y min, Y max, Z min, Z max, A min, A max (EN switch.h:69-80). */
export const SWITCH_TOKENS: readonly string[] = Object.freeze(['xsn', 'xsx', 'ysn', 'ysx', 'zsn', 'zsx', 'asn', 'asx']);

/**
 * What the probe reads from the board, at connect and again when each touch test starts. (The G92 offsets come from
 * the session's own reads: the connect-time state read and the read-back after every G92 or G92.1.)
 */
export const SETTING_TOKENS: readonly string[] = Object.freeze([...SWITCH_TOKENS, 'prbp', 'zjh']);

/** The probe settings as read: null until read (or when the answer was refused or damaged). */
export interface ProbeSettings {
  /** Switch modes in switch order (4 is probe). */
  readonly modes: readonly (number | null)[];
  /** Probe polarity: 0 active low (normally open, the default), 1 active high. */
  readonly prbp: number | null;
  /** The Z homing jerk the probe runs at, in mm units (the board converts it in inches mode). */
  readonly zjh: number | null;
}

export const SETTINGS_UNREAD: ProbeSettings = Object.freeze({ modes: Object.freeze(SWITCH_TOKENS.map(() => null)), prbp: null, zjh: null });

export const TOUCH_NONE: ProbeTouch = Object.freeze({ sawClear: false, sawTouching: false, sawReleased: false, problem: null });

/** Where the zero is: its line queued or written, the EEPROM wait, the read-back, putting the modes back. */
export type ZeroPhase = 'line' | 'settle' | 'readback' | 'restore';

/** One probe from the owner's Start to its result. */
export interface ProbeRun {
  /** Z when the probe started: work position (450.02 report frame) and machine position (450.03+), mm. */
  readonly fromPos: number | null;
  readonly fromMpo: number | null;
  /** `unit` and `dist` when it started (0 inches, 1 incremental): put back after the zero. */
  readonly units: number | undefined;
  readonly dist: number | undefined;
  /** The check at rest passed and `G21` was queued. */
  readonly checked: boolean;
  /** The `G38.2` was queued (once it has left the queue it may run, even if Pause comes before its answer). */
  readonly sent: boolean;
  /** The time limit for the report, from the `G38.2`'s answer; null until then. */
  readonly deadline: number | null;
  /** Pause or Stop job was pressed since the start: nothing is zeroed from here on. */
  readonly stopped: 'pause' | 'stopJob' | null;
  /** The `{"prb":...}` report: `e` and Z in the report's frame. */
  readonly report: { readonly e: 0 | 1; readonly z: number | null } | null;
  /** Polled reads in a row at rest after a contact report. */
  readonly confirmed: number;
  readonly zero: ZeroPhase | null;
  readonly settleUntil: number | null;
  /** The read-back of the zero, as answered (status 0 only). */
  readonly readback: { readonly posZ?: number; readonly ofsZ?: number; readonly coor?: number };
  /** The outcome decided while the modes are being put back (shown once the restore is answered). */
  readonly pending: ProbeOutcome | null;
}

export interface ProbeZState {
  readonly step: ProbeStep;
  /** Why Probe Z cannot run now, decided again after every event (sync.ts). */
  readonly block: ProbeBlock | null;
  readonly settings: ProbeSettings;
  /** The settings are being read again at the start of a touch test: the input is not polled until they are. */
  readonly refreshing: boolean;
  readonly reading: ProbeInputReading;
  readonly readingAt: number | null;
  readonly plan: ProbePlan | null;
  readonly touch: ProbeTouch;
  /** When the touch test last made progress (or started), and when it passed. */
  readonly touchAt: number | null;
  readonly passedAt: number | null;
  /** Position, state and input configuration when the touch test started: any change lapses it. */
  readonly anchor: string | null;
  readonly run: ProbeRun | null;
  readonly outcome: ProbeOutcome | null;
  readonly plateOut: boolean;
  /**
   * The `G38.2` went out, or ^D was written for the probe: the alarm it may still raise (250, 220, 203, 207) is the
   * probe's outcome, not a FAULT. Cleared when one is taken, on a contact without a stop, and when the plate is off.
   */
  readonly alarmExpected: boolean;
}

export const PROBE_CLOSED: ProbeZState = Object.freeze({
  step: 'closed',
  block: 'notConnected',
  settings: SETTINGS_UNREAD,
  refreshing: false,
  reading: null,
  readingAt: null,
  plan: null,
  touch: TOUCH_NONE,
  touchAt: null,
  passedAt: null,
  anchor: null,
  run: null,
  outcome: null,
  plateOut: false,
  alarmExpected: false,
});

/** Steps in which the probe owns the machine: the touch test to the zero. */
export function probeOpen(step: ProbeStep): boolean {
  return step === 'touch' || step === 'ready' || probeRunning(step);
}

/** Steps after the owner's Start: lines have been or are being sent. */
export function probeRunning(step: ProbeStep): boolean {
  return step === 'starting' || step === 'probing' || step === 'zeroing';
}
