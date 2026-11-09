/**
 * Where a line takes the machine (OD-24, sanitize/extent.ts): straight moves by their end points, arcs by the points
 * where their circle turns inside the sweep, unknown positions as unknown.
 */
import { TINYG_EN } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { arcTurningPoints, extendByArc, extentAt } from '../src/sanitize/extent.ts';
import { run } from './sanitizeHelpers.ts';

const AT0 = { X: 0, Y: 0, Z: 0, A: null, B: null, C: null };

describe('line extents', () => {
  it('a straight move and a G28 through its intermediate point', () => {
    const r = run('G21 G90\nG0 X10 Y5\nG1 X2 F600\n', TINYG_EN);
    expect(r.extents.map((e) => [e.line, e.extent.X, e.extent.Y])).toEqual([
      [2, { min: 0, max: 10 }, { min: 0, max: 5 }],
      [3, { min: 2, max: 10 }, { min: 5, max: 5 }],
    ]);
  });

  it('a half circle turns once; a full circle reaches all four sides; an unknown start stays unknown', () => {
    // CCW (negative travel) from the bottom of a radius-5 circle centred 5 above the start: through the right side.
    const half = { radius: 5, c0: 0, c1: 5, theta: Math.PI, travel: -Math.PI, lengthMm: 0, pathMagnitudeMm: 0 };
    // Angles 0, π/2 and π lie in the sweep [0, π]: the end (0, 10), the right side (5, 5) and the start (0, 0).
    expect(arcTurningPoints(half).map(([a, b]) => [Math.round(a * 1e6) / 1e6 + 0, Math.round(b * 1e6) / 1e6 + 0])).toEqual([[0, 10], [5, 5], [0, 0]]);
    const full = { ...half, travel: 2 * Math.PI };
    expect(arcTurningPoints(full)).toHaveLength(4);
    const e = extendByArc(extentAt(AT0), AT0, 'G17', full);
    expect([e.X?.min, e.X?.max, e.Y?.min, e.Y?.max].map((v) => Math.round((v as number) * 1e6) / 1e6)).toEqual([-5, 5, 0, 10]);
    const lost = extendByArc(extentAt({ ...AT0, X: null }), { ...AT0, X: null }, 'G17', full);
    expect(lost.X).toBeNull();
    expect(lost.Y).not.toBeNull();
    expect(extendByArc(extentAt({ ...AT0, Y: null }), { ...AT0, Y: null }, 'G17', full).Y).toBeNull();
  });
});
