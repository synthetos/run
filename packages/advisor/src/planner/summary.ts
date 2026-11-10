/**
 * Where the planned time goes (docs/design/ANALYZE.md slice 2): speeding up and slowing down against cruising, and
 * the firmware's own tags for why (moves too short to reach the feed, corners, exact stops, axis rates). The tags
 * overlap, so the shares are "time carrying this tag", never seconds a change would save. Pure.
 */
import type { Simulation } from './simulate.ts';
import type { Cause, PlanResult } from './types.ts';

export interface TimeShares {
  /** Seconds of motion. */
  readonly motionS: number;
  /** Seconds speeding up or slowing down (heads and tails). */
  readonly changingS: number;
  /** Seconds at cruise (bodies). */
  readonly cruisingS: number;
  /** Seconds of the speed-change time on blocks with each tag (overlapping). */
  readonly changingBy: Readonly<Record<Cause, number>>;
}

/** A plan in a few numbers, small enough to send to the page. */
export type Estimate =
  | { readonly ok: true; readonly seconds: number; readonly motionS: number; readonly dwellS: number; readonly shares: TimeShares }
  | { readonly ok: false; readonly reason: string };

export function timeShares(result: PlanResult): TimeShares {
  const changingBy: Record<Cause, number> = { axis_cap: 0, junction: 0, exact_stop: 0, short: 0, min_segment: 0 };
  let changing = 0;
  let cruising = 0;
  for (const b of result.blocks) {
    const c = b.headS + b.tailS;
    changing += c;
    cruising += b.bodyS;
    for (const cause of b.causes) changingBy[cause] += c;
  }
  return { motionS: result.motionS, changingS: changing, cruisingS: cruising, changingBy };
}

export function estimateOf(sim: Simulation): Estimate {
  if (!sim.ok) return sim;
  if (!Number.isFinite(sim.result.seconds)) return { ok: false, reason: 'the machine settings give no finite time' };
  return { ok: true, seconds: sim.result.seconds, motionS: sim.result.motionS, dwellS: sim.result.dwellS, shares: timeShares(sim.result) };
}
