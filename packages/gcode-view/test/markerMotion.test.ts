import { describe, expect, it } from 'vitest';
import { MAX_DURATION_MS, MIN_DURATION_MS, SNAP_DISTANCE, clampDuration, nextMotion, positionAt, settled, type MarkerMotion } from '../src/markerMotion.ts';

describe('markerMotion', () => {
  it('interpolates in a straight line from the drawn position to the report', () => {
    const m: MarkerMotion = { from: [0, 0, 0], to: [10, 20, -4], start: 1000, duration: 250 };
    expect(positionAt(m, 1000)).toEqual([0, 0, 0]);
    expect(positionAt(m, 1125)).toEqual([5, 10, -2]);
    expect(positionAt(m, 1250)).toEqual([10, 20, -4]);
    expect(settled(m, 1249)).toBe(false);
    expect(settled(m, 1250)).toBe(true);
  });

  it('never goes past the latest report, and never before the drawn start', () => {
    const m: MarkerMotion = { from: [0, 0, 0], to: [10, 0, 0], start: 0, duration: 200 };
    for (const now of [-50, 0, 37, 199, 200, 201, 5000]) {
      const [x] = positionAt(m, now);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10);
    }
    expect(positionAt(m, 10_000)).toEqual([10, 0, 0]);
  });

  it('clamps the animation to about one report interval, 100 to 400 ms', () => {
    expect(clampDuration(250)).toBe(250);
    expect(clampDuration(20)).toBe(MIN_DURATION_MS);
    expect(clampDuration(9000)).toBe(MAX_DURATION_MS);
    expect(clampDuration(Number.NaN)).toBe(MAX_DURATION_MS);
  });

  it('takes its length from the time since the previous report and starts where the marker is drawn now', () => {
    const first = nextMotion(null, [0, 0, 0], 0, false);
    const second = nextMotion(first, [10, 0, 0], 250, false);
    expect(second).toEqual({ from: [0, 0, 0], to: [10, 0, 0], start: 250, duration: 250 });
    // A report arriving mid-move starts from the drawn point, not the old target.
    const third = nextMotion(second, [20, 0, 0], 375, false);
    expect(third?.from).toEqual([5, 0, 0]);
    expect(third?.to).toEqual([20, 0, 0]);
    expect(third?.duration).toBe(125);
  });

  it('snaps with no previous position, after the marker was hidden, on a long jump and for reduced motion', () => {
    expect(nextMotion(null, [1, 2, 3], 10, false)).toEqual({ from: [1, 2, 3], to: [1, 2, 3], start: 10, duration: 0 });
    const shown = nextMotion(null, [0, 0, 0], 0, false);
    const hidden = nextMotion(shown, null, 100, false);
    expect(hidden).toBeNull();
    expect(nextMotion(hidden, [5, 0, 0], 200, false)?.duration).toBe(0);
    expect(nextMotion(shown, [SNAP_DISTANCE + 1, 0, 0], 250, false)?.duration).toBe(0);
    expect(nextMotion(shown, [SNAP_DISTANCE - 1, 0, 0], 250, false)?.duration).toBe(250);
    expect(nextMotion(shown, [5, 0, 0], 250, true)?.duration).toBe(0);
    expect(positionAt(nextMotion(shown, [5, 0, 0], 250, true) as MarkerMotion, 250)).toEqual([5, 0, 0]);
  });
});
