/** The heightmap grid (carve/heightmap.ts): cell size, layout, outline mask, rectangles. */
import { describe, expect, it } from 'vitest';
import { NO_STOCK, cellSizeFor, copyRect, createHeightmap, fullRect, gridSpec, pasteRect, sameSpec, unionRect } from '../src/index.ts';

describe('cellSizeFor', () => {
  it('keeps 0.125 mm when the grid is small enough', () => {
    // The sample stock: 1440 × 960 = 1.38 M cells.
    expect(cellSizeFor(180, 120)).toBe(0.125);
    expect(cellSizeFor(300, 200)).toBe(0.2);
  });
  it('coarsens to the next round size that stays under 2 million cells', () => {
    // 0.6 mm: 2000 × 1334 = 2.67 M cells, too many; 0.8 mm: 1500 × 1000.
    expect(cellSizeFor(1200, 800)).toBe(0.8);
    expect(cellSizeFor(400, 300)).toBe(0.25);
    expect(cellSizeFor(450, 350)).toBe(0.3);
    expect(cellSizeFor(500, 400)).toBe(0.4);
  });
  it('coarsens a long thin stock to fit 4096 cells a side', () => {
    expect(cellSizeFor(2000, 20)).toBe(0.5);
  });
});

describe('gridSpec', () => {
  it('lays a grid over the footprint', () => {
    const s = gridSpec({ min: [-5, 2], max: [175, 122], top: 0, bottom: -6.35, outline: null });
    expect(s).toEqual({ x0: -5, y0: 2, cell: 0.125, nx: 1440, ny: 960, top: 0, bottom: -6.35, outline: null });
  });
  it('refuses an empty or upside-down stock', () => {
    expect(gridSpec({ min: [0, 0], max: [0, 10], top: 0, bottom: -1, outline: null })).toBeNull();
    expect(gridSpec({ min: [0, 0], max: [10, 10], top: -1, bottom: 0, outline: null })).toBeNull();
    expect(gridSpec({ min: [0, 0], max: [Number.NaN, 10], top: 0, bottom: -1, outline: null })).toBeNull();
  });
  it('compares by value', () => {
    const a = gridSpec({ min: [0, 0], max: [10, 10], top: 0, bottom: -1, outline: [[0, 0], [10, 0], [5, 10]] });
    const b = gridSpec({ min: [0, 0], max: [10, 10], top: 0, bottom: -1, outline: [[0, 0], [10, 0], [5, 10]] });
    expect(sameSpec(a, b)).toBe(true);
    expect(sameSpec(a, gridSpec({ min: [0, 0], max: [10, 10], top: 0, bottom: -2, outline: [[0, 0], [10, 0], [5, 10]] }))).toBe(false);
    expect(sameSpec(a, null)).toBe(false);
    expect(sameSpec(null, null)).toBe(true);
  });
});

describe('createHeightmap', () => {
  it('fills a rectangle at the top', () => {
    const hm = createHeightmap({ x0: 0, y0: 0, cell: 1, nx: 4, ny: 3, top: 2, bottom: 0, outline: null });
    expect([...hm.z]).toEqual(Array(12).fill(2));
  });
  it('marks cells whose centre is outside a round outline as no stock', () => {
    const ring = Array.from({ length: 64 }, (_, k) => [5 + 5 * Math.cos((k / 64) * 2 * Math.PI), 5 + 5 * Math.sin((k / 64) * 2 * Math.PI)] as const);
    const hm = createHeightmap({ x0: 0, y0: 0, cell: 1, nx: 10, ny: 10, top: 0, bottom: -1, outline: ring });
    expect(hm.z[5 * 10 + 5]).toBe(0);
    expect(hm.z[0]).toBe(NO_STOCK);
    expect(hm.z[99]).toBe(NO_STOCK);
    expect(hm.z[5 * 10 + 0]).toBe(0);
  });
});

describe('rectangles', () => {
  it('copies and pastes a rectangle', () => {
    const z = Float32Array.from({ length: 20 }, (_, i) => i);
    const r = { x: 1, y: 1, w: 3, h: 2 };
    const part = copyRect(z, 5, r);
    expect([...part]).toEqual([6, 7, 8, 11, 12, 13]);
    const into = new Float32Array(20);
    pasteRect(into, 5, r, part);
    expect(into[6]).toBe(6);
    expect(into[13]).toBe(13);
    expect(into[5]).toBe(0);
  });
  it('unions rectangles', () => {
    expect(unionRect({ x: 1, y: 1, w: 2, h: 2 }, { x: 4, y: 0, w: 1, h: 1 })).toEqual({ x: 1, y: 0, w: 4, h: 3 });
    expect(unionRect(null, { x: 1, y: 1, w: 1, h: 1 })).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(fullRect({ nx: 3, ny: 2 })).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });
});
