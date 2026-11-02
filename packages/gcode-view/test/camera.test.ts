import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fitOrbit, project, rotate, viewProjection, zoom } from '../src/index.ts';

describe('orbit camera', () => {
  it('fitting a box puts its centre at the middle of the view and every corner inside it (property)', () => {
    const coord = fc.double({ min: -2000, max: 2000, noNaN: true });
    fc.assert(fc.property(coord, coord, coord, fc.double({ min: 1, max: 1500, noNaN: true }), fc.double({ min: 0.5, max: 2.5, noNaN: true }), (x, y, z, size, aspect) => {
      const box = { min: [x, y, z] as const, max: [x + size, y + size * 0.6, z + size * 0.2] as const };
      const o = fitOrbit(box);
      const m = viewProjection(o, aspect);
      const c = project(m, o.target);
      expect(Math.abs(c[0])).toBeLessThan(1e-3);
      expect(Math.abs(c[1])).toBeLessThan(1e-3);
      for (const cx of [box.min[0], box.max[0]]) for (const cy of [box.min[1], box.max[1]]) for (const cz of [box.min[2], box.max[2]]) {
        const p = project(m, [cx, cy, cz]);
        // The fit converges to within about 0.1 % of the viewport. Tiny boxes far from the origin land a few 1e-4 past 0.8.
        expect(Math.abs(p[0])).toBeLessThanOrEqual(1 / Math.min(1, aspect) + 1e-6);
        expect(Math.abs(p[1])).toBeLessThanOrEqual(1 + 1e-6);
      }
    }));
  });

  it('with the canvas shape, the fit is tight: every corner inside the fill, and the box reaching it (property)', () => {
    const coord = fc.double({ min: -2000, max: 2000, noNaN: true });
    fc.assert(fc.property(coord, coord, fc.double({ min: 1, max: 1500, noNaN: true }), fc.double({ min: 0.5, max: 3, noNaN: true }), (x, y, size, aspect) => {
      const box = { min: [x, y, -size * 0.05] as const, max: [x + size, y + size * 0.7, 0] as const };
      const o = fitOrbit(box, Math.PI / 4, aspect, 0.8);
      const m = viewProjection(o, aspect);
      let reach = 0;
      for (const cx of [box.min[0], box.max[0]]) for (const cy of [box.min[1], box.max[1]]) for (const cz of [box.min[2], box.max[2]]) {
        const p = project(m, [cx, cy, cz]);
        expect(Math.abs(p[0])).toBeLessThanOrEqual(0.8 + 1e-3);
        expect(Math.abs(p[1])).toBeLessThanOrEqual(0.8 + 1e-3);
        reach = Math.max(reach, Math.abs(p[0]), Math.abs(p[1]));
      }
      expect(reach).toBeGreaterThan(0.6);
    }));
  });

  it('Z is up: a point above the target projects above the centre', () => {
    const o = fitOrbit({ min: [0, 0, 0], max: [10, 10, 10] });
    const m = viewProjection(o, 1);
    expect(project(m, [5, 5, 9])[1]).toBeGreaterThan(project(m, [5, 5, 5])[1]);
  });

  it('elevation is clamped short of the poles and zoom never reaches zero', () => {
    const o = fitOrbit(null);
    expect(rotate(o, 0, 10).elevation).toBeLessThan(Math.PI / 2);
    expect(rotate(o, 0, -10).elevation).toBeGreaterThan(-Math.PI / 2);
    expect(zoom(o, 1e-12).distance).toBeGreaterThan(0);
    expect(zoom(o, -1)).toBe(o);
  });
});
