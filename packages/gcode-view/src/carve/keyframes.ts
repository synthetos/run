/**
 * Heightmap snapshots for scrubbing (docs/design/tool-sim.md, slice 2): a
 * copy of the heightmap every N lines, under a memory cap, so scrubbing back
 * restores the nearest snapshot at or before the line and carves forward
 * from there instead of from the start. Pure.
 *
 * The cap is `KEYFRAME_CAP_BYTES` (128 MB) of snapshots per carve. The
 * interval is chosen from the file's length and the grid's size so the
 * snapshots of a whole file fit under it; should they not (a caller with
 * another interval), every other snapshot is dropped. Snapshots are plain
 * copies, not compressed. It does not carve or decide when to restore
 * (carver.ts).
 */

/** Most bytes of snapshots one carve keeps. */
export const KEYFRAME_CAP_BYTES = 128 * 1024 * 1024;
/** Never snapshot more often than every this many lines. */
export const MIN_KEYFRAME_INTERVAL = 50;

export interface Keyframe<M = undefined> {
  /** Lines 0..line-1 are carved into it. */
  readonly line: number;
  readonly z: Float32Array;
  /** What the caller kept with it (the carver: what it had found by then). */
  readonly meta: M;
}

export interface Keyframes<M = undefined> {
  /** Lines between snapshots. */
  readonly interval: number;
  /** Stores a copy of `z` as carved through `line`, with `meta` (a line already held is kept as it is). */
  put(line: number, z: Float32Array, meta: M): void;
  /** The snapshot with the greatest line at or before `line`, or null. */
  atOrBefore(line: number): Keyframe<M> | null;
  clear(): void;
  readonly count: number;
  readonly bytes: number;
}

/** Lines between snapshots so a file of `lines` lines over a grid of `cells` cells stays under `cap` bytes. */
export function keyframeInterval(lines: number, cells: number, cap = KEYFRAME_CAP_BYTES, min = MIN_KEYFRAME_INTERVAL): number {
  const most = Math.max(1, Math.floor(cap / Math.max(1, cells * 4)));
  return Math.max(min, Math.ceil(Math.max(1, lines) / most));
}

export function createKeyframes<M = undefined>(interval: number, cap = KEYFRAME_CAP_BYTES): Keyframes<M> {
  let frames: Keyframe<M>[] = [];
  let bytes = 0;
  /** The index of the last frame at or before `line`, or -1. */
  const find = (line: number): number => {
    let lo = 0;
    let hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((frames[mid] as Keyframe<M>).line <= line) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  };
  return {
    interval,
    put(line, z, meta) {
      const at = find(line);
      if (at >= 0 && (frames[at] as Keyframe<M>).line === line) return;
      while (frames.length > 0 && bytes + z.byteLength > cap) {
        // Thin out: keep every other snapshot, so the ones left still span the file.
        const kept = frames.filter((_, i) => i % 2 === 1);
        bytes = kept.reduce((n, f) => n + f.z.byteLength, 0);
        frames = kept;
      }
      if (z.byteLength > cap) return;
      frames.splice(find(line) + 1, 0, { line, z: z.slice(), meta });
      bytes += z.byteLength;
    },
    atOrBefore(line) {
      const at = find(line);
      return at < 0 ? null : (frames[at] as Keyframe<M>);
    },
    clear() {
      frames = [];
      bytes = 0;
    },
    get count() {
      return frames.length;
    },
    get bytes() {
      return bytes;
    },
  };
}
