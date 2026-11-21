/**
 * The planner model's settings from a board reading (docs/design/ANALYZE.md slice 2): vm, fr, jm and jd per axis,
 * the junction acceleration, the chordal tolerance and the motors' steps per unit, converted to millimetres when
 * the board reads in inches. Null unless every value is known and usable (rates, jerk, junction acceleration and
 * chordal tolerance above zero, junction deviation not below it): a guessed or zero setting would make a
 * precise-looking but wrong time. Read only.
 */
import type { PlannerAxis, PlannerProfile } from '@synthetos/advisor';
import type { BoardReading } from './analysisInputs.ts';

const MM = 25.4;
const AXES = ['X', 'Y', 'Z'] as const;

const positive = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;
const allAxes = (m: Readonly<Partial<Record<(typeof AXES)[number], number>>> | undefined, ok: (v: number | undefined) => boolean): boolean => AXES.every((a) => ok(m?.[a]));

/** The one list of checks: plannerProfile and missingPlannerSettings both read it, so they cannot drift. */
const CHECKS: readonly { readonly name: string; readonly ok: (r: BoardReading) => boolean }[] = [
  { name: 'units', ok: (r) => r.unit !== null },
  { name: 'max speed', ok: (r) => allAxes(r.vm, positive) },
  { name: 'max feed rate', ok: (r) => allAxes(r.fr, positive) },
  { name: 'jerk', ok: (r) => allAxes(r.jm, positive) },
  { name: 'junction deviation', ok: (r) => allAxes(r.jd, (v) => v !== undefined && Number.isFinite(v) && v >= 0) },
  { name: 'junction acceleration', ok: (r) => positive(r.ja) },
  { name: 'chordal tolerance', ok: (r) => positive(r.ct) },
];

/** Plain-word names of the planner settings a reading lacks (empty when complete, or when there is no reading). */
export function missingPlannerSettings(r: BoardReading | null): string[] {
  return r === null ? [] : CHECKS.filter((c) => !c.ok(r)).map((c) => c.name);
}

export function plannerProfile(r: BoardReading | null): PlannerProfile | null {
  if (r === null || r.unit === null || CHECKS.some((c) => !c.ok(r)) || !positive(r.ja) || !positive(r.ct)) return null;
  const k = r.unit === 0 ? MM : 1;
  const axes: Partial<Record<(typeof AXES)[number], PlannerAxis>> = {};
  for (const a of AXES) {
    const vm = r.vm[a];
    const fr = r.fr[a];
    const jm = r.jm[a];
    const jd = r.jd?.[a];
    if (!positive(vm) || !positive(fr) || !positive(jm) || jd === undefined) return null;
    const spu = r.spu?.[a];
    axes[a] = { vm: vm * k, fr: fr * k, jm: jm * k, jd: jd * k, ...(spu === undefined ? {} : { stepsPerUnit: spu / k }) };
  }
  return { axes: axes as Record<(typeof AXES)[number], PlannerAxis>, ja: r.ja * k, ct: r.ct * k };
}
