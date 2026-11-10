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

export function plannerProfile(r: BoardReading | null): PlannerProfile | null {
  const positive = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;
  if (r === null || r.unit === null || !positive(r.ja) || !positive(r.ct)) return null;
  const k = r.unit === 0 ? MM : 1;
  const axes: Partial<Record<(typeof AXES)[number], PlannerAxis>> = {};
  for (const a of AXES) {
    const vm = r.vm[a];
    const fr = r.fr[a];
    const jm = r.jm[a];
    const jd = r.jd?.[a];
    if (!positive(vm) || !positive(fr) || !positive(jm) || jd === undefined || !(jd >= 0)) return null;
    const spu = r.spu?.[a];
    axes[a] = { vm: vm * k, fr: fr * k, jm: jm * k, jd: jd * k, ...(spu === undefined ? {} : { stepsPerUnit: spu / k }) };
  }
  return { axes: axes as Record<(typeof AXES)[number], PlannerAxis>, ja: r.ja * k, ct: r.ct * k };
}
