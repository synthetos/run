import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LINE_MARK, SEGMENT, STYLE, chunks, lineOfVertex, type SegmentList } from '../src/index.ts';
import { listOf } from './helpers.ts';

/** Every drawn segment as [x0,y0,z0,x1,y1,z1,line], straight from the list. */
function expected(list: SegmentList): number[][] {
  const out: number[][] = [];
  const v = list.vertices;
  for (let i = 1; i < list.kinds.length; i++) {
    const kind = (list.kinds[i] as number) & 0x7f;
    if (kind === 0) continue;
    out.push([v[(i - 1) * 3], v[(i - 1) * 3 + 1], v[(i - 1) * 3 + 2], v[i * 3], v[i * 3 + 1], v[i * 3 + 2], lineOfVertex(list, i)].map(Number));
  }
  return out;
}

function actual(list: SegmentList, per: number): number[][] {
  const out: number[][] = [];
  for (const c of chunks(list, per)) {
    expect(c.segments).toBeLessThanOrEqual(per);
    for (let s = 0; s < c.segments; s++) {
      expect(c.lines[s * 2]).toBe(c.lines[s * 2 + 1]);
      out.push([...c.positions.slice(s * 6, s * 6 + 6), c.lines[s * 2] as number].map(Number));
    }
  }
  return out;
}

const arbList = fc
  .array(fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.float({ noNaN: true, min: -1000, max: 1000 }), fc.float({ noNaN: true, min: -1000, max: 1000 }), fc.float({ noNaN: true, min: -50, max: 50 })), { maxLength: 4 }), { maxLength: 40 })
  .map((lines) => listOf(lines));

describe('chunked geometry', () => {
  it('the chunks hold exactly the drawn segments of the list, in order, with their lines (property)', () => {
    fc.assert(fc.property(arbList, fc.integer({ min: 1, max: 7 }), (list, per) => {
      expect(actual(list, per)).toEqual(expected(list));
    }));
  });

  it('styles: rapid, feed, arc, uncertain dimmed, out-of-bounds red over everything', () => {
    const { RAPID, FEED, ARC, UNCERTAIN } = SEGMENT;
    const list = listOf(
      [[[RAPID, 1, 0, 0]], [[FEED, 2, 0, 0]], [[ARC, 3, 0, 0]], [[FEED | UNCERTAIN, 4, 0, 0]], [[FEED, 5, 0, 0]], [[RAPID, 6, 0, 0]], [[FEED, 7, 0, 0]]],
      [0, 0, 0, 0, LINE_MARK.UNCERTAIN, LINE_MARK.OUT_OF_BOUNDS, LINE_MARK.OUT_OF_BOUNDS | LINE_MARK.UNCERTAIN],
    );
    const [c] = [...chunks(list)];
    expect(Array.from(c?.styles ?? []).filter((_, i) => i % 2 === 0)).toEqual([STYLE.RAPID, STYLE.FEED, STYLE.ARC, STYLE.UNCERTAIN, STYLE.UNCERTAIN, STYLE.OUT_OF_BOUNDS, STYLE.OUT_OF_BOUNDS]);
  });

  it('refuses a chunk size below one', () => {
    expect(() => [...chunks(listOf([]), 0)]).toThrow(RangeError);
  });
});

it('coarse geometry keeps original endpoints, rapid moves, warnings and tool boundaries', () => {
  const list = listOf(Array.from({ length: 100 }, (_, i) => [[i === 7 ? SEGMENT.RAPID : SEGMENT.FEED, i, 0, 0]]));
  const coarse = [...chunks(list, 16, { stride: 20, keepVertices: [list.lineToVertex[13] as number] })];
  const lines = coarse.flatMap(c => Array.from(c.lines).filter((_, i) => i % 2 === 0));
  expect(lines).toContain(7);
  expect(lines).toContain(13);
  expect(lines.length).toBeLessThan(15);
  for (const c of coarse) for (let i = 0; i < c.segments; i++) {
    const end = c.positions[i * 6 + 3] as number;
    const start = c.positions[i * 6] as number;
    expect(end - start).toBeLessThanOrEqual(1); // No joining across skipped moves.
  }
});

it('coarse scans yield even when no segments are drawable', () => {
  const count = 100_000;
  const list = { vertices: new Float32Array(count * 3), kinds: new Uint8Array(count), lineToVertex: Uint32Array.from([0, count]) };
  const steps = [...chunks(list, 8192, { stride: 10 })];
  expect(steps.length).toBeGreaterThan(10);
  expect(steps.every(c => c.segments === 0)).toBe(true);
});
