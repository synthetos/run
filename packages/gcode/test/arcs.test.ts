import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TINYG_EN } from '@synthetos/protocol';
import { modelArc, type ArcModel } from '@synthetos/safety';
import { arcBox, arcPoint, arcSegments, tessellateArc } from '../src/index.ts';
import { analyse, start } from './helpers.ts';

const arcArb = fc
  .record({
    c0: fc.double({ min: -200, max: 200, noNaN: true }),
    c1: fc.double({ min: -200, max: 200, noNaN: true }),
    travelFrac: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
    turns: fc.integer({ min: 0, max: 2 }),
    clockwise: fc.boolean(),
  })
  .filter((r) => Math.hypot(r.c0, r.c1) > 0.2)
  .map((r): ArcModel | null => {
    const radius = Math.hypot(r.c0, r.c1);
    const theta = Math.atan2(-r.c0, -r.c1);
    const sweep = (r.travelFrac + r.turns) * 2 * Math.PI;
    const travel = r.clockwise ? sweep : -sweep;
    const [d0, d1] = [r.c0 + radius * Math.sin(theta + travel), r.c1 + radius * Math.cos(theta + travel)];
    const m = modelArc({
      clockwise: r.clockwise,
      d0,
      d1,
      dLin: 0,
      centre: { c0: r.c0, c1: r.c1 },
      radius: null,
      noPlaneEndpoint: false,
      rotations: r.turns,
      coincidence: 'position',
      magnitudeMm: 0,
      startUncertaintyMm: 0,
    });
    return m.kind === 'ok' ? m.arc : null;
  })
  .filter((a): a is ArcModel => a !== null);

describe('arcs', () => {
  it('every chord stays within the chord tolerance of the true arc', () => {
    fc.assert(
      fc.property(arcArb, fc.constantFrom(0.01, 0.1, 1), (arc, tol) => {
        const pts = [[0, 0, 0] as const, ...tessellateArc(arc, arcSegments(arc, tol))];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          // Every vertex is on the circle, and the chord's midpoint is within tol of it.
          expect(Math.abs(Math.hypot(b[0] - arc.c0, b[1] - arc.c1) - arc.radius)).toBeLessThan(1e-9 * (1 + arc.radius));
          const mid = Math.hypot((a[0] + b[0]) / 2 - arc.c0, (a[1] + b[1]) / 2 - arc.c1);
          expect(arc.radius - mid).toBeLessThanOrEqual(tol + 1e-9);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('the exact box contains every tessellated point and touches the arc', () => {
    fc.assert(
      fc.property(arcArb, (arc) => {
        const box = arcBox(arc);
        const pts = tessellateArc(arc, arcSegments(arc, 0.01));
        // One assertion per property run (per-point expect() calls made this test slow enough to time out cold).
        const outside = pts.filter(
          ([p0, p1]) => p0 < box.min[0] - 1e-9 || p0 > box.max[0] + 1e-9 || p1 < box.min[1] - 1e-9 || p1 > box.max[1] + 1e-9,
        );
        expect(outside).toEqual([]);
        // Tight on all four sides: the box is no larger than the tessellation (start point included) by more than the chord tolerance.
        let [x0, x1, y0, y1] = [0, 0, 0, 0];
        for (const [p0, p1] of pts) {
          x0 = Math.min(x0, p0);
          x1 = Math.max(x1, p0);
          y0 = Math.min(y0, p1);
          y1 = Math.max(y1, p1);
        }
        const slack = [x0 - box.min[0], box.max[0] - x1, y0 - box.min[1], box.max[1] - y1];
        expect(slack.every((d) => d <= 0.01 + 1e-9)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('a full circle\'s box is the circle\'s square', () => {
    const arc = { radius: 5, c0: 5, c1: 0, theta: Math.atan2(-5, 0), travel: 2 * Math.PI, lengthMm: 0, pathMagnitudeMm: 0 };
    expect(arcBox(arc)).toEqual({ min: [0, expect.closeTo(-5, 9)], max: [10, expect.closeTo(5, 9)] });
    expect(arcPoint(arc, arc.theta).map((v) => Math.abs(v) < 1e-12)).toEqual([true, true]);
    expect(arcSegments({ radius: 0.001, travel: 1 }, 0.01)).toBe(1);
  });

  it('translating a file translates its bounds exactly', () => {
    const text = 'G21 G91\nG1 X10 Y5 F500\nG2 X10 Y0 I5 J0\nG3 X-4 Y-4 R4\nG1 Z-2';
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: -50, max: 50 }), (x, y, z) => {
        const base = analyse(text, TINYG_EN).analysis;
        const moved = analyse(text, TINYG_EN, { start: start({ X: x, Y: y, Z: z }) }).analysis;
        expect(moved.blocked).toBe(false);
        [x, y, z].forEach((d, k) => {
          expect(moved.bounds!.min[k]).toBeCloseTo(base.bounds!.min[k]! + d, 9);
          expect(moved.bounds!.max[k]).toBeCloseTo(base.bounds!.max[k]! + d, 9);
        });
      }),
      { numRuns: 50 },
    );
  });
});
