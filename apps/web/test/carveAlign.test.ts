/**
 * The carve lines up with the drawn toolpath (owner, 2026-11-09: "it's not engraving where we would expect it").
 * One straight cut at a known X and Y removes stock exactly under the drawn line: the carve's grid comes from the
 * scene's stock in the path frame (preview/carveStock.ts), the renderer draws both the path and the carve with
 * the same path offset, so the cut cells, moved by that offset, must sit under the line moved by it. Checked at
 * the planned placement (centre of the stock), at a corner with an offset, and with the job placed at the
 * board's work zero (livePlacement.ts), whose stock moves with the zero in X and Y. In Z the path goes where the
 * board will cut (a Z zero below the plan cuts deeper into the planned stock, by design), so the carve's floor is
 * at the drawn line's height in every case.
 */
import { describe, expect, it } from 'vitest';
import { createCarver, SEGMENT, type ToolShape, type Vec3 } from '@synthetos/gcode-view';
import { SEED_SETUP } from '../src/workspace/library.ts';
import { jobFromSetup, withDatum, withOffset, type Job, type JobClock } from '../src/workspace/jobModel.ts';
import { jobScene, type JobScene } from '../src/preview/sceneModel.ts';
import { placeJobAt } from '../src/preview/livePlacement.ts';
import { carveGrid } from '../src/preview/carveStock.ts';

const SCENE_COLORS = { bed: [0.7, 0.6, 0.5, 1], fixture: [0.5, 0.6, 0.7, 1], clamp: [0.4, 0.4, 0.4, 1], stock: [0.8, 0.8, 0.8, 1] } as const;
const clock: JobClock = { now: () => new Date('2026-11-09T12:00:00Z'), newId: () => 'job-1' };
const FLAT: ToolShape = { tip: 'flat', diameter: 2, fluteLength: 10, shank: 2, length: 30 };
const { BREAK, FEED, RAPID } = SEGMENT;

/** One cut, file coordinates: from (0, 0, 5) a rapid to (x0, y, 5), a plunge to Z -1, a feed to (x1, y). */
function cut(x0: number, x1: number, y: number): { vertices: Float32Array; kinds: Uint8Array; lineToVertex: Uint32Array } {
  return {
    vertices: new Float32Array([0, 0, 5, x0, y, 5, x0, y, -1, x1, y, -1]),
    kinds: new Uint8Array([BREAK, RAPID, FEED, FEED]),
    lineToVertex: new Uint32Array([1, 4]),
  };
}

/** The machine-coordinate box of the cells the carve lowered (cell centres moved by the path offset), and the stock's box. */
function carvedBox(scene: JobScene, list: ReturnType<typeof cut>): { min: Vec3; max: Vec3; stock: { min: [number, number]; max: [number, number] } } {
  const grid = carveGrid(scene.layers, scene.pathOffset);
  if (grid === null) throw new Error('no grid');
  const c = createCarver(list, grid, { starts: Uint32Array.from([0]), shapes: [FLAT] });
  c.seek(1);
  while (!c.step(1e9).done);
  const [ox, oy, oz] = scene.pathOffset;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const z = c.heightmap.z[j * grid.nx + i] as number;
      if (z >= grid.top) continue;
      const x = grid.x0 + (i + 0.5) * grid.cell + ox;
      const y = grid.y0 + (j + 0.5) * grid.cell + oy;
      min[0] = Math.min(min[0], x); max[0] = Math.max(max[0], x);
      min[1] = Math.min(min[1], y); max[1] = Math.max(max[1], y);
      min[2] = Math.min(min[2], z + oz); max[2] = Math.max(max[2], z + oz);
    }
  }
  const stock = scene.layers.solids.find((s) => s.tag === 'stock');
  if (stock === undefined || stock.kind !== 'box') throw new Error('no stock box');
  return { min, max, stock: { min: [stock.min[0], stock.min[1]], max: [stock.max[0], stock.max[1]] } };
}

/** The drawn line in machine coordinates: its file coordinates plus the same path offset. */
function expectUnderLine(scene: JobScene, x0: number, x1: number, y: number): void {
  const box = carvedBox(scene, cut(x0, x1, y));
  const [ox, oy, oz] = scene.pathOffset;
  const r = FLAT.diameter / 2;
  const cell = carveGrid(scene.layers, scene.pathOffset)?.cell ?? 0;
  // The cut spans the line plus the tool's radius, to within one cell.
  expect(box.min[0]).toBeGreaterThanOrEqual(x0 + ox - r - cell);
  expect(box.min[0]).toBeLessThanOrEqual(x0 + ox - r + cell);
  expect(box.max[0]).toBeGreaterThanOrEqual(x1 + ox + r - cell);
  expect(box.max[0]).toBeLessThanOrEqual(x1 + ox + r + cell);
  expect(box.min[1]).toBeCloseTo(y + oy - r + cell / 2, 0);
  expect(box.max[1]).toBeCloseTo(y + oy + r - cell / 2, 0);
  expect((box.min[1] + box.max[1]) / 2).toBeCloseTo(y + oy, 6);
  // And to the drawn depth: Z -1 in the file is Z -1 below the path offset.
  expect(box.min[2]).toBeCloseTo(-1 + oz, 6);
}

const base = (): Job => jobFromSetup(SEED_SETUP, 'align', clock);

describe('the carve sits under the drawn line', () => {
  it('at the planned placement, zero at the centre of the stock', () => {
    const job = withDatum(base(), { corner: 'center', height: 'top' }, clock);
    const scene = jobScene(job, SCENE_COLORS, null);
    expectUnderLine(scene, -20, 30, 10);
    expectUnderLine(scene, 5, 6, -25);
  });

  it('at a corner with an offset: the cut is the offset in from the corner of the stock', () => {
    const job = withOffset(withDatum(base(), { corner: 'front-left', height: 'top' }, clock), { x: 5, y: 7 }, clock);
    const scene = jobScene(job, SCENE_COLORS, null);
    expectUnderLine(scene, 0, 40, 0);
    const box = carvedBox(scene, cut(0, 40, 0));
    // The line starts at the zero: 5 mm in from the stock's left edge, 7 mm in from its front.
    expect((box.min[1] + box.max[1]) / 2 - box.stock.min[1]).toBeCloseTo(7, 6);
    expect(box.min[0] - box.stock.min[0]).toBeCloseTo(5 - FLAT.diameter / 2, 0);
  });

  it('with the job placed at the board’s work zero: the stock and the path move together', () => {
    const job = withDatum(base(), { corner: 'center', height: 'top' }, clock);
    const planned = jobScene(job, SCENE_COLORS, null);
    // Zeroed 0.5 mm lower than planned: the cut goes 0.5 mm deeper into the stock, at the drawn line.
    const live = placeJobAt(planned, [planned.zero[0] + 37.5, planned.zero[1] - 12.25, planned.zero[2] - 0.5]);
    expectUnderLine(live, -20, 30, 10);
    const a = carvedBox(planned, cut(-20, 30, 10));
    const b = carvedBox(live, cut(-20, 30, 10));
    // Relative to the stock, the cut is in the same place.
    expect(b.min[0] - b.stock.min[0]).toBeCloseTo(a.min[0] - a.stock.min[0], 6);
    expect(b.min[1] - b.stock.min[1]).toBeCloseTo(a.min[1] - a.stock.min[1], 6);
  });
});
