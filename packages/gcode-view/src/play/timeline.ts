/**
 * Play preview's timeline: the time the tool reaches each vertex, from a timing provider's durations, and where
 * the tool is at a given time (on the segment it is crossing, interpolated). Pure.
 *
 * It does not run a clock (player.ts) or draw.
 */
import type { SegmentList, Vec3 } from '../segments.ts';

export interface Timeline {
  /** Seconds at which the tool reaches each vertex (vertex 0 at 0). */
  readonly at: Float64Array;
  /** The whole file's seconds. */
  readonly total: number;
}

export interface PlayPoint {
  /** The tool's position, path frame. */
  readonly pos: Vec3;
  /** The list line whose move is under way (or the last line, at the end). */
  readonly line: number;
  /** List lines completed before it. */
  readonly completed: number;
}

export function buildTimeline(durations: Float32Array): Timeline {
  const at = new Float64Array(durations.length);
  let t = 0;
  for (let k = 1; k < durations.length; k++) {
    t += durations[k] as number;
    at[k] = t;
  }
  return { at, total: t };
}

/** The line that holds vertex `v` (the line whose segments end at it). */
function lineOf(ltv: Uint32Array, v: number): number {
  let lo = 0;
  let hi = ltv.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((ltv[mid] as number) <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The time the tool starts list line `line` (the end of the previous line's last move). */
export function lineStartTime(list: Pick<SegmentList, 'lineToVertex'>, tl: Timeline, line: number): number {
  const ltv = list.lineToVertex;
  const l = Math.max(0, Math.min(line, ltv.length - 1));
  const first = ltv[l] as number;
  return first === 0 ? 0 : (tl.at[Math.min(first - 1, tl.at.length - 1)] ?? 0);
}

/** Where the tool is at time `t` (clamped to the file), and which line it is on. */
export function pointAt(list: Pick<SegmentList, 'vertices' | 'lineToVertex'>, tl: Timeline, t: number): PlayPoint | null {
  const at = tl.at;
  const n = at.length;
  if (n === 0) return null;
  const time = Math.max(0, Math.min(t, tl.total));
  // The first vertex reached at or after `time`.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((at[mid] as number) < time) lo = mid + 1;
    else hi = mid;
  }
  const v = lo;
  const t1 = at[v] as number;
  const t0 = v > 0 ? (at[v - 1] as number) : t1;
  const f = t1 > t0 ? (time - t0) / (t1 - t0) : 1;
  const p = list.vertices;
  const a = Math.max(0, v - 1) * 3;
  const b = v * 3;
  const pos: Vec3 = [(p[a] as number) + ((p[b] as number) - (p[a] as number)) * f, (p[a + 1] as number) + ((p[b + 1] as number) - (p[a + 1] as number)) * f, (p[a + 2] as number) + ((p[b + 2] as number) - (p[a + 2] as number)) * f];
  const ltv = list.lineToVertex;
  const line = lineOf(ltv, v);
  // A line is completed once the tool has reached its last vertex.
  const done = time >= tl.total ? ltv.length - 1 : line + (v === (ltv[line + 1] as number) - 1 && f >= 1 ? 1 : 0);
  return { pos, line, completed: done };
}
