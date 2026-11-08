/**
 * The carve of one file into one stock (docs/design/tool-sim.md, slice 2):
 * walks the segment list line by line, sweeping each move with the tool
 * active on that line, up to a target line, in small steps a worker can
 * interleave with messages. Scrubbing back restores the nearest keyframe at
 * or before the target and carves forward; scrubbing forward carries on.
 * Pure apart from its own state.
 *
 * Tools come per tool-change point (`CarveTools`): a line whose tool is null
 * (not in the tool table, an M6 with no T, before the first M6) carves
 * nothing, never a guessed size. Moves marked uncertain (the position may
 * not be what the program intends) carve nothing either. Rapids carve: a
 * rapid into the stock cuts too.
 *
 * It also notes where the cut goes below the stock's bottom (belowStock.ts),
 * kept with each keyframe so a restore brings back what was found by then.
 *
 * It does not pick tools from the tool table (the page does), talk to a
 * worker (worker.ts) or draw (mesh.ts).
 */
import { SEGMENT, type SegmentList } from '../segments.ts';
import type { ToolShape } from '../toolProfile.ts';
import { createHeightmap, fullRect, unionRect, type CellRect, type GridSpec, type Heightmap } from './heightmap.ts';
import { createKeyframes, keyframeInterval, KEYFRAME_CAP_BYTES, type Keyframes } from './keyframes.ts';
import { emptyDirty, isDirty, sweepSegment, type Dirty } from './sweep.ts';
import { noteBelow, type BelowStock } from './belowStock.ts';

/** The tool at each change point, by list line: lines from `starts[k]` on use `shapes[k]`; before `starts[0]`, none. */
export interface CarveTools {
  /** First list line (0-based) of each tool, ascending. */
  readonly starts: Uint32Array;
  readonly shapes: readonly (ToolShape | null)[];
}

export interface CarveStep {
  /** The cells changed by this step (or by a restore before it), or null. */
  readonly dirty: CellRect | null;
  /** Lines 0..through-1 are carved. */
  readonly through: number;
  readonly done: boolean;
}

export interface Carver {
  readonly heightmap: Heightmap;
  readonly through: number;
  readonly target: number;
  /** The lowest top Z in the heightmap (the top when nothing is cut). */
  readonly lowest: number;
  /** Where the lines carved so far go below the stock, or null. */
  readonly below: BelowStock | null;
  readonly keyframes: Keyframes<CarverMeta>;
  /** Sets the target (lines 0..target-1 carved). When the carve is already past it, restores a keyframe: the whole grid is dirty. */
  seek(target: number): CellRect | null;
  /** Carves at most `budget` moves toward the target. */
  step(budget: number): CarveStep;
}

export interface CarverOptions {
  readonly keyframeCapBytes?: number;
}

const KIND_MASK = 0x7f;

/** What the carver keeps with each keyframe. */
interface CarverMeta {
  readonly below: BelowStock | null;
}

export function createCarver(list: SegmentList, spec: GridSpec, tools: CarveTools, options: CarverOptions = {}): Carver {
  const heightmap = createHeightmap(spec);
  const z = heightmap.z;
  const initial = z.slice();
  const { vertices: vx, kinds, lineToVertex: ltv } = list;
  const lines = ltv.length - 1;
  const cap = options.keyframeCapBytes ?? KEYFRAME_CAP_BYTES;
  const keyframes = createKeyframes<CarverMeta>(keyframeInterval(lines, z.length, cap), cap);
  const bottom = Math.fround(spec.bottom);
  let through = 0;
  let v = ltv[0] ?? 0;
  let target = 0;
  let span = -1;
  let lowest = spec.top;
  let below: BelowStock | null = null;
  let pending: CellRect | null = null;
  const dirty: Dirty = emptyDirty();
  /** The cells the line being carved has changed so far: its lowest says how deep that line went. */
  const line: Dirty = emptyDirty();

  /** Folds the current line's changes into the step's. */
  const mergeLine = (): void => {
    if (!isDirty(line)) return;
    dirty.x0 = Math.min(dirty.x0, line.x0);
    dirty.y0 = Math.min(dirty.y0, line.y0);
    dirty.x1 = Math.max(dirty.x1, line.x1);
    dirty.y1 = Math.max(dirty.y1, line.y1);
    dirty.lowest = Math.min(dirty.lowest, line.lowest);
  };

  /** The tool index in force at a line: the last start at or before it, or -1. */
  const spanAt = (line: number): number => {
    let lo = 0;
    let hi = tools.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((tools.starts[mid] as number) <= line) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  };

  const shapeAt = (line: number): ToolShape | null => {
    while (span + 1 < tools.starts.length && (tools.starts[span + 1] as number) <= line) span++;
    return span < 0 ? null : (tools.shapes[span] ?? null);
  };

  const lowestOf = (data: Float32Array): number => {
    let m = spec.top;
    for (let k = 0; k < data.length; k++) {
      const h = data[k] as number;
      if (h < m && h > -1e29) m = h;
    }
    return m;
  };

  function restore(to: number): void {
    const kf = keyframes.atOrBefore(to);
    z.set(kf === null ? initial : kf.z);
    through = kf === null ? 0 : kf.line;
    v = ltv[through] as number;
    span = spanAt(through);
    lowest = lowestOf(z);
    below = kf === null ? null : kf.meta.below;
    Object.assign(line, emptyDirty());
    pending = fullRect(spec);
  }

  return {
    heightmap,
    keyframes,
    get through() {
      return through;
    },
    get target() {
      return target;
    },
    get lowest() {
      return lowest;
    },
    get below() {
      return below;
    },
    seek(next) {
      target = Math.max(0, Math.min(lines, Math.floor(next)));
      // Past the target: whole lines beyond it, or part of the target line itself.
      if (through > target || (through === target && v > (ltv[through] as number))) restore(target);
      return pending;
    },
    step(budget) {
      Object.assign(dirty, emptyDirty());
      let n = 0;
      while (through < target && n < budget) {
        const end = ltv[through + 1] as number;
        const shape = shapeAt(through);
        if (shape === null) {
          v = end;
          n++;
        }
        for (; v < end && n < budget; v++, n++) {
          if (v === 0) continue;
          const k = kinds[v] as number;
          const kind = k & KIND_MASK;
          if (kind === SEGMENT.BREAK || (k & SEGMENT.UNCERTAIN) !== 0) continue;
          const a = (v - 1) * 3;
          const b = v * 3;
          sweepSegment(heightmap, vx[a] as number, vx[a + 1] as number, vx[a + 2] as number, vx[b] as number, vx[b + 1] as number, vx[b + 2] as number, shape as ToolShape, line);
        }
        if (v >= end) {
          below = noteBelow(below, through, line.lowest, bottom);
          mergeLine();
          Object.assign(line, emptyDirty());
          through++;
          if (through % keyframes.interval === 0) keyframes.put(through, z, { below });
        }
      }
      // A line part way through: its cells so far go out with this step; its depth is noted when it finishes.
      mergeLine();
      line.x0 = line.y0 = Infinity;
      line.x1 = line.y1 = -Infinity;
      if (dirty.lowest < lowest) lowest = dirty.lowest;
      const swept = isDirty(dirty) ? { x: dirty.x0, y: dirty.y0, w: dirty.x1 - dirty.x0 + 1, h: dirty.y1 - dirty.y0 + 1 } : null;
      const out = unionRect(pending, swept);
      pending = null;
      return { dirty: out, through, done: through >= target };
    },
  };
}
