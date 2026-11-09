/**
 * The travel check (OD-24, owner 2026-11-08: "Block when homed, warn when not"; SAFETY H3).
 *
 * Every moving line of the file has a box in machine coordinates (the sanitiser's model, sanitize/extent.ts). Each
 * axis that has soft limits on the board (`tn` ≠ `tm`, as the firmware skips an axis whose two are equal; a side at
 * or below −1 000 000 is off) is checked against them: the first line whose box leaves the travel is the finding.
 * Limits come from the axis groups read for the job, in the units they were printed in (inches under G20, converted
 * for X, Y and Z). What is not known is never passed: an axis whose limits or position were not read is a finding of
 * its own ("could not check").
 *
 * An axis's position is known only when this connection saw a homing cycle home it (homedAxes.ts; OD-23, review S2):
 * then a move past its travel blocks the job. Otherwise (set by hand, before this connection, not homed) its machine
 * coordinate may not be where the travel is, so the same finding asks the user to confirm (C40), as does anything that
 * could not be checked.
 *
 * Pure.
 */
import type { LineExtent } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { axisHomedHere } from './homedAxes.ts';
import { sessionSettings } from './settingWrite.ts';
import type { TravelCheck, TravelFinding } from './travelTypes.ts';
import type { SessionState } from './types.ts';

export type { TravelCheck, TravelFinding } from './travelTypes.ts';

const AXES = ['X', 'Y', 'Z', 'A', 'B', 'C'] as const;
type Axis = (typeof AXES)[number];
const LINEAR: ReadonlySet<Axis> = new Set(['X', 'Y', 'Z']);
const DISABLE_SOFT_LIMIT = -1000000;
/** Room for the model's rounding against the firmware's float32 compare, mm (or degrees). */
const SLACK = 0.001;
/** A limit printed in inches is rounded to 3 decimals: half a thousandth of an inch more room (review N1). */
const INCH_PRINT_SLACK = 0.0005 * 25.4;
/** The firmware's fp_EQ tolerance: `tn` and `tm` closer than this turn the axis's soft limits off (review N1). */
const FP_EQ = 0.00001;

type Limits = { readonly kind: 'none' } | { readonly kind: 'unread' } | { readonly kind: 'set'; readonly min: number | null; readonly max: number | null; readonly slack: number };

function scalar(s: SessionState, token: string): number | undefined {
  const v = s.values[token];
  return v !== undefined && v.status === 0 && typeof v.value === 'number' ? v.value : undefined;
}

/** Each axis's soft limits as read, in mm (degrees on A, B, C). */
export function travelLimits(s: SessionState): Readonly<Record<Axis, Limits>> {
  const dialect = s.dialect;
  const settings = dialect === null ? {} : sessionSettings(dialect.id, s.values);
  const unit = scalar(s, 'unit');
  const out = {} as Record<Axis, Limits>;
  for (const A of AXES) {
    const a = A.toLowerCase();
    if (dialect === null || !isReadAllowed(dialect.id, a)) {
      out[A] = { kind: 'none' };
      continue;
    }
    const tn = settings[`${a}tn`];
    const tm = settings[`${a}tm`];
    const scale = LINEAR.has(A) ? (unit === 1 ? 1 : unit === 0 ? 25.4 : null) : 1;
    if (typeof tn !== 'number' || typeof tm !== 'number' || scale === null) {
      out[A] = { kind: 'unread' };
      continue;
    }
    if (Math.abs(tn - tm) < FP_EQ) {
      out[A] = { kind: 'none' };
      continue;
    }
    const slack = SLACK + (scale === 25.4 ? INCH_PRINT_SLACK : 0);
    out[A] = { kind: 'set', min: tn > DISABLE_SOFT_LIMIT ? tn * scale : null, max: tm > DISABLE_SOFT_LIMIT ? tm * scale : null, slack };
  }
  return out;
}

function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** The axes the lines from `fromLine` on move (or whose position is not known): limits not read matter only for these (review N4). */
function movedAxes(extents: readonly LineExtent[], fromLine: number): ReadonlySet<Axis> {
  const out = new Set<Axis>();
  for (const { line, extent } of extents) {
    if (line < fromLine) continue;
    for (const A of AXES) {
      const r = extent[A];
      if (r === null || r.max - r.min > 1e-9) out.add(A);
    }
  }
  return out;
}

/**
 * The travel check of the file's moving lines from file line `fromLine` on (all of them at Start; the lines from the
 * tool change on at a Resume after a re-zero), against the board's limits as read. A move past travel on an axis this
 * connection saw homed by a cycle blocks (review S2: per axis, homedAxes.ts); on any other axis it asks C40.
 */
export function checkTravel(s: SessionState, extents: readonly LineExtent[], fromLine = 1): TravelCheck {
  const limits = travelLimits(s);
  const moved = movedAxes(extents, fromLine);
  let block: TravelFinding | null = null;
  let outside: TravelFinding | null = null;
  let unknown: TravelFinding | null = null;
  const unread = AXES.filter((A) => limits[A].kind === 'unread' && moved.has(A));
  if (unread.length > 0) unknown = { kind: 'unchecked', line: null, text: `the travel limits of ${unread.join(', ')} were not read` };
  for (const { line, extent } of extents) {
    if (line < fromLine) continue;
    for (const A of AXES) {
      const lim = limits[A];
      if (lim.kind !== 'set') continue;
      const r = extent[A];
      const unitWord = LINEAR.has(A) ? 'mm' : '°';
      if (r === null) {
        unknown ??= { kind: 'unchecked', line, text: `line ${line}: the machine position of ${A} is not known` };
        continue;
      }
      const past = lim.max !== null && r.max > lim.max + lim.slack ? { at: r.max, limit: lim.max } : lim.min !== null && r.min < lim.min - lim.slack ? { at: r.min, limit: lim.min } : null;
      if (past === null) continue;
      const text = `line ${line}: ${A} would reach machine ${fmt(past.at)} ${unitWord}, beyond its travel limit of ${fmt(past.limit)} ${unitWord}`;
      if (axisHomedHere(s, A)) block ??= { kind: 'outside', line, text };
      else outside ??= { kind: 'outside', line, text: `${text}, and the ${A} position was not set by a homing cycle in this connection` };
    }
    if (block !== null) break;
  }
  if (block !== null) return { block, confirm: null };
  return { block: null, confirm: outside ?? unknown };
}
