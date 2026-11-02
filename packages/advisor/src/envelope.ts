/**
 * The override envelope (MACHINING_ASSISTANT §6.4; §1 principles 2 and 5).
 *
 * One deterministic function bounds every proposed live change, from the
 * rules engine or any AI engine, in every mode, before it can reach an
 * actuator. Given the programmed F and S, the limits, the override state,
 * the machine's condition and a proposal, `decideOverride` returns the
 * bounded change (`apply`), no change (`hold`), a return to 100 % (`reset`)
 * or a refusal (`refuse`). It never throws and never returns NaN.
 *
 * The override is one scale `s` applied to F and S together: the feed is
 * `F·s` and the spindle `S·s`, so the chipload (`F / (S·z)`) never changes.
 * The rules, in the order they are applied:
 *
 * 1. **Forced to 100 %** (`reset`, and Auto drops to Off) on hold, alarm,
 *    fault, lost connection, ORPHANED_MOTION, tool change, job end, or a
 *    Pause or Stop press. A condition that is not exactly `false` (or, for
 *    `connected`, exactly `true`) counts as present: unknown means reset. An
 *    override state that is not a number in range resets too.
 * 2. **Refusals:** programmed F or S, limits or a proposal that are not
 *    finite positive numbers; a programmed S above the tool or spindle
 *    maximum, or below the spindle minimum; a programmed F above the axis
 *    maximum (fix the program: the envelope only ever scales down from it).
 * 3. **Never above programmed:** `s <= 1`, so the feed never exceeds F (nor
 *    the axis maximum, which F is within) and the spindle never exceeds S
 *    (nor the tool or spindle maximum, which S is within).
 * 4. **Together, downward only:** a proposal for F, S or a scale becomes one
 *    scale, the smallest of the ratios it implies (`ratio` when they
 *    differ); F and S never move apart and never go above programmed.
 * 5. **Never below the spindle minimum:** `s >= minRpm / S`. At the minimum
 *    the decision says so (`atSpindleMinimum`) and the advisor stops.
 * 6. **Settle:** nothing changes in the first 3 s of a cut.
 * 7. **Hysteresis:** a change smaller than 2 points is held, and reversing
 *    the last direction needs 4 points.
 * 8. **Rate:** at most one change per 2 s, of at most 5 points of the
 *    programmed value (5 % per 2 s).
 */
import type { Programmed } from './types.ts';

export const ENVELOPE = Object.freeze({
  /** Largest change per step, as a fraction of programmed (5 points). */
  maxStep: 0.05,
  /** Shortest time between two changes, ms. */
  periodMs: 2000,
  /** Smallest change acted on. */
  hysteresis: 0.02,
  /** Smallest change acted on against the last direction. */
  reversalHysteresis: 0.04,
  /** No change in the first part of a cut, ms. */
  settleMs: 3000,
});

/** Below this the floating-point difference of two scales is no difference. */
const EPSILON = 1e-12;

export interface EnvelopeLimits {
  readonly spindleMinRpm: number;
  readonly spindleMaxRpm: number;
  readonly toolMaxRpm?: number;
  /** The axis maximum feed for this move, mm/min. */
  readonly axisMaxFeed?: number;
}

/** The machine's condition, from the session. Unknown counts as present. */
export interface MachineCondition {
  readonly hold: boolean;
  readonly alarm: boolean;
  readonly fault: boolean;
  readonly connected: boolean;
  readonly orphanedMotion: boolean;
  readonly toolChange: boolean;
  readonly jobEnded: boolean;
  readonly pausePressed?: boolean;
  readonly stopPressed?: boolean;
}

export interface OverrideState {
  /** The scale in effect: 1 is 100 % (programmed). */
  readonly scale: number;
  /** When the last change was applied (ms), or null before any. */
  readonly changedAt: number | null;
  readonly lastDirection: 'down' | 'up' | null;
}

export const PROGRAMMED_STATE: OverrideState = Object.freeze({ scale: 1, changedAt: null, lastDirection: null });

export interface EnvelopeInput {
  readonly programmed: Programmed;
  readonly limits: EnvelopeLimits;
  readonly state: OverrideState;
  readonly condition: MachineCondition;
  /** The caller's clock, ms. */
  readonly now: number;
  /** When the current cut started, ms. */
  readonly cutStartedAt?: number;
}

/** Any of: a scale, a feed (mm/min), a spindle speed (rpm). */
export interface OverrideProposal {
  readonly scale?: number;
  readonly feed?: number;
  readonly rpm?: number;
}

export type ForcedReason = 'hold' | 'alarm' | 'fault' | 'connection-lost' | 'orphaned-motion' | 'tool-change' | 'job-end' | 'pause' | 'stop' | 'invalid-state';

export type RefusalReason =
  | 'invalid-programmed'
  | 'invalid-limits'
  | 'invalid-proposal'
  | 'programmed-spindle-above-limit'
  | 'programmed-spindle-below-minimum'
  | 'programmed-feed-above-axis-max';

export type HoldReason = 'settling' | 'no-change' | 'within-hysteresis' | 'reversal-hysteresis' | 'rate-limited';

export type Clamp = 'programmed' | 'spindle-minimum' | 'ratio' | 'rate';

export type EnvelopeDecision =
  | {
      readonly kind: 'apply';
      readonly scale: number;
      readonly feed: number;
      readonly rpm: number;
      /** The bounded target the step moves towards. */
      readonly target: number;
      readonly clampedBy: readonly Clamp[];
      readonly atSpindleMinimum: boolean;
      readonly state: OverrideState;
      readonly message: string;
    }
  | {
      readonly kind: 'hold';
      readonly scale: number;
      readonly reason: HoldReason;
      readonly atSpindleMinimum: boolean;
      readonly message: string;
    }
  | {
      readonly kind: 'reset';
      readonly scale: 1;
      readonly reason: ForcedReason;
      readonly dropToOff: true;
      readonly state: OverrideState;
      readonly message: string;
    }
  | { readonly kind: 'refuse'; readonly scale: number; readonly reason: RefusalReason; readonly message: string };

const FORCED_MESSAGES: Readonly<Record<ForcedReason, string>> = Object.freeze({
  hold: 'Feedhold: overrides back to 100 %, assistant off.',
  alarm: 'Alarm: overrides back to 100 %, assistant off.',
  fault: 'Fault: overrides back to 100 %, assistant off.',
  'connection-lost': 'Connection lost: overrides back to 100 %, assistant off.',
  'orphaned-motion': 'Motion without a session (ORPHANED_MOTION): overrides back to 100 %, assistant off.',
  'tool-change': 'Tool change: overrides back to 100 %, assistant off.',
  'job-end': 'Job ended: overrides back to 100 %, assistant off.',
  pause: 'Pause pressed: overrides back to 100 %, assistant off.',
  stop: 'Stop pressed: overrides back to 100 %, assistant off.',
  'invalid-state': 'The override state is not valid: back to 100 %, assistant off.',
});

const present = (v: unknown): boolean => v !== false && v !== undefined;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finitePositive = (v: unknown): v is number => finite(v) && v > 0;
const pct = (s: number): string => `${Math.round(s * 100)} %`;

/** The first condition that forces a return to 100 %, or null when none does. */
export function forcedReason(condition: MachineCondition): ForcedReason | null {
  if (typeof condition !== 'object' || condition === null) return 'connection-lost';
  if (condition.connected !== true) return 'connection-lost';
  if (condition.hold !== false) return 'hold';
  if (condition.alarm !== false) return 'alarm';
  if (condition.fault !== false) return 'fault';
  if (condition.orphanedMotion !== false) return 'orphaned-motion';
  if (condition.toolChange !== false) return 'tool-change';
  if (condition.jobEnded !== false) return 'job-end';
  if (present(condition.pausePressed)) return 'pause';
  if (present(condition.stopPressed)) return 'stop';
  return null;
}

function reset(reason: ForcedReason, now: number): EnvelopeDecision {
  const state = Object.freeze({ scale: 1, changedAt: finite(now) ? now : null, lastDirection: null });
  return Object.freeze({ kind: 'reset', scale: 1, reason, dropToOff: true, state, message: FORCED_MESSAGES[reason] });
}

function refuse(scale: number, reason: RefusalReason, message: string): EnvelopeDecision {
  return Object.freeze({ kind: 'refuse', scale, reason, message });
}

function hold(scale: number, reason: HoldReason, atSpindleMinimum: boolean, message: string): EnvelopeDecision {
  return Object.freeze({ kind: 'hold', scale, reason, atSpindleMinimum, message });
}

function validState(state: OverrideState, now: number): boolean {
  if (typeof state !== 'object' || state === null) return false;
  if (!(finitePositive(state.scale) && state.scale <= 1)) return false;
  if (state.changedAt !== null && !(finite(state.changedAt) && state.changedAt <= now)) return false;
  return state.lastDirection === null || state.lastDirection === 'down' || state.lastDirection === 'up';
}

function limitsProblem(limits: EnvelopeLimits): boolean {
  if (typeof limits !== 'object' || limits === null) return true;
  if (!(finite(limits.spindleMinRpm) && limits.spindleMinRpm >= 0 && finitePositive(limits.spindleMaxRpm))) return true;
  if (limits.spindleMinRpm > limits.spindleMaxRpm) return true;
  if (limits.toolMaxRpm !== undefined && !finitePositive(limits.toolMaxRpm)) return true;
  return limits.axisMaxFeed !== undefined && !finitePositive(limits.axisMaxFeed);
}

/** The ratios a proposal implies, or null when it is not a valid proposal. */
function proposedRatios(p: OverrideProposal, programmed: Programmed): number[] | null {
  if (typeof p !== 'object' || p === null) return null;
  const ratios: number[] = [];
  for (const [key, divisor] of [
    ['scale', 1],
    ['feed', programmed.feed],
    ['rpm', programmed.rpm],
  ] as const) {
    const v: unknown = p[key];
    if (v === undefined) continue;
    if (!finitePositive(v)) return null;
    ratios.push(v / divisor);
  }
  return ratios.length === 0 ? null : ratios;
}

/** Bounds one proposed change. See the module comment for the rules. */
export function decideOverride(input: EnvelopeInput, proposal: OverrideProposal): EnvelopeDecision {
  if (typeof input !== 'object' || input === null) return reset('invalid-state', Number.NaN);
  const { programmed, limits, state, now } = input;
  // 1. Forced returns to 100 %, before anything else is looked at.
  const forced = forcedReason(input.condition);
  if (forced !== null) return reset(forced, now);
  if (!finite(now) || !validState(state, now)) return reset('invalid-state', now);
  const current = state.scale;

  // 2. Refusals.
  if (typeof programmed !== 'object' || programmed === null || !finitePositive(programmed.feed) || !finitePositive(programmed.rpm)) {
    return refuse(current, 'invalid-programmed', 'The programmed feed and spindle speed must be positive numbers.');
  }
  if (limitsProblem(limits)) return refuse(current, 'invalid-limits', 'The spindle, tool and axis limits must be positive numbers, minimum below maximum.');
  const rpmCeiling = limits.toolMaxRpm === undefined ? limits.spindleMaxRpm : Math.min(limits.spindleMaxRpm, limits.toolMaxRpm);
  if (programmed.rpm > rpmCeiling) {
    return refuse(current, 'programmed-spindle-above-limit', `S${programmed.rpm} is above the ${rpmCeiling} rpm limit of the spindle or tool: fix the program.`);
  }
  if (programmed.rpm < limits.spindleMinRpm) {
    return refuse(current, 'programmed-spindle-below-minimum', `S${programmed.rpm} is below the spindle's ${limits.spindleMinRpm} rpm minimum: nothing to scale down.`);
  }
  if (limits.axisMaxFeed !== undefined && programmed.feed > limits.axisMaxFeed) {
    return refuse(current, 'programmed-feed-above-axis-max', `F${programmed.feed} is above the ${limits.axisMaxFeed} mm/min axis maximum: fix the program.`);
  }
  const minScale = limits.spindleMinRpm / programmed.rpm;
  if (current < minScale - EPSILON) return reset('invalid-state', now);
  const ratios = proposedRatios(proposal, programmed);
  if (ratios === null) return refuse(current, 'invalid-proposal', 'A proposal is a positive scale, feed or spindle speed.');

  // 3-5. One scale, never above programmed, never below the spindle minimum.
  const clampedBy: Clamp[] = [];
  let target = Math.min(...ratios);
  if (Math.max(...ratios) - target > EPSILON) clampedBy.push('ratio');
  if (target > 1) {
    target = 1;
    clampedBy.push('programmed');
  }
  if (target < minScale) {
    target = minScale;
    clampedBy.push('spindle-minimum');
  }
  /** A hold reports whether the scale in effect is already at the spindle minimum. */
  const currentAtMinimum = current <= minScale + EPSILON;

  // 6. Settle.
  if (input.cutStartedAt !== undefined && !(finite(input.cutStartedAt) && now - input.cutStartedAt >= ENVELOPE.settleMs)) {
    return hold(current, 'settling', currentAtMinimum, 'The cut is settling: no change in its first seconds.');
  }
  // 7. Hysteresis.
  const delta = target - current;
  const magnitude = Math.abs(delta);
  if (magnitude <= EPSILON) {
    const message = currentAtMinimum ? `At the spindle minimum (${pct(current)}): the assistant can slow down no further.` : `Already at ${pct(current)}.`;
    return hold(current, 'no-change', currentAtMinimum, message);
  }
  if (magnitude < ENVELOPE.hysteresis - EPSILON) return hold(current, 'within-hysteresis', currentAtMinimum, `A ${pct(magnitude)} change is within the hysteresis band.`);
  const reversing = (delta > 0 && state.lastDirection === 'down') || (delta < 0 && state.lastDirection === 'up');
  if (reversing && magnitude < ENVELOPE.reversalHysteresis - EPSILON) {
    return hold(current, 'reversal-hysteresis', currentAtMinimum, `Reversing direction needs a change of at least ${pct(ENVELOPE.reversalHysteresis)}.`);
  }
  // 8. Rate.
  if (state.changedAt !== null && now - state.changedAt < ENVELOPE.periodMs) {
    return hold(current, 'rate-limited', currentAtMinimum, 'At most one change every 2 s.');
  }
  let step = delta;
  if (magnitude > ENVELOPE.maxStep) {
    step = Math.sign(delta) * ENVELOPE.maxStep;
    clampedBy.push('rate');
  }
  const scale = Math.min(1, Math.max(minScale, current + step));
  const atSpindleMinimum = scale <= minScale + EPSILON;
  const feed = programmed.feed * scale;
  const rpm = Math.min(programmed.rpm, Math.max(limits.spindleMinRpm, programmed.rpm * scale));
  const direction = step < 0 ? 'down' : 'up';
  const nextState: OverrideState = Object.freeze({ scale, changedAt: now, lastDirection: direction });
  const message = atSpindleMinimum
    ? `Feed and spindle to ${pct(scale)}: the spindle is at its minimum, the assistant stops here.`
    : `Feed and spindle to ${pct(scale)} (${direction}).`;
  return Object.freeze({ kind: 'apply', scale, feed, rpm, target, clampedBy: Object.freeze(clampedBy), atSpindleMinimum, state: nextState, message });
}

/**
 * Run on every status report, whether or not any engine proposes anything:
 * a forced return to 100 % (hold, alarm, fault, lost connection,
 * ORPHANED_MOTION, tool change, job end, Pause, Stop, a bad state) never
 * waits for a suggestion. Otherwise it holds the scale in effect.
 */
export function superviseOverride(input: EnvelopeInput): EnvelopeDecision {
  const state: unknown = typeof input === 'object' && input !== null ? input.state : undefined;
  const scale = typeof state === 'object' && state !== null ? (state as OverrideState).scale : undefined;
  return decideOverride(input, scale === undefined ? {} : { scale });
}
