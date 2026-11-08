/**
 * The view frames the job, not the bed (first-time walk 2026-11-08, C19), and the wheel zooms toward the cursor.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fitOrbit, framedBox, jobSolidsBox, project, viewProjection, zoomToward, type SceneSolid } from '../src/index.ts';

const GREY = [0.5, 0.5, 0.5, 1] as const;
const bed: SceneSolid = { kind: 'box', min: [0, 0, -19], max: [750, 750, 0], color: GREY, tag: 'bed' };
const stock: SceneSolid = { kind: 'box', min: [70, 60, 0], max: [250, 180, 6.35], color: GREY, tag: 'stock' };
const clamp: SceneSolid = { kind: 'box', min: [60, 50, 6.35], max: [80, 70, 12], color: GREY, tag: 'clamp' };
const all = { min: [0, 0, -19], max: [750, 750, 12] } as const;

describe('framedBox (C19)', () => {
  it('frames the stock and clamps with the path, never the bed', () => {
    const path = { min: [75, 65, -2], max: [240, 170, 5] } as const;
    expect(jobSolidsBox({ solids: [bed, stock, clamp], rings: [] })).toEqual({ min: [60, 50, 0], max: [250, 180, 12] });
    expect(framedBox(path, { solids: [bed, stock, clamp], rings: [] }, all)).toEqual({ min: [60, 50, -2], max: [250, 180, 12] });
  });
  it('falls back to everything drawn with neither a path nor a job solid', () => {
    expect(framedBox(null, { solids: [bed], rings: [] }, all)).toEqual(all);
    expect(framedBox(null, null, null)).toBeNull();
  });
  it('a path alone is framed on its own', () => {
    const path = { min: [0, 0, 0], max: [10, 10, 1] } as const;
    expect(framedBox(path, null, all)).toEqual(path);
  });
});

describe('zoomToward (C19)', () => {
  it('keeps the point under the cursor where it was (property)', () => {
    const o = fitOrbit({ min: [0, 0, 0], max: [200, 120, 10] }, undefined, 1.6);
    const n = fc.double({ min: -0.9, max: 0.9, noNaN: true });
    fc.assert(fc.property(n, n, fc.double({ min: 0.3, max: 3, noNaN: true }), (nx, ny, f) => {
      // The point of the target's view plane under the cursor, before and after.
      const halfH = o.distance * Math.tan(Math.PI / 8);
      const right = [-Math.sin(o.azimuth), Math.cos(o.azimuth), 0];
      const up = [-Math.sin(o.elevation) * Math.cos(o.azimuth), -Math.sin(o.elevation) * Math.sin(o.azimuth), Math.cos(o.elevation)];
      const pt = [0, 1, 2].map((i) => (o.target[i] as number) + (right[i] as number) * nx * halfH * 1.6 + (up[i] as number) * ny * halfH) as [number, number, number];
      const z = zoomToward(o, f, nx, ny, 1.6);
      const p = project(viewProjection(z, 1.6), pt);
      expect(p[0]).toBeCloseTo(nx, 4);
      expect(p[1]).toBeCloseTo(ny, 4);
      expect(z.distance).toBeCloseTo(o.distance * f, 6);
    }));
  });
  it('at the centre it is a plain zoom', () => {
    const o = fitOrbit({ min: [0, 0, 0], max: [10, 10, 10] });
    const z = zoomToward(o, 0.5, 0, 0, 1);
    expect(z.target).toEqual(o.target);
    expect(z.distance).toBeCloseTo(o.distance / 2);
  });
});
