/** §5.2.5 achievable feed: an estimate from segment lengths, acceleration, jerk and junctions. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ACHIEVABLE_MODEL, predictAchievableFeed, type AchievableFeed, type MotionCaps, type Point3 } from '../src/index.ts';

const MOTION: MotionCaps = { accel: 1000, jerk: 20_000, junctionDeviation: 0.05 };

function value(r: ReturnType<typeof predictAchievableFeed>): AchievableFeed {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

/** A zig-zag pocket: `n` stepovers of `step` mm across a `width` mm pass. */
function zigzag(n: number, width: number, step: number): Point3[] {
  const pts: Point3[] = [[0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const x = i % 2 === 0 ? width : 0;
    pts.push([x, i * step, 0], [x, (i + 1) * step, 0]);
  }
  return pts;
}

describe('predictAchievableFeed', () => {
  it('is labelled as an estimate and names its model', () => {
    const r = value(predictAchievableFeed([[0, 0, 0], [500, 0, 0]], 1500, MOTION));
    expect(r.estimate).toBe(true);
    expect(r.model).toBe(ACHIEVABLE_MODEL);
    expect(r.segments).toBe(1);
    expect(r.lengthMm).toBe(500);
  });

  it('a long straight move averages close to the programmed feed and peaks at it', () => {
    const r = value(predictAchievableFeed([[0, 0, 0], [1000, 0, 0]], 1500, MOTION));
    expect(r.peakFeed).toBeCloseTo(1500, 6);
    expect(r.fraction).toBeGreaterThan(0.98);
    expect(r.fraction).toBeLessThanOrEqual(1);
    expect(r.seconds).toBeGreaterThan(1000 / 25);
  });

  it('short stepovers with square corners fall well short of F ("1.3 mm stepovers peak below F")', () => {
    const r = value(predictAchievableFeed(zigzag(40, 1.3, 1.3), 1500, MOTION));
    expect(r.peakFeed).toBeLessThan(1500);
    expect(r.fraction).toBeLessThan(0.7);
    const longer = value(predictAchievableFeed(zigzag(40, 60, 1.3), 1500, MOTION));
    expect(longer.fraction).toBeGreaterThan(r.fraction);
  });

  it('straight continuations are not junction-limited; a reversal stops', () => {
    const straight = value(predictAchievableFeed([[0, 0, 0], [5, 0, 0], [10, 0, 0], [15, 0, 0]], 1500, MOTION));
    const single = value(predictAchievableFeed([[0, 0, 0], [15, 0, 0]], 1500, MOTION));
    expect(straight.seconds).toBeCloseTo(single.seconds, 6);
    const reversal = value(predictAchievableFeed([[0, 0, 0], [15, 0, 0], [0, 0, 0]], 1500, MOTION));
    expect(reversal.seconds).toBeCloseTo(2 * single.seconds, 6);
  });

  it('a larger junction deviation or acceleration never makes it slower', () => {
    const path = zigzag(20, 10, 2);
    const base = value(predictAchievableFeed(path, 3000, MOTION));
    expect(value(predictAchievableFeed(path, 3000, { ...MOTION, junctionDeviation: 0.2 })).seconds).toBeLessThanOrEqual(base.seconds + 1e-9);
    expect(value(predictAchievableFeed(path, 3000, { ...MOTION, accel: 3000 })).seconds).toBeLessThanOrEqual(base.seconds + 1e-9);
  });

  it('models constant-acceleration ramps when there is no jerk value, and S-curves with an acceleration phase', () => {
    const path: Point3[] = [[0, 0, 0], [100, 0, 0]];
    const trapezoid = value(predictAchievableFeed(path, 6000, { accel: 500, junctionDeviation: 0.05 }));
    // v = 100 mm/s, ramp 0.2 s and 10 mm each way, 80 mm cruise at 100 mm/s.
    expect(trapezoid.seconds).toBeCloseTo(0.2 + 0.2 + 0.8, 6);
    const lowJerk = value(predictAchievableFeed(path, 6000, { accel: 500, jerk: 1000, junctionDeviation: 0.05 }));
    const highJerk = value(predictAchievableFeed(path, 6000, { accel: 500, jerk: 1e7, junctionDeviation: 0.05 }));
    expect(lowJerk.seconds).toBeGreaterThan(highJerk.seconds);
    expect(highJerk.seconds).toBeCloseTo(trapezoid.seconds, 3);
  });

  it('drops zero-length steps', () => {
    const r = value(predictAchievableFeed([[0, 0, 0], [0, 0, 0], [10, 0, 0], [10, 0, 0]], 1500, MOTION));
    expect(r.segments).toBe(1);
  });

  it('refuses inputs it cannot model', () => {
    expect(predictAchievableFeed([[0, 0, 0], [10, 0, 0]], 0, MOTION)).toMatchObject({ ok: false, reason: expect.stringMatching(/programmed feed/) });
    expect(predictAchievableFeed([[0, 0, 0], [10, 0, 0]], Number.NaN, MOTION).ok).toBe(false);
    expect(predictAchievableFeed([[0, 0, 0], [10, 0, 0]], 1500, { ...MOTION, accel: 0 }).ok).toBe(false);
    expect(predictAchievableFeed([[0, 0, 0], [10, 0, 0]], 1500, { ...MOTION, jerk: -1 }).ok).toBe(false);
    expect(predictAchievableFeed([[0, 0, 0], [10, 0, 0]], 1500, { ...MOTION, junctionDeviation: -0.1 }).ok).toBe(false);
    expect(predictAchievableFeed([[0, 0, 0], [10, 0, 0]], 1500, { ...MOTION, junctionDeviation: Number.NaN }).ok).toBe(false);
    expect(predictAchievableFeed([[0, 0, 0], [10, Number.NaN, 0]], 1500, MOTION).ok).toBe(false);
    expect(predictAchievableFeed([[0, 0, 0], [10, 0] as unknown as Point3], 1500, MOTION).ok).toBe(false);
    expect(predictAchievableFeed([[0, 0, 0]], 1500, MOTION)).toMatchObject({ ok: false, reason: 'The path has no length.' });
    expect(predictAchievableFeed([], 1500, MOTION).ok).toBe(false);
  });

  it('never predicts more than the programmed feed, and is deterministic (fast-check)', () => {
    const point = fc.tuple(fc.double({ min: -200, max: 200, noNaN: true }), fc.double({ min: -200, max: 200, noNaN: true }), fc.double({ min: -20, max: 0, noNaN: true }));
    fc.assert(
      fc.property(fc.array(point, { minLength: 2, maxLength: 40 }), fc.double({ min: 10, max: 10_000, noNaN: true }), (path, feed) => {
        const r = predictAchievableFeed(path as Point3[], feed, MOTION);
        if (!r.ok) return;
        expect(r.value.averageFeed).toBeLessThanOrEqual(feed * (1 + 1e-9));
        expect(r.value.peakFeed).toBeLessThanOrEqual(feed * (1 + 1e-9));
        expect(r.value.averageFeed).toBeGreaterThan(0);
        expect(predictAchievableFeed(path as Point3[], feed, MOTION)).toEqual(r);
      }),
      { numRuns: 300 },
    );
  });
});
