import { describe, expect, it } from 'vitest';
import { LINE_MARK, SEGMENT, svgEnvelope, svgPaths } from '../src/index.ts';
import { bigList, listOf } from './helpers.ts';

const { RAPID, FEED, ARC } = SEGMENT;

describe('2D SVG fallback', () => {
  const list = listOf([[[RAPID, 0, 0, 5]], [[FEED, 10, 0, 0]], [[ARC, 10, 10, 0]], [[FEED, 20, 10, 0]]], [0, 0, 0, LINE_MARK.OUT_OF_BOUNDS]);

  it('draws a top view with Y flipped, sorted by style, out of bounds separately', () => {
    const p = svgPaths(list);
    expect(p.rapid).toBe('M0 0L0 0');
    expect(p.feed).toBe('M0 0L10 0M10 0L10 -10');
    expect(p.outOfBounds).toBe('M10 -10L20 -10');
    expect(p.viewBox).toBe('-1 -11 22 12');
    expect(p.decimated).toBe(false);
  });

  it('hides rapids on request and highlights the scrubbed lines only', () => {
    const p = svgPaths(list, { showRapids: false, highlightLine: 1 });
    expect(p.rapid).toBe('');
    expect(p.highlight).toBe('M0 0L10 0');
  });

  it('decimates beyond the segment cap and says so', () => {
    const p = svgPaths(bigList(10_000), { maxSegments: 1000 });
    expect(p.decimated).toBe(true);
    const drawn = (p.rapid + p.feed).split('M').length - 1;
    expect(drawn).toBeLessThanOrEqual(1000);
    expect(drawn).toBeGreaterThan(900);
  });

  it('decimation never drops an out-of-bounds segment', () => {
    const big = bigList(10_000);
    const marks = new Uint8Array(10_000);
    const oob = [1, 2, 3, 5, 7, 11, 13, 4001, 9998];
    for (const l of oob) marks[l] = LINE_MARK.OUT_OF_BOUNDS;
    const p = svgPaths({ ...big, lineMarks: marks }, { maxSegments: 1000 });
    expect(p.decimated).toBe(true);
    expect(p.outOfBounds.split('M').length - 1).toBe(oob.length);
  });

  it('draws the envelope rectangle and includes it in the view box', () => {
    const env = { min: [-100, -50, -20] as const, max: [100, 50, 0] as const };
    expect(svgEnvelope(env)).toBe('M-100 50L100 50L100 -50L-100 -50Z');
    expect(svgEnvelope(null)).toBe('');
    expect(svgPaths(list, { envelope: env }).viewBox).toBe('-110 -60 220 120');
  });
});
