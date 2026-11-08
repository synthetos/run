/**
 * The carved stock's mesh layout (carve/mesh.ts): how many grid vertices and
 * at what stride, the grid's triangle indexes, and the side walls around the
 * stock's outline. Pure: numbers in, typed arrays out; no WebGL.
 */
import type { GridSpec } from './heightmap.ts';

/**
 * Most mesh vertices per side by default: one per cell on any grid up to 2048 cells a side (the 0.25 mm grid of a
 * 512 mm stock). A larger grid is thinned, each vertex taking the lowest of the cells it stands for.
 */
export const MESH_MAX = 2048;
/** The cap on a software renderer (SwiftShader, llvmpipe), where a vertex per cell makes each frame slow. */
export const SOFTWARE_MESH_MAX = 512;
/** No cap below this: a thinned vertex reads at most (4096 / 256)² cells. */
const MIN_MESH_MAX = 256;
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
  const stride = Math.max(1, Math.ceil(Math.max(spec.nx, spec.ny) / Math.max(MIN_MESH_MAX, max)));
  return { mx: 2 + Math.ceil(spec.nx / stride), my: 2 + Math.ceil(spec.ny / stride), stride };
}
