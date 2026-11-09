/**
 * Place job's margins (owner, 2026-11-09): how far the job's cut stays from each edge of the stock at the planned
 * zero, from the toolpath's cutting moves (feeds and arcs), widened by the tool's radius when it is known. A
 * negative margin is a cut past that edge. Pure. It reads the plan, not the machine: it says nothing about where
 * the board's work zero is.
 */
import { SEGMENT, type SegmentList } from '@synthetos/gcode-view';
import { plannedZero, stockFootprint, type Job } from './jobModel.ts';

export interface CutBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface Margins {
  readonly left: number;
  readonly front: number;
  readonly right: number;
  readonly back: number;
  /** The tool radius included, mm, or null when the tool's size is not known (margins to the tool's centre). */
  readonly radius: number | null;
}

/** The XY box of the cutting moves (feeds and arcs, not uncertain ones), in the path frame; null when nothing cuts. */
export function cutBounds(list: Pick<SegmentList, 'vertices' | 'kinds'>): CutBounds | null {
  const { vertices: v, kinds } = list;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const take = (i: number): void => {
    const x = v[i * 3] as number;
    const y = v[i * 3 + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (let k = 1; k < kinds.length; k++) {
    const kind = kinds[k] as number;
    if ((kind & SEGMENT.UNCERTAIN) !== 0) continue;
    if (kind !== SEGMENT.FEED && kind !== SEGMENT.ARC) continue;
    take(k - 1);
    take(k);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/** The margins at the job's planned zero, with `radius` (mm) added to the cut, or null for an unknown tool. */
export function placeMargins(job: Job, cut: CutBounds, radius: number | null): Margins {
  const z = plannedZero(job);
  const t = job.setup.bed.toMachine;
  const f = stockFootprint(job.setup.stock);
  const r = radius ?? 0;
  const sx0 = f.x0 + t.x;
  const sy0 = f.y0 + t.y;
  return {
    left: cut.minX + z.x - r - sx0,
    front: cut.minY + z.y - r - sy0,
    right: sx0 + f.w - (cut.maxX + z.x + r),
    back: sy0 + f.d - (cut.maxY + z.y + r),
    radius,
  };
}

const mm = (n: number): string => `${n < 0 ? '−' : ''}${String(Math.abs(Number(n.toFixed(1))))} mm`;

/** "Left 5 mm · Front 5 mm · Right 37 mm · Back 12 mm". */
export function marginsText(m: Margins): string {
  return `Left ${mm(m.left)} · Front ${mm(m.front)} · Right ${mm(m.right)} · Back ${mm(m.back)}`;
}

/** The edges the cut goes past, in words ("The cut goes 2 mm past the left edge."), or null when it stays on the stock. */
export function pastEdgesText(m: Margins): string | null {
  const past = (['left', 'front', 'right', 'back'] as const).filter((e) => m[e] < -0.05);
  if (past.length === 0) return null;
  return past.map((e) => `The cut goes ${mm(-m[e])} past the ${e} edge.`).join(' ');
}

/** What the margins include, in words. */
export function radiusText(radius: number | null): string {
  return radius === null ? 'Tool size not known: margins are to the tool’s centre.' : `Includes the tool’s ${mm(radius)} radius.`;
}
