/**
 * Probe Z (SAFETY §4.5c, H90; owner 2026-11-07): the view the page reads (`SessionSnapshot.probe`) and the limits it
 * offers. The session decides every command again; this only describes what it publishes.
 */

/** Where the guided probe is. `closed`: nothing in progress. */
export type ProbeStep = 'closed' | 'touch' | 'ready' | 'starting' | 'probing' | 'zeroing' | 'result';

/** The probe input's reading: `in<n>` 1, 0, -1, or not read yet. */
export type ProbeInputReading = 'touching' | 'clear' | 'disabled' | null;

/** Why Probe Z cannot run now. Each has a reason and a next step in the page's copy. */
export type ProbeBlock =
  | 'notConnected'
  | 'lost'
  | 'stale'
  | 'otherTab'
  | 'firmware'
  | 'motionOff'
  | 'settingsUnread'
  | 'noInput'
  | 'manyInputs'
  | 'inputNotZ'
  | 'jerkUnread'
  | 'stopOverLimit'
  | 'alarm'
  | 'spindleOn'
  | 'moving'
  | 'homing'
  | 'held'
  | 'job'
  | 'toolChange'
  | 'unknown'
  | 'needsReview'
  | 'tempOffset'
  | 'noWcs';

/** How a probe that reached the touch test ended. */
export type ProbeOutcome =
  | { readonly kind: 'contactZeroSet'; readonly zeroZ: number; readonly travelMm: number; readonly stopMm: number }
  | { readonly kind: 'noContact' | 'alreadyTripped'; readonly travelMm: number | null; readonly status: 250 }
  | { readonly kind: 'softLimit'; readonly status: 220 }
  | { readonly kind: 'limit'; readonly status: 203 }
  | { readonly kind: 'refused'; readonly status: number; readonly text: string }
  | { readonly kind: 'stopJob'; readonly status: 207 }
  | { readonly kind: 'paused' }
  | { readonly kind: 'lost'; readonly during: 'probe' | 'zero' }
  | { readonly kind: 'noReport' }
  | { readonly kind: 'zeroRefused'; readonly status: number; readonly text: string }
  | { readonly kind: 'zeroUnconfirmed' }
  | { readonly kind: 'cancelled' };

/** The touch test: each mark fills in from a reading only, in order. */
export interface ProbeTouch {
  readonly sawClear: boolean;
  readonly sawTouching: boolean;
  readonly sawReleased: boolean;
  readonly problem: 'startedTouching' | 'noChange' | 'timedOut' | null;
}

/** What the owner asked for, held by the session from `probeTouch` until the result. All mm and mm/min. */
export interface ProbePlan {
  readonly thicknessMm: number;
  readonly depthMm: number;
  readonly feed: number;
  /** Calculated stop distance at this feed and the board's `zjh`. */
  readonly stopMm: number;
  /** The Z the zero sets: thickness less the stop distance. */
  readonly zeroZ: number;
  /** The time limit for a report (depth at feed, plus a margin). */
  readonly maxSeconds: number;
}

export interface ProbeSnapshot {
  readonly block: ProbeBlock | null;
  readonly step: ProbeStep;
  /** The probe input: its words (`Z min`), token (`in5`), reading and polarity (`prbp` 0 is active low). */
  readonly input: { readonly label: string; readonly token: string; readonly reading: ProbeInputReading; readonly activeLow: boolean } | null;
  readonly touch: ProbeTouch;
  /** The board's Z jerk for the stop distance (`zjh`), or null when unread. */
  readonly zjh: number | null;
  /** The active work system's words (`G54`), or null. */
  readonly system: string | null;
  readonly plan: ProbePlan | null;
  readonly outcome: ProbeOutcome | null;
  /** From the touch test until "The plate is off": Start job and Spindle on are refused. */
  readonly plateOut: boolean;
}
