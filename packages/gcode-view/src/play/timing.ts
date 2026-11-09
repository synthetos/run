/**
 * How long each move takes in Play preview (owner, 2026-11-09: "play preview should just play the gcode and the
 * movements"; SAFETY H15 and T-S41 amended): a timing provider gives a duration per segment. Today's provider is
 * the programmed speeds: F for feeds and arcs, a stated rapid rate for rapids. It is not the machine's timing:
 * acceleration, junctions and the planner are not modelled, and the page says so while it plays.
 *
 * The seam: a later provider (Analyze's predicted speeds) only has to return its own durations. Pure.
 */
import { SEGMENT, type SegmentList } from '../segments.ts';

/** Rapids when the machine's rapid rate is not known, mm/min. */
export const DEFAULT_RAPID_MM_MIN = 5000;
/** A feed move before any F (the file check flags it), mm/min. */
export const DEFAULT_FEED_MM_MIN = 1000;

export interface TimingProvider {
  /** What the timing is, in plain words, for the page. */
  readonly label: string;
  /** Seconds for the segment ending at each vertex (0 for a break). */
  durations(list: SegmentList): Float32Array;
}

const KIND_MASK = 0x7f;

/** Feeds and arcs at the programmed F of their line (mm/min), rapids at `rapidMmPerMin`. */
export function programmedTiming(lineFeeds: Float32Array, rapidMmPerMin: number = DEFAULT_RAPID_MM_MIN): TimingProvider {
  const rapid = rapidMmPerMin > 0 && Number.isFinite(rapidMmPerMin) ? rapidMmPerMin : DEFAULT_RAPID_MM_MIN;
  return {
    label: 'programmed speeds',
    durations(list) {
      const { vertices: v, kinds, lineToVertex: ltv } = list;
      const out = new Float32Array(kinds.length);
      const lines = ltv.length - 1;
      for (let line = 0; line < lines; line++) {
        const f = lineFeeds[line];
        const feed = f !== undefined && f > 0 && Number.isFinite(f) ? f : DEFAULT_FEED_MM_MIN;
        for (let k = ltv[line] as number; k < (ltv[line + 1] as number); k++) {
          if (k === 0) continue;
          const kind = (kinds[k] as number) & KIND_MASK;
          if (kind === SEGMENT.BREAK) continue;
          const a = (k - 1) * 3;
          const b = k * 3;
          const len = Math.hypot((v[b] as number) - (v[a] as number), (v[b + 1] as number) - (v[a + 1] as number), (v[b + 2] as number) - (v[a + 2] as number));
          out[k] = (len / (kind === SEGMENT.RAPID ? rapid : feed)) * 60;
        }
      }
      return out;
    },
  };
}
