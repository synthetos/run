/**
 * Where the tool is inside the line it is on, for the live carve (owner, 2026-11-09: "when removing the stock it
 * lags; the bit passes through it and then a few seconds later it disappears"). A long line used to show only
 * once it finished; now the carve can follow the tool part way along it.
 *
 * A tip is a point on one segment: `vertex` is the segment's end (the segment runs from vertex - 1 to vertex)
 * and `t` how far along it, 0..1. Lines before it and the segments of its line before it count as carved.
 * Play knows its tip exactly (its timeline); a running job gives a position, which `tipOnLine` places on the
 * nearest segment of the line the board reports executing. Pure.
 */
import { SEGMENT, type SegmentList, type Vec3 } from '../segments.ts';

export interface CarveTip {
  /** The segment's end vertex (the segment runs from `vertex - 1` to `vertex`). */
  readonly vertex: number;
  /** How far along the segment, 0..1. */
  readonly t: number;
}

/** A position along the file: whole segments before `vertex`, and `t` of segment `vertex`. Ordered. */
export function tipProgress(tip: CarveTip): number {
  return tip.vertex + tip.t;
}

export function sameTip(a: CarveTip | null, b: CarveTip | null): boolean {
  if (a === null || b === null) return a === b;
  return a.vertex === b.vertex && a.t === b.t;
}

/** True when the tip's segment belongs to list line `line`. */
export function tipInLine(list: Pick<SegmentList, 'lineToVertex'>, line: number, tip: CarveTip): boolean {
  const ltv = list.lineToVertex;
  const start = ltv[line];
  const end = ltv[line + 1];
  return start !== undefined && end !== undefined && tip.vertex >= Math.max(1, start) && tip.vertex < end && tip.t >= 0 && tip.t <= 1;
}

/** How far from the line a reported position may be and still count as on it, mm (report rounding, a little lag). */
export const TIP_TOLERANCE_MM = 1;

/**
 * The point on list line `line` nearest `pos` (path frame), as a tip, or null when the line has no segment or
 * the position is farther than `tolerance` from all of them. Segments before `from` (a tip already carved to)
 * are not considered, so the tip never goes back along a line that crosses itself.
 */
export function tipOnLine(list: Pick<SegmentList, 'vertices' | 'kinds' | 'lineToVertex'>, line: number, pos: Vec3, from: CarveTip | null = null, tolerance = TIP_TOLERANCE_MM): CarveTip | null {
  const ltv = list.lineToVertex;
  const start = ltv[line];
  const end = ltv[line + 1];
  if (start === undefined || end === undefined) return null;
  const p = list.vertices;
  const first = Math.max(1, start, from !== null && tipInLine(list, line, from) ? from.vertex : 0);
  let best: CarveTip | null = null;
  let bestD = tolerance * tolerance;
  for (let v = first; v < end; v++) {
    if (((list.kinds[v] as number) & 0x7f) === SEGMENT.BREAK) continue;
    const a = (v - 1) * 3;
    const b = v * 3;
    const ax = p[a] as number, ay = p[a + 1] as number, az = p[a + 2] as number;
    const dx = (p[b] as number) - ax, dy = (p[b + 1] as number) - ay, dz = (p[b + 2] as number) - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = len2 < 1e-12 ? 1 : ((pos[0] - ax) * dx + (pos[1] - ay) * dy + (pos[2] - az) * dz) / len2;
    t = Math.min(1, Math.max(0, t));
    if (from !== null && v === from.vertex && t < from.t) t = from.t;
    const ex = ax + t * dx - pos[0], ey = ay + t * dy - pos[1], ez = az + t * dz - pos[2];
    const d = ex * ex + ey * ey + ez * ez;
    // Later segments win ties: the tool is past a shared vertex, not before it.
    if (d <= bestD) {
      bestD = d;
      best = { vertex: v, t };
    }
  }
  return best;
}
