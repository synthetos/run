/**
 * The carved stock's mesh layout (carve/mesh.ts): how many grid vertices and
 * at what stride, the grid's triangle indexes, and the side walls around the
 * stock's outline. Pure: numbers in, typed arrays out; no WebGL.
 */
import type { GridSpec } from './heightmap.ts';

/** Most mesh vertices per side; a larger grid is sampled every few cells. */
export const MESH_MAX = 512;
/** Most wall pieces around the outline. */
const MAX_WALL_PIECES = 16384;

/** Wall vertices around the outline (or the grid's rectangle): x, y, top (1) or bottom (0), and a shade per side. */
export function wallVertices(spec: GridSpec): Float32Array {
  const x1 = spec.x0 + spec.nx * spec.cell;
  const y1 = spec.y0 + spec.ny * spec.cell;
  const outline = spec.outline ?? [[spec.x0, spec.y0], [x1, spec.y0], [x1, y1], [spec.x0, y1]];
  const lengths = outline.map((p, k) => {
    const q = outline[(k + 1) % outline.length] as readonly [number, number];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const perimeter = lengths.reduce((a, b) => a + b, 0);
  const step = Math.max(spec.cell, perimeter / MAX_WALL_PIECES);
  const out: number[] = [];
  outline.forEach((p, k) => {
    const q = outline[(k + 1) % outline.length] as readonly [number, number];
    const len = lengths[k] as number;
    if (len <= 0) return;
    // X-facing sides darker than Y-facing ones, as the scene solids are shaded (scene.ts FACE_SHADE).
    const nx = Math.abs(q[1] - p[1]) / len;
    const shade = 0.7 * nx * nx + 0.82 * (1 - nx * nx);
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < n; s++) {
      const ax = p[0] + ((q[0] - p[0]) * s) / n;
      const ay = p[1] + ((q[1] - p[1]) * s) / n;
      const bx = p[0] + ((q[0] - p[0]) * (s + 1)) / n;
      const by = p[1] + ((q[1] - p[1]) * (s + 1)) / n;
      out.push(ax, ay, 0, shade, bx, by, 0, shade, ax, ay, 1, shade, ax, ay, 1, shade, bx, by, 0, shade, bx, by, 1, shade);
    }
  });
  return new Float32Array(out);
}

/** Mesh vertices per side and the cell stride for a grid. */
export function meshLayout(spec: Pick<GridSpec, 'nx' | 'ny'>, max = MESH_MAX): { readonly mx: number; readonly my: number; readonly stride: number } {
  const stride = Math.max(1, Math.ceil(Math.max(spec.nx, spec.ny) / max));
  return { mx: 2 + Math.ceil(spec.nx / stride), my: 2 + Math.ceil(spec.ny / stride), stride };
}

/** Two triangles per mesh quad, as indexes into the row-major grid of mx · my vertices. */
export function gridIndexes(mx: number, my: number): Uint32Array {
  const out = new Uint32Array(6 * (mx - 1) * (my - 1));
  let n = 0;
  for (let y = 0; y + 1 < my; y++) {
    for (let x = 0; x + 1 < mx; x++) {
      const a = y * mx + x;
      out[n++] = a;
      out[n++] = a + 1;
      out[n++] = a + mx;
      out[n++] = a + mx;
      out[n++] = a + 1;
      out[n++] = a + mx + 1;
    }
  }
  return out;
}
