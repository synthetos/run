import { describe, expect, it } from 'vitest';
import { SEGMENT, SegmentListError, checkSegmentList, drawnBounds, lineOfVertex, scrubVertexEnd } from '../src/index.ts';
import { listOf } from './helpers.ts';

const { RAPID, FEED, BREAK } = SEGMENT;

describe('segment list', () => {
  const list = listOf([[[RAPID, 0, 0, 5]], [], [[FEED, 10, 0, 5], [FEED, 10, 10, 5]], [[BREAK, 50, 50, 50], [FEED, 51, 50, 50]]]);

  it('accepts a consistent list and refuses inconsistent ones', () => {
    expect(() => { checkSegmentList(list); }).not.toThrow();
    expect(() => { checkSegmentList({ ...list, vertices: list.vertices.slice(1) }); }).toThrow(SegmentListError);
    expect(() => { checkSegmentList({ ...list, lineToVertex: new Uint32Array([1, 2]) }); }).toThrow(SegmentListError);
    expect(() => { checkSegmentList({ ...list, lineToVertex: new Uint32Array([1, 3, 2, 6, 6]) }); }).toThrow(/decreases/);
    expect(() => { checkSegmentList({ ...list, lineMarks: new Uint8Array(1) }); }).toThrow(/lineMarks/);
  });

  it('maps vertices to lines, skipping empty lines', () => {
    expect([1, 2, 3, 4, 5].map((v) => lineOfVertex(list, v))).toEqual([0, 2, 2, 3, 3]);
  });

  it('the scrubber highlights whole lines from the start, clamped', () => {
    expect(scrubVertexEnd(list, -1)).toBe(0);
    expect(scrubVertexEnd(list, 0)).toBe(2);
    expect(scrubVertexEnd(list, 1)).toBe(2);
    expect(scrubVertexEnd(list, 2)).toBe(4);
    expect(scrubVertexEnd(list, 99)).toBe(6);
  });

  it('bounds cover drawn segments only (a break is not drawn), with or without rapids', () => {
    expect(drawnBounds(list)).toEqual({ min: [0, 0, 0], max: [51, 50, 50] });
    expect(drawnBounds(list, false)).toEqual({ min: [0, 0, 5], max: [51, 50, 50] });
    expect(drawnBounds(listOf([[[BREAK, 1, 1, 1]]]))).toBeNull();
  });
});
