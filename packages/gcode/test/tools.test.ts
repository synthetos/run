import { describe, expect, it } from 'vitest';
import { TINYG_440, TINYG_EN } from '@synthetos/protocol';
import { NO_TOOL, activeToolAt, changeAt, toolChanges } from '../src/index.ts';
import { analyse, fixture } from './helpers.ts';

/** The first lines of TinyG gcode_samples/braid_500mm.gcode, as cut on the bench. */
const BRAID_HEAD = ['N1 T1M6', 'N2 G17', 'N3 G21 (mm)', 'N4 (S8000)', 'N5 (M3)', 'N6 G92X0.327Y-33.521Z-1.000', 'N7 G0Z4.000', 'N8 F500.0', 'N9 G1X0.327Y-33.521', 'N10 G1Z-1.000', 'N11 X0.654Y-33.526'].join('\n');

function table(text: string, dialect = TINYG_EN) {
  const { sanitized, analysis } = analyse(text, dialect);
  return toolChanges(sanitized.lines, analysis);
}

describe('active tool per line (tool-sim slice 1)', () => {
  it('braid_500mm: N1 T1M6 makes T1 active from file line 1; the first cut is N9', () => {
    const t = table(BRAID_HEAD);
    expect(Array.from(t.lines)).toEqual([1]);
    expect(Array.from(t.tools)).toEqual([1]);
    expect(t.firstCut).toBe(9);
    expect(activeToolAt(t, 1)).toBe(1);
    expect(activeToolAt(t, 11)).toBe(1);
  });

  it('T then M6 on separate lines changes to the last T before the M6', () => {
    const t = table(['G21 G90', 'T3', 'G0 X1', 'T4', 'M6', 'G1 X2 F100', 'M30'].join('\n'));
    expect(Array.from(t.lines)).toEqual([5]);
    expect(Array.from(t.tools)).toEqual([4]);
    expect(activeToolAt(t, 4)).toBeNull();
    expect(activeToolAt(t, 5)).toBe(4);
  });

  it('a T with no M6 after it selects only: the active tool stays the last changed one', () => {
    const t = table(['G21 G90', 'T1 M6', 'G1 X1 F100', 'T2', 'G1 X2', 'M30'].join('\n'));
    expect(Array.from(t.tools)).toEqual([1]);
    expect(activeToolAt(t, 5)).toBe(1);
  });

  it('before any M6 the tool is unknown, and the first cut can come before the first change', () => {
    const t = table(['G21 G90', 'G1 X1 F100', 'T2 M6', 'G1 X2', 'M30'].join('\n'));
    expect(t.firstCut).toBe(2);
    expect(Array.from(t.lines)).toEqual([3]);
    expect(activeToolAt(t, 2)).toBeNull();
    expect(activeToolAt(t, 4)).toBe(2);
  });

  it('an M6 with no T selected is an unknown tool, not the previous one', () => {
    const t = table(['G21 G90', 'T1 M6', 'G1 X1 F100', 'M6', 'G1 X2', 'M30'].join('\n'));
    expect(Array.from(t.tools)).toEqual([1, 1]);
    const none = table(['G21 G90', 'M6', 'G1 X1 F100', 'M30'].join('\n'));
    expect(Array.from(none.tools)).toEqual([NO_TOOL]);
    expect(activeToolAt(none, 3)).toBeNull();
  });

  it('several changes: each line gets the change in force, M06 counts as M6', () => {
    const t = table(['G21 G90', 'T1 M6', 'G1 X1 F100', 'T2 M06', 'G1 X2', 'T5', 'M6', 'G1 X3', 'M30'].join('\n'));
    expect(Array.from(t.lines)).toEqual([2, 4, 7]);
    expect(Array.from(t.tools)).toEqual([1, 2, 5]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((l) => activeToolAt(t, l))).toEqual([null, 1, 1, 2, 2, 2, 5, 5]);
    expect(changeAt(t, 0)).toBe(-1);
    expect(changeAt(t, 100)).toBe(2);
  });

  it('the CAM corpus M6 fixture, on both preview dialects', () => {
    const en = table(fixture('cam/18-m6-tool-change.nc'), TINYG_EN);
    expect(Array.from(en.lines)).toEqual([2]);
    expect(Array.from(en.tools)).toEqual([2]);
    // The 440 dialect blocks M6 (no tool-change stop there); a blocked line is not sent, so there is no change point.
    const tg = table(fixture('cam/18-m6-tool-change.nc'), TINYG_440);
    expect(tg.lines.length).toBe(0);
  });

  it('a file that never cuts has no first cut', () => {
    expect(table('G21 G90\nG0 X10\nM30').firstCut).toBe(0);
  });
});
