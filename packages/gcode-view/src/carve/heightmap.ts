/**
 * The stock's top as a heightmap (docs/design/tool-sim.md, slice 2): one
 * Float32 top Z per cell over the stock's footprint, in the path frame (the
 * frame the toolpath is drawn in), so the renderer places it with the same
 * path offset as the path. Pure.
 *
 * It does: choose the cell size (0.25 mm, coarsened so the grid stays under
 * about 2 million cells and fits a texture), lay out the grid, fill the
 * stock's top and mark cells outside a non-rectangular outline, and copy
 * rectangles in and out. It does not carve (sweep.ts), keep history
 * (keyframes.ts) or draw (mesh.ts).
 */
import type { Pt2 } from '../scene.ts';

/** The finest cell, mm. */
export const BASE_CELL_MM = 0.25;
/** The grid is coarsened until it has at most this many cells. */
export const MAX_CELLS = 2_000_000;
/** And at most this many cells along a side (a texture side every WebGL2 GPU in use supports). */
export const MAX_GRID_SIDE = 4096;
/** Height of a cell with no stock under it (outside a round or imported outline). Never carved, never drawn. */
export const NO_STOCK = Math.fround(-1e30);

/** The grid, in the path frame. Cell (i, j) covers x0 + i·cell .. x0 + (i+1)·cell, and likewise in Y; row-major, j rows. */
export interface GridSpec {
  readonly x0: number;
  readonly y0: number;
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  /** The stock's top and bottom Z. */
  readonly top: number;
  readonly bottom: number;
  /** The stock's outline when it is not the whole rectangle; cells whose centre is outside it hold NO_STOCK. */
  readonly outline: readonly Pt2[] | null;
}

export interface Heightmap {
  readonly spec: GridSpec;
  /** Top Z per cell, nx·ny, row-major. */
  readonly z: Float32Array;
}

/** A rectangle of cells, half-open: columns x..x+w, rows y..y+h. */
export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The stock as the grid needs it, in the path frame. */
export interface StockFootprint {
  readonly min: Pt2;
  readonly max: Pt2;
  readonly top: number;
  readonly bottom: number;
  /** The outline, or null for the whole min..max rectangle. */
  readonly outline: readonly Pt2[] | null;
}

const MANTISSAS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8] as const;

/** Round cell sizes from `base` up: 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.25, … */
function* cellSizes(base: number): Generator<number> {
  for (let e = -3; e < 6; e++) {
    for (const m of MANTISSAS) {
      const c = Number((m * 10 ** e).toPrecision(6));
      if (c >= base - 1e-12) yield c;
    }
  }
}

const cellsAlong = (span: number, cell: number): number => Math.max(1, Math.ceil(span / cell - 1e-9));

/** The finest round cell size, from `base` up, whose grid over width × depth has at most `maxCells` cells and `maxSide` per side. */
export function cellSizeFor(width: number, depth: number, base = BASE_CELL_MM, maxCells = MAX_CELLS, maxSide = MAX_GRID_SIDE): number {
  let last = base;
  for (const c of cellSizes(base)) {
    last = c;
    const nx = cellsAlong(width, c);
    const ny = cellsAlong(depth, c);
    if (nx * ny <= maxCells && nx <= maxSide && ny <= maxSide) return c;
  }
  return last;
}

/** The grid over a stock footprint, or null when the footprint is empty or not finite. */
export function gridSpec(stock: StockFootprint, base = BASE_CELL_MM, maxCells = MAX_CELLS, maxSide = MAX_GRID_SIDE): GridSpec | null {
  const w = stock.max[0] - stock.min[0];
  const d = stock.max[1] - stock.min[1];
  const nums = [w, d, stock.top, stock.bottom, stock.min[0], stock.min[1]];
  if (nums.some((n) => !Number.isFinite(n)) || w <= 0 || d <= 0 || stock.top <= stock.bottom) return null;
  const cell = cellSizeFor(w, d, base, maxCells, maxSide);
  return { x0: stock.min[0], y0: stock.min[1], cell, nx: cellsAlong(w, cell), ny: cellsAlong(d, cell), top: stock.top, bottom: stock.bottom, outline: stock.outline !== null && stock.outline.length >= 3 ? stock.outline : null };
}

/** True when two specs lay out the same grid (a carve can carry on). */
export function sameSpec(a: GridSpec | null, b: GridSpec | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.x0 !== b.x0 || a.y0 !== b.y0 || a.cell !== b.cell || a.nx !== b.nx || a.ny !== b.ny || a.top !== b.top || a.bottom !== b.bottom) return false;
  const p = a.outline;
  const q = b.outline;
  if (p === null || q === null) return p === q;
  return p.length === q.length && p.every((pt, i) => pt[0] === (q[i] as Pt2)[0] && pt[1] === (q[i] as Pt2)[1]);
}

/** The uncut stock: every cell at the top, or NO_STOCK outside the outline (scanline fill by cell centre). */
export function createHeightmap(spec: GridSpec): Heightmap {
  const { nx, ny, x0, y0, cell, top, outline } = spec;
  const z = new Float32Array(nx * ny);
  if (outline === null) {
    z.fill(top);
    return { spec, z };
  }
  z.fill(NO_STOCK);
  const xs: number[] = [];
  for (let j = 0; j < ny; j++) {
    const yc = y0 + (j + 0.5) * cell;
    xs.length = 0;
    for (let k = 0; k < outline.length; k++) {
      const p = outline[k] as Pt2;
      const q = outline[(k + 1) % outline.length] as Pt2;
      if ((p[1] <= yc && yc < q[1]) || (q[1] <= yc && yc < p[1])) xs.push(p[0] + ((yc - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(((xs[k] as number) - x0) / cell - 0.5));
      const i1 = Math.min(nx - 1, Math.floor(((xs[k + 1] as number) - x0) / cell - 0.5));
      if (i1 >= i0) z.fill(top, j * nx + i0, j * nx + i1 + 1);
    }
  }
  return { spec, z };
}

/** The whole grid as a rectangle. */
export function fullRect(spec: Pick<GridSpec, 'nx' | 'ny'>): CellRect {
  return { x: 0, y: 0, w: spec.nx, h: spec.ny };
}

/** The smallest rectangle holding both (either may be null). */
export function unionRect(a: CellRect | null, b: CellRect | null): CellRect | null {
  if (a === null) return b;
  if (b === null) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** A copy of a rectangle of `z` (grid width `nx`), row-major. */
export function copyRect(z: Float32Array, nx: number, r: CellRect): Float32Array {
  const out = new Float32Array(r.w * r.h);
  for (let j = 0; j < r.h; j++) {
    const at = (r.y + j) * nx + r.x;
    out.set(z.subarray(at, at + r.w), j * r.w);
  }
  return out;
}

/** Writes a rectangle copied by `copyRect` back into `z` (grid width `nx`). */
export function pasteRect(z: Float32Array, nx: number, r: CellRect, data: Float32Array): void {
  for (let j = 0; j < r.h; j++) z.set(data.subarray(j * r.w, (j + 1) * r.w), (r.y + j) * nx + r.x);
}
