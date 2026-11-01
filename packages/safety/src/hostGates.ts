/**
 * Host gates and their loosening rule (ROADMAP P0-10, SAFETY §4.10 rule 4
 * "Profile field classes", T-S69).
 *
 * Every MachineProfile field is a firmware setting, a host gate or
 * descriptive (the classification itself lives with MachineProfile v2 in
 * `schema`, TB-01). Host gates are the profile values that the host's own
 * safety checks read. A change that LOOSENS a gate is not used by this
 * browser until the user confirms it with C19 — typed `WRITE` for a spindle
 * kind changed away from laser or plasma, for the queued-motion ceiling and
 * for the jog caps. A change that tightens a gate applies at once.
 *
 * The work envelope is never a host gate or any other profile field: it
 * comes only from the live board's `tn`/`tm` (`workEnvelope`).
 */
import { CEILING_SECONDS } from './sanitize/sanitize.ts';
import type { AxisValues } from './sanitize/types.ts';
import { AXES } from './sanitize/types.ts';

/** What drives the tool. Laser and plasma keep W15 shown on TinyG (SAFETY H16). */
export type SpindleKind = 'spindle' | 'laser' | 'plasma' | 'none';

export interface DualMotorAxis {
  readonly axis: string;
  readonly motors: readonly number[];
}

/** The host gates of a MachineProfile (SAFETY §4.10 rule 4). There is deliberately no envelope here. */
export interface HostGates {
  readonly spindleKind: SpindleKind;
  /** Axes driven by two motors; each needs both motors verified before homing (SAFETY §4.1 Home row). */
  readonly dualMotorAxes: readonly DualMotorAxis[];
  /** Queued-motion ceiling in seconds (SAFETY §4.3). */
  readonly queuedMotionCeilingS: number;
  readonly jogCaps: { readonly maxStepMm: number; readonly maxFeedMmPerMin: number };
  readonly homingOrder: readonly string[];
  /** Hold timeout in seconds, or null when disabled (SAFETY §4.4). */
  readonly holdTimeoutS: number | null;
  readonly hostLossPolicy: 'drain' | 'hold-and-spindle-pause';
}

export type HostGateField = keyof HostGates;

export const HOST_GATE_FIELDS: readonly HostGateField[] = Object.freeze([
  'spindleKind',
  'dualMotorAxes',
  'queuedMotionCeilingS',
  'jogCaps',
  'homingOrder',
  'holdTimeoutS',
  'hostLossPolicy',
]);

export interface HostGateChange {
  readonly field: HostGateField;
  /** True when the proposed value relaxes what the host checks. A malformed value always counts as loosening. */
  readonly loosens: boolean;
  /** True when C19 must be typed (`WRITE`) for this change. */
  readonly typed: boolean;
  /**
   * True when the proposed value is not a well-formed value for the field
   * (NaN, null, a string, out of range, ...). It is never applied, not even
   * with C19: a comparison such as `step > cap` against null or NaN is
   * always false, which would silently disable the gate (SAFETY §4.10 rule 4,
   * fail closed).
   */
  readonly malformed: boolean;
}

const SPINDLE_KINDS: readonly unknown[] = ['spindle', 'laser', 'plasma', 'none'];
const HOST_LOSS_POLICIES: readonly unknown[] = ['drain', 'hold-and-spindle-pause'];

const positiveFinite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `value` is a well-formed value for a host-gate field, checked at run time (profiles arrive as untyped JSON). */
function wellFormed(field: HostGateField, value: unknown): boolean {
  switch (field) {
    case 'spindleKind':
      return SPINDLE_KINDS.includes(value);
    case 'dualMotorAxes':
      return (
        Array.isArray(value) &&
        value.every((d: unknown) => isObject(d) && typeof d['axis'] === 'string' && Array.isArray(d['motors']) && d['motors'].every((m: unknown) => Number.isInteger(m)))
      );
    case 'queuedMotionCeilingS':
      return typeof value === 'number' && value >= CEILING_SECONDS.min && value <= CEILING_SECONDS.max;
    case 'jogCaps':
      return isObject(value) && positiveFinite(value['maxStepMm']) && positiveFinite(value['maxFeedMmPerMin']);
    case 'homingOrder':
      return Array.isArray(value) && value.every((a: unknown) => typeof a === 'string');
    case 'holdTimeoutS':
      return value === null || positiveFinite(value);
    case 'hostLossPolicy':
      return HOST_LOSS_POLICIES.includes(value);
  }
}

const sameDual = (a: DualMotorAxis, b: DualMotorAxis): boolean =>
  a.axis === b.axis && a.motors.length === b.motors.length && a.motors.every((m, i) => b.motors[i] === m);

/** Whether `proposed` loosens `confirmed` for one field. Only reached for fields that differ. */
function loosens(field: HostGateField, confirmed: HostGates, proposed: HostGates): boolean {
  switch (field) {
    case 'spindleKind':
      return confirmed.spindleKind === 'laser' || confirmed.spindleKind === 'plasma';
    case 'dualMotorAxes':
      // Dropping or remapping a dual-motor axis removes a verification; adding one only adds checks.
      return confirmed.dualMotorAxes.some((c) => !proposed.dualMotorAxes.some((p) => sameDual(c, p)));
    case 'queuedMotionCeilingS':
      return proposed.queuedMotionCeilingS > confirmed.queuedMotionCeilingS;
    case 'jogCaps':
      return (
        proposed.jogCaps.maxStepMm > confirmed.jogCaps.maxStepMm || proposed.jogCaps.maxFeedMmPerMin > confirmed.jogCaps.maxFeedMmPerMin
      );
    case 'holdTimeoutS':
      return proposed.holdTimeoutS === null || (confirmed.holdTimeoutS !== null && proposed.holdTimeoutS > confirmed.holdTimeoutS);
    // A different homing order or host-loss policy changes what the host relies on: always confirmed.
    case 'homingOrder':
    case 'hostLossPolicy':
      return true;
  }
}

function differs(field: HostGateField, a: HostGates, b: HostGates): boolean {
  return JSON.stringify(a[field]) !== JSON.stringify(b[field]);
}

/** Fields whose loosening needs the typed C19 (`WRITE`). */
const TYPED_FIELDS: ReadonlySet<HostGateField> = new Set(['spindleKind', 'queuedMotionCeilingS', 'jogCaps']);

/**
 * Every host-gate field that differs, and whether the change loosens the
 * gate. A proposed value that is not well-formed is reported as a malformed
 * loosening, whatever the comparison would say.
 */
export function diffHostGates(confirmed: HostGates, proposed: HostGates): HostGateChange[] {
  return HOST_GATE_FIELDS.filter((f) => differs(f, confirmed, proposed)).map((field) => {
    const malformed = !wellFormed(field, proposed[field]);
    const l = malformed || loosens(field, confirmed, proposed);
    return { field, loosens: l, typed: l && TYPED_FIELDS.has(field), malformed };
  });
}

/** What the user did with C19 for this diff. */
export interface C19Acceptance {
  readonly accepted: boolean;
  /** The user typed `WRITE`. */
  readonly typedWrite: boolean;
}

/**
 * The gates this browser uses: a tightening applies at once; a loosening
 * applies only with C19 accepted, and typed where the field needs it; a
 * malformed value never applies. Otherwise the confirmed value stays in force.
 */
export function effectiveHostGates(confirmed: HostGates, proposed: HostGates, c19: C19Acceptance): HostGates {
  const out: Record<string, unknown> = { ...confirmed };
  for (const change of diffHostGates(confirmed, proposed)) {
    const ok = !change.malformed && (!change.loosens || (c19.accepted && (!change.typed || c19.typedWrite)));
    if (ok) out[change.field] = proposed[change.field];
  }
  return out as unknown as HostGates;
}

/** The work envelope per axis, from the live board only. */
export type Envelope = Readonly<Partial<Record<(typeof AXES)[number], { readonly min: number; readonly max: number }>>>;

/**
 * The envelope from the board's `tn` (travel minimum) and `tm` (travel
 * maximum). An axis without both, or with `tn >= tm`, has no envelope, and
 * preflight treats it as unknown. Nothing from a profile is accepted here.
 */
export function workEnvelope(board: { readonly tn: AxisValues; readonly tm: AxisValues }): Envelope {
  const out: Partial<Record<(typeof AXES)[number], { min: number; max: number }>> = {};
  for (const axis of AXES) {
    const min = board.tn[axis];
    const max = board.tm[axis];
    if (min !== undefined && max !== undefined && Number.isFinite(min) && Number.isFinite(max) && min < max) out[axis] = { min, max };
  }
  return out;
}
