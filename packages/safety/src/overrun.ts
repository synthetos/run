/**
 * The overrun display (ROADMAP P0-10, SAFETY §4.3 "Overrun display", H1).
 *
 * Pure. Given the moves the host has sent that are not known to have
 * finished (queued in the planner, or still in the RX window), it returns:
 * - `mmUpperBound`: a true upper bound on how far the machine may still
 *   move if the host is lost now — the sum of every queued line's
 *   `boundMm`, arcs included ("machine may continue up to N mm"). It is
 *   never the planner length: rotary degrees are not millimetres, and a
 *   line whose physical travel cannot be bounded (rotary travel with no
 *   known radius) makes it Infinity;
 * - `secondsEstimate`: the modelled time at `v_eff = min(F, vm) × k`, an
 *   estimate and never a bound ("about T s (estimate)").
 *
 * It fails safe: a move whose length or duration is not a finite,
 * non-negative number makes the result Infinity, which the UI shows as
 * "unknown". It never under-reports.
 */
import type { LineMotion } from './sanitize/types.ts';

/** A sent line as the overrun display sees it: `SentLine` satisfies this. */
export interface QueuedLine {
  /** null for a line that does not move. */
  readonly motion: LineMotion | null;
}

export interface OverrunBound {
  readonly mmUpperBound: number;
  readonly secondsEstimate: number;
}

const valid = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;

export function overrunBound(queue: readonly QueuedLine[]): OverrunBound {
  let mm = 0;
  let seconds = 0;
  for (const line of queue) {
    if (line.motion === null) continue;
    const { boundMm, seconds: s } = line.motion;
    mm = valid(boundMm) ? mm + boundMm : Infinity;
    seconds = valid(s) ? seconds + s : Infinity;
  }
  return { mmUpperBound: mm, secondsEstimate: seconds };
}
