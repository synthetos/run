/** Where the carve goes below the stock (carve/belowStock.ts and the carver's record of it). */
import { describe, expect, it } from 'vitest';
import { BELOW_STOCK_EPS, SEGMENT, createCarver, noteBelow, type GridSpec, type ToolShape } from '../src/index.ts';
import { listOf } from './helpers.ts';

describe('noteBelow', () => {
  it('records the first line below the bottom and the deepest one', () => {
    let b = noteBelow(null, 3, -6.0, -6.35);
    expect(b).toBeNull();
    // Ending at the bottom (a cut through) is not below it.
    b = noteBelow(b, 4, -6.35 - BELOW_STOCK_EPS / 2, -6.35);
    expect(b).toBeNull();
    b = noteBelow(b, 5, -6.95, -6.35);
    expect(b?.firstLine).toBe(5);
    expect(b?.firstDepth).toBeCloseTo(0.6, 9);
    b = noteBelow(b, 6, -6.5, -6.35);
    expect(b).toMatchObject({ firstLine: 5, deepestLine: 5 });
    b = noteBelow(b, 7, -7.35, -6.35);
    expect(b).toMatchObject({ firstLine: 5, deepestLine: 7 });
    expect(b?.deepestDepth).toBeCloseTo(1, 9);
    expect(noteBelow(b, 8, Infinity, -6.35)).toBe(b);
  });
});

describe('the carver', () => {
  const SPEC: GridSpec = { x0: -0.125, y0: -0.125, cell: 0.25, nx: 81, ny: 81, top: 0, bottom: -6.35, outline: null };
  const FLAT: ToolShape = { tip: 'flat', diameter: 2, fluteLength: 10, shank: 2, length: 30 };
  const { FEED, RAPID } = SEGMENT;
  // Line 0 cuts to the bottom, line 1 goes 0.6 mm under it, line 2 goes 1 mm under, then 300 shallow lines.
  const cut = (y: number, z: number): Array<readonly [number, number, number, number]> => [[RAPID, 2, y, 5], [FEED, 2, y, z], [FEED, 18, y, z], [RAPID, 18, y, 5]];
  const list = listOf([cut(2, -6.35), cut(6, -6.95), cut(10, -7.35), ...Array.from({ length: 300 }, (_, k) => cut(14 + (k % 4), -1))]);
  const tools = { starts: Uint32Array.from([0]), shapes: [FLAT] };

  it('notes where the lines carved so far go below the stock, and brings it back with a keyframe', () => {
    const c = createCarver(list, SPEC, tools);
    c.seek(1);
    while (!c.step(1e9).done);
    expect(c.below).toBeNull();
    c.seek(list.lineToVertex.length - 1);
    while (!c.step(3).done);
    expect(c.below).toMatchObject({ firstLine: 1, deepestLine: 2 });
    expect(c.below?.firstDepth).toBeCloseTo(0.6, 4);
    // Back past a keyframe taken after line 2, then before line 1: the record follows.
    c.seek(200);
    while (!c.step(1e9).done);
    expect(c.below).toMatchObject({ firstLine: 1, deepestLine: 2 });
    c.seek(1);
    while (!c.step(1e9).done);
    expect(c.below).toBeNull();
  });
});
