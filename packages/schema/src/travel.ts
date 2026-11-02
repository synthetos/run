/**
 * Travel ranges as the firmware's soft-limit test reads them (finding P0-09,
 * batch 12; SAFETY §4.6).
 *
 * TinyG (edge-next and 440.21) skips an axis's soft-limit test entirely when
 * its two travel ends are `fp_EQ`, and tests each end only when it is above
 * `DISABLE_SOFT_LIMIT` (@cite EN canonical_machine.c:545-561,
 * canonical_machine.h:45; TG canonical_machine.c:480-496,
 * canonical_machine.h:50). The ends are IEEE single floats (avr-gcc `double`
 * is 32 bits), parsed with `strtof`/`str2float` (@cite EN text_parser.c:148,
 * json_parser.c:589; TG text_parser.c:128, json_parser.c:259) and stored as
 * given under G21 by `set_flu`/`set_flt` (@cite EN config_app.c:797-806).
 * `fp_EQ(a,b)` is `fabs(a-b) < (float)0.00001` (@cite EN util.h:134-139; TG
 * util.h:113-119).
 *
 * So JavaScript `tn < tm` is not enough: `{tn: 0, tm: 0.000001}` and
 * `{tn: 1000, tm: 1000.000001}` both pass it, yet the firmware treats both
 * as equal ends and does not limit the axis at all.
 *
 * The rules are per dialect. Only the TinyG dialects whose source is pinned
 * have an entry; a dialect without one (g2core, a future firmware) gets no
 * TinyG epsilon imposed on it: its travel check fails closed until its own
 * semantics are transcribed.
 */
import type { TinyGDialectId } from './tables/types.ts';

export interface TravelSemantics {
  /** Representation of a stored travel end. */
  readonly float: 'float32';
  /** The `fp_EQ` tolerance, as stored (already float32). */
  readonly epsilon: number;
  /** An end at or below this value is not tested (`DISABLE_SOFT_LIMIT`). */
  readonly disableAtOrBelow: number;
  /** Decimals a travel end is reported with on read-back (config_app row precision). */
  readonly reportedDecimals: number;
  /**
   * Host rule: the smallest span written. Ten times the reported resolution,
   * so a read-back can prove the stored ends are distinct (a 0.0001 span
   * passes `fp_EQ` but reads back as two equal 3-decimal numbers).
   */
  readonly minSpan: number;
  /**
   * The `unit` read-back meaning G21 (millimetres). Linear travel rows are F_CONVERT: the board reports
   * them in inches while its units mode is G20, so a read-back is interpreted only when `unit` reads this.
   */
  readonly millimetresUnit: number;
  readonly cite: string;
}

const f32 = Math.fround;

const TINYG: TravelSemantics = Object.freeze({
  float: 'float32',
  epsilon: f32(0.00001),
  disableAtOrBelow: -1_000_000,
  reportedDecimals: 3,
  minSpan: 0.01,
  millimetresUnit: 1,
  cite: 'EN canonical_machine.c:545-561, util.h:134-139, config_app.c:279-280, config_app.c:815-826 (F_CONVERT out), canonical_machine.h:217-218 (MILLIMETERS=1), canonical_machine.c:2412 (unit); TG canonical_machine.c:480-496, util.h:113-119, config_app.c:277-278, config_app.c:763-770, canonical_machine.h:447-448, canonical_machine.c:1634',
});

/** Per-dialect travel semantics. Stock 449 is read-only and its source is not pinned here: no entry. */
export const TRAVEL_SEMANTICS: Readonly<Partial<Record<string, TravelSemantics>>> = Object.freeze({
  'tinyg-en': TINYG,
  'tinyg-440': TINYG,
} satisfies Partial<Record<TinyGDialectId, TravelSemantics>>);

export function travelSemanticsFor(dialectId: string): TravelSemantics | undefined {
  return Object.hasOwn(TRAVEL_SEMANTICS, dialectId) ? TRAVEL_SEMANTICS[dialectId] : undefined;
}

/** The axes the TinyG soft-limit loop covers (AXIS_X..AXIS_C). */
export const TRAVEL_AXES = Object.freeze(['x', 'y', 'z', 'a', 'b', 'c'] as const);
export type TravelAxis = (typeof TRAVEL_AXES)[number];

const view = new DataView(new ArrayBuffer(4));

/** The float32 `steps` representable values away from `x` (x already float32, finite). */
function f32Step(x: number, steps: number): number {
  view.setFloat32(0, x);
  let bits = view.getInt32(0);
  // Map the sign-magnitude ordering onto a monotonic integer line.
  let ordered = bits < 0 ? -(bits & 0x7fffffff) : bits;
  ordered += steps;
  bits = ordered < 0 ? -ordered | 0x80000000 : ordered;
  view.setInt32(0, bits);
  return view.getFloat32(0);
}

/** `fp_EQ` on two stored floats, with the subtraction rounded to float32 as on the board. */
export function firmwareTravelEqual(sem: TravelSemantics, lo: number, hi: number): boolean {
  return Math.abs(f32(f32(lo) - f32(hi))) < sem.epsilon;
}

/** Each value the firmware may store for `x`: the nearest float32 and its neighbours (the parsers are not guaranteed to round correctly). */
function storedCandidates(x: number): number[] {
  const q = f32(x);
  return [-2, -1, 0, 1, 2].map((s) => f32Step(q, s));
}

export type TravelWriteProblem =
  | { readonly kind: 'order' }
  | { readonly kind: 'firmwareEqual' }
  | { readonly kind: 'tooNarrow' }
  /** The minimum is at or below DISABLE_SOFT_LIMIT. (A maximum there implies the minimum is too: min < max.) */
  | { readonly kind: 'endDisabled' };

/**
 * The problem with a travel range about to be in force (draft over the
 * board's values), or null when the firmware will test both ends as a real
 * range: both ends above `DISABLE_SOFT_LIMIT`, min below max and not `fp_EQ`
 * for every float32 the parser may store, and at least `minSpan` apart.
 */
export function travelWriteProblem(sem: TravelSemantics, lo: number, hi: number): TravelWriteProblem | null {
  if (!(lo < hi)) return { kind: 'order' };
  const los = storedCandidates(lo);
  const his = storedCandidates(hi);
  // float32 rounding is monotonic, so each candidate of lo is at or below the same candidate of hi:
  // when a maximum is at or below the sentinel, so is the minimum, and the minimum is the end to report.
  for (const l of los) if (!(l > sem.disableAtOrBelow)) return { kind: 'endDisabled' };
  for (const l of los) {
    for (const h of his) {
      if (!(l < h)) return { kind: 'firmwareEqual' };
      if (firmwareTravelEqual(sem, l, h)) return { kind: 'firmwareEqual' };
    }
  }
  if (!(hi - lo >= sem.minSpan)) return { kind: 'tooNarrow' };
  return null;
}

// ------------------------------------------------------------- read-back

export type AxisSoftLimit =
  /** Both ends are tested by the firmware, proved from the reported values. */
  | 'enforced'
  /** The reported values cannot prove both ends are tested (equal, near-equal, an end disabled, missing or not a number). */
  | 'notEnforced';

export interface SoftLimitConfirmation {
  /** True only when `sl` reads back 1, `unit` reads back millimetres, and every required axis is `enforced`. */
  readonly active: boolean;
  readonly axes: Readonly<Partial<Record<TravelAxis, AxisSoftLimit>>>;
  /** Why `active` is false, one line each; empty when active. */
  readonly reasons: readonly string[];
}

export interface SoftLimitReadBack {
  /** Values read back from the board after the write, with the planner idle (`sl`, `unit`, `{axis}tn`, `{axis}tm`). */
  readonly values: Readonly<Record<string, unknown>>;
  /** The axes whose soft limits the caller relies on. */
  readonly required: readonly TravelAxis[];
  /** The travel values just written, if any: each must read back as written. */
  readonly written?: Readonly<Record<string, number>>;
}

function num(values: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const v = Object.hasOwn(values, key) ? values[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Confirms from a read-back that the firmware's soft limits are in force on
 * the required axes, before anything treats `softlimits.on` as established.
 *
 * A reported end is the stored float rounded to `reportedDecimals`, so the
 * stored value is anywhere within half a unit of the last decimal (plus one
 * float32 step for the formatter). An axis is `enforced` only when, over that
 * whole interval, both ends are above `DISABLE_SOFT_LIMIT` and are not
 * `fp_EQ`. Homing is a separate fact: TinyG tests only homed axes.
 *
 * A dialect without travel semantics is never confirmed.
 */
export function confirmSoftLimits(dialectId: string, readBack: SoftLimitReadBack): SoftLimitConfirmation {
  const sem = travelSemanticsFor(dialectId);
  const reasons: string[] = [];
  const axes: Partial<Record<TravelAxis, AxisSoftLimit>> = {};
  if (sem === undefined) {
    reasons.push(`no travel semantics for ${dialectId}: soft limits cannot be confirmed`);
    return Object.freeze({ active: false, axes: Object.freeze(axes), reasons: Object.freeze(reasons) });
  }
  const { values } = readBack;
  if (num(values, 'sl') !== 1) reasons.push('soft limits (sl) do not read back as on (1)');
  // Linear travel ends are F_CONVERT rows: under G20 the board reports them in inches (stored mm x 1/25.4), so a
  // stored -1000000 mm minimum reads -39370.079 and would look tested. Only a millimetre read-back is interpreted.
  if (num(values, 'unit') !== sem.millimetresUnit) reasons.push(`units mode (unit) does not read back as millimetres (${sem.millimetresUnit}): travel cannot be read as millimetres`);
  const half = 0.5 * 10 ** -sem.reportedDecimals;
  const slack = (r: number): number => half + Math.abs(f32Step(f32(r), 1) - f32(r));

  for (const [key, w] of Object.entries(readBack.written ?? {})) {
    const r = num(values, key);
    if (r === undefined) reasons.push(`"${key}" was written but did not read back`);
    else if (!(Math.abs(r - f32(w)) <= slack(r))) reasons.push(`"${key}" was written as ${w} but reads back as ${r}`);
  }

  for (const a of TRAVEL_AXES) {
    const rl = num(values, `${a}tn`);
    const rh = num(values, `${a}tm`);
    if (rl === undefined || rh === undefined) {
      if (readBack.required.includes(a)) {
        axes[a] = 'notEnforced';
        reasons.push(`${a.toUpperCase()} travel did not read back`);
      }
      continue;
    }
    const loMin = rl - slack(rl);
    const loMax = rl + slack(rl);
    const hiMin = rh - slack(rh);
    const minTested = loMin > sem.disableAtOrBelow;
    const maxTested = hiMin > sem.disableAtOrBelow;
    // The smallest possible stored span must still be clearly outside fp_EQ (twice epsilon covers the float32 subtraction).
    const distinct = hiMin - loMax >= 2 * sem.epsilon;
    const status: AxisSoftLimit = minTested && maxTested && distinct ? 'enforced' : 'notEnforced';
    axes[a] = status;
    if (status === 'notEnforced' && readBack.required.includes(a)) {
      const why = !minTested ? 'its minimum is at or below -1000000, so that end is not tested' : !maxTested ? 'its maximum is at or below -1000000, so that end is not tested' : 'its ends cannot be proved distinct to the firmware (fp_EQ), which then skips the axis';
      reasons.push(`${a.toUpperCase()} travel ${rl}..${rh}: ${why}`);
    }
  }
  return Object.freeze({ active: reasons.length === 0, axes: Object.freeze(axes), reasons: Object.freeze(reasons) });
}
