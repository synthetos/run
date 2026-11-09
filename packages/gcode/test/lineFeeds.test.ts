/** The programmed feed per sent line (JobAnalysis.lineFeeds), which Play preview times the moves by. */
import { describe, expect, it } from 'vitest';
import { TINYG_EN } from '@synthetos/protocol';
import { analyse } from './helpers.ts';

describe('lineFeeds', () => {
  it('is the feed in force for each line, in mm/min, NaN before any F', () => {
    const { analysis } = analyse(['G21 G90', 'G0 X1', 'G1 X2 F600', 'G1 X3', 'G1 X4 F1200', 'M30'].join('\n'), TINYG_EN);
    expect(Array.from(analysis.lineFeeds).slice(0, 5)).toEqual([Number.NaN, Number.NaN, 600, 600, 1200]);
  });
  it('converts inches to mm', () => {
    const { analysis } = analyse(['G20 G90', 'G1 X0.1 F10', 'M30'].join('\n'), TINYG_EN);
    expect(analysis.lineFeeds[1]).toBeCloseTo(254, 3);
  });
});
