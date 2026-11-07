/**
 * Probe Z: the live touch test (SAFETY §4.5c "Touch test", H90 mitigation 2; T-S129). Pure. The marks fill in
 * from readings of the probe input only, in order: inactive, then active (the owner touches the plate to the
 * tool), then inactive again. It proves the lead at that moment only.
 */
import { PROBE_LIMITS } from './limits.ts';
import type { ProbeInputReading, ProbeTouch } from './types.ts';

/** No progress for this long is "the input didn't change" (the UI design's 60 s; the pass itself lapses after 2 minutes). */
export const TOUCH_IDLE_MS = 60_000;

/** The next marks after one reading. The same object when nothing changed (so progress can be told from none). */
export function touchStep(touch: ProbeTouch, reading: ProbeInputReading): ProbeTouch {
  if (touch.problem !== null || reading === null || reading === 'disabled' || touchPassed(touch)) return touch;
  if (!touch.sawClear) return reading === 'clear' ? { ...touch, sawClear: true } : { ...touch, problem: 'startedTouching' };
  if (!touch.sawTouching) return reading === 'touching' ? { ...touch, sawTouching: true } : touch;
  return reading === 'clear' ? { ...touch, sawReleased: true } : touch;
}

export function touchPassed(touch: ProbeTouch): boolean {
  return touch.sawClear && touch.sawTouching && touch.sawReleased && touch.problem === null;
}

/** A time problem at `at` of a touch test that has none yet: no progress for `TOUCH_IDLE_MS` before the pass, or the pass older than 2 minutes. */
export function touchTimeProblem(touchAt: number, passedAt: number | null, at: number): 'noChange' | 'timedOut' | null {
  if (passedAt !== null) return at - passedAt > PROBE_LIMITS.touchValidMs ? 'timedOut' : null;
  return at - touchAt > TOUCH_IDLE_MS ? 'noChange' : null;
}

/** The reading of `in<n>`: 1 active, 0 inactive, -1 disabled; anything else is no reading. */
export function readingOf(value: unknown): ProbeInputReading {
  if (value === 1) return 'touching';
  if (value === 0) return 'clear';
  if (value === -1) return 'disabled';
  return null;
}
