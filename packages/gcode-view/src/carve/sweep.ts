/**
 * One straight move swept through the heightmap (docs/design/tool-sim.md,
 * "Sweep"). Pure apart from writing the heightmap it is given.
 *
 * For each cell centre within the tool's radius R of the move's XY
 * projection: the closest point on that projection, the move's Z there
 * (linear along the move), and the distance d; the cell's top becomes
 * min(top, z + profileHeight(shape, d)). A pure plunge (no XY travel) is one
 * stamp at its lowest point. This is exact for horizontal moves (the
 * profile only rises with d, so the closest point is the lowest the tool
 * reaches over that cell). Ramps are approximate: on a slope the deepest
 * point over a cell can be a little off the XY-closest point, so a ramp
 * may leave up to (slope · R) too much at its edges. Arcs arrive already
 * split into short straight segments.
 *
 * It does not choose the tool (carver.ts), keep history or draw.
 */
import { profileHeight, type ToolShape } from '../toolProfile.ts';
import type { Heightmap } from './heightmap.ts';

/** Which cells changed and how deep: an inclusive cell box, grown by each sweep. Reset with `emptyDirty`. */
export interface Dirty {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The lowest top Z written. */
  lowest: number;
}

export function emptyDirty(): Dirty {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, lowest: Infinity };
}

export function isDirty(d: Dirty): boolean {
  return d.x1 >= d.x0;
}

/**
 * How far from its axis the tool can lower a cell when its tip is `depth` below the stock top: the radius where
 * the profile rises to `depth` (bisection; the profile only rises), at most the cutting radius.
 */
export function reachRadius(shape: ToolShape, depth: number): number {
  const R = shape.diameter / 2;
  if (!(R > 0) || !(depth > 0)) return 0;
  if (profileHeight(shape, R) < depth) return R;
  let lo = 0;
  let hi = R;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (profileHeight(shape, mid) < depth) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Sweeps the tool from A to B (path frame, mm) through `hm`, growing `dirty` by the cells it lowered.
 * Returns true when any cell changed.
 */
export function sweepSegment(hm: Heightmap, ax: number, ay: number, az: number, bx: number, by: number, bz: number, shape: ToolShape, dirty: Dirty): boolean {
  const { x0, y0, cell, nx, ny, top } = hm.spec;
  // A move whose lowest point is at or above the stock's top cuts nothing (the profile only rises from the tip).
  if (Math.min(az, bz) >= top) return false;
  // Nor does the tool's flank beyond where its profile rises above the stock top: a shallow V cut scans a narrow band.
  const R = reachRadius(shape, top - Math.min(az, bz));
  if (!(R > 0)) return false;
  const i0 = Math.max(0, Math.ceil((Math.min(ax, bx) - R - x0) / cell - 0.5));
  const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx) + R - x0) / cell - 0.5));
  const j0 = Math.max(0, Math.ceil((Math.min(ay, by) - R - y0) / cell - 0.5));
  const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by) + R - y0) / cell - 0.5));
  if (i0 > i1 || j0 > j1) return false;
  const z = hm.z;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy;
  const plunge = len2 < 1e-12;
  // A plunge stamps once at its lowest end.
  const tPlunge = bz < az ? 1 : 0;
  const R2 = R * R;
  const flat = shape.tip === 'flat';
  let changed = false;
  for (let j = j0; j <= j1; j++) {
    const py = y0 + (j + 0.5) * cell - ay;
    const row = j * nx;
    for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * cell - ax;
      let t = plunge ? tPlunge : (px * dx + py * dy) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const qx = px - t * dx;
      const qy = py - t * dy;
      const d2 = qx * qx + qy * qy;
      if (d2 > R2) continue;
      const h = az + t * dz + (flat ? 0 : profileHeight(shape, Math.sqrt(d2)));
      const k = row + i;
      // NaN-safe and NO_STOCK-safe: a cell with no stock is far below any cut, so it never changes.
      if (h < (z[k] as number)) {
        z[k] = h;
        changed = true;
        if (i < dirty.x0) dirty.x0 = i;
        if (i > dirty.x1) dirty.x1 = i;
        if (j < dirty.y0) dirty.y0 = j;
        if (j > dirty.y1) dirty.y1 = j;
        if (h < dirty.lowest) dirty.lowest = h;
      }
    }
  }
  return changed;
}
