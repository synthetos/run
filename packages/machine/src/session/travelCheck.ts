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
 * The position is known only when this connection saw a homing cycle complete (OD-23): then a move past travel blocks
 * the job. Otherwise (set by hand, before this connection, not homed) machine coordinates may not be where the
 * travel is, so the same finding asks the user to confirm (C40), as does anything that could not be checked.
 *
 * Pure.
 */
import type { LineExtent } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
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

type Limits = { readonly kind: 'none' } | { readonly kind: 'unread' } | { readonly kind: 'set'; readonly min: number | null; readonly max: number | null };

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
    if (Math.abs(tn - tm) < 1e-9) {
      out[A] = { kind: 'none' };
      continue;
    }
    out[A] = { kind: 'set', min: tn > DISABLE_SOFT_LIMIT ? tn * scale : null, max: tm > DISABLE_SOFT_LIMIT ? tm * scale : null };
  }
  return out;
}

/** The machine position is known: a homing cycle this connection saw completed, and nothing since says otherwise. */
export function positionKnown(s: SessionState): boolean {
  return s.notices.position?.by === 'homing' && s.live.home === 1 && !s.overlays.includes('UNKNOWN');
}

function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/**
 * The travel check of the file's moving lines from file line `fromLine` on (all of them at Start; the lines from the
 * tool change on at a Resume after a re-zero), against the board's limits as read.
 */
export function checkTravel(s: SessionState, extents: readonly LineExtent[], fromLine = 1): TravelCheck {
  const limits = travelLimits(s);
  const known = positionKnown(s);
  let outside: TravelFinding | null = null;
  let unknown: TravelFinding | null = null;
  const unread = AXES.filter((A) => limits[A].kind === 'unread');
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
      if (outside !== null) continue;
      if (lim.max !== null && r.max > lim.max + SLACK) outside = { kind: 'outside', line, text: `line ${line}: ${A} would reach machine ${fmt(r.max)} ${unitWord}, beyond its travel limit of ${fmt(lim.max)} ${unitWord}` };
      else if (lim.min !== null && r.min < lim.min - SLACK) outside = { kind: 'outside', line, text: `line ${line}: ${A} would reach machine ${fmt(r.min)} ${unitWord}, beyond its travel limit of ${fmt(lim.min)} ${unitWord}` };
    }
    if (outside !== null && unknown !== null) break;
  }
  if (outside !== null && known) return { block: outside, confirm: null };
  if (outside !== null) return { block: null, confirm: { kind: 'outside', line: outside.line, text: `${outside.text}, and the machine position was not set by a homing cycle in this connection` } };
  return { block: null, confirm: unknown };
}
