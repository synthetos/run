/**
 * The program frame and the path frame (frames.ts): the preview's path is the program position plus the
 * interpreter's offset on that line, so a board's reported work position maps onto the path at the line it
 * reports. The table changes only where the offset does (G92, G92.1, M30, G10, G54..G59, G43.1).
 */
import { describe, expect, it } from 'vitest';
import { TINYG_EN } from '@synthetos/protocol';
import { emptyFrames, interpretJob, nextG92Line, programToPath, type JobAnalysis, type ProgramFrames } from '../src/index.ts';
import { analyse, start } from './helpers.ts';

const round = (v: readonly number[]): number[] => v.map((x) => Math.round(x * 1e4) / 1e4 + 0);

/** The table as [line, x, y, z] rows. */
function rows(f: ProgramFrames): number[][] {
  return Array.from(f.lines, (line, i) => [line, ...round([f.offsets[i * 3] as number, f.offsets[i * 3 + 1] as number, f.offsets[i * 3 + 2] as number])]);
}

/** The drawn end point of file line `line` (the last vertex of its sent lines). */
function endOf(a: JobAnalysis, sourceLines: readonly number[], line: number): number[] {
  const i = sourceLines.lastIndexOf(line);
  const v = (a.lineToVertex[i + 1] as number) - 1;
  return round([a.vertices[v * 3] as number, a.vertices[v * 3 + 1] as number, a.vertices[v * 3 + 2] as number]);
}

/** Program position (board units) + the table's offset at `line`, in mm. */
function onPath(f: ProgramFrames, line: number, pos: readonly number[], mmPerUnit = 1): number[] {
  const o = programToPath(f, line);
  return round(pos.map((p, k) => p * mmPerUnit + (o[k] as number)));
}

// The head of braid_500mm.gcode (the bench run that showed the tool 33.5 mm off its path), offline start.
const BRAID = ['N1 T1M6', 'N2 G17', 'N3 G21', 'N4 G92X0.327Y-33.521Z-1.000', 'N5 G0Z4.000', 'N6 F500.0', 'N7 G1X0.327Y-33.521', 'N8 G1Z-1.000', 'N9 X-3.198Y-50.068', 'N10 G0Z4.000', 'N11 M30', ''].join('\n');

describe('the program-to-path table', () => {
  it('a G92 before any motion: the offset from its line on, reset by M30; the board’s pos maps onto the drawn path', () => {
    const { sanitized, analysis } = analyse(BRAID, TINYG_EN, { start: start() });
    expect(analysis.blocked).toBe(false);
    const f = analysis.frameTable;
    expect(rows(f)).toEqual([[0, 0, 0, 0], [4, -0.327, 33.521, 1], [11, 0, 0, 0]]);
    expect(Array.from(f.g92Lines)).toEqual([4]);
    expect(programToPath(f, 0)).toEqual([0, 0, 0]);
    expect(programToPath(f, 3)).toEqual([0, 0, 0]);
    expect(round(programToPath(f, 9))).toEqual([-0.327, 33.521, 1]);
    expect(programToPath(f, 11)).toEqual([0, 0, 0]);
    expect(programToPath(f, 99)).toEqual([0, 0, 0]);
    const src = sanitized.lines.map((l) => l.sourceLine);
    // While line 9 runs, the board reports the program position X -3.198 Y -50.068 Z -1 (it includes G92): that is the path's point.
    expect(endOf(analysis, src, 9)).toEqual([-3.525, -16.547, 0]);
    expect(onPath(f, 9, [-3.198, -50.068, -1])).toEqual(endOf(analysis, src, 9));
    expect(onPath(f, 5, [0.327, -33.521, 4])).toEqual(endOf(analysis, src, 5));
    // Without the table (the old marker: work position as path position) it is 33.5 mm off in Y.
    expect(round([-3.198 - -3.525, -50.068 - -16.547])).toEqual([0.327, -33.521]);
  });

  it('a mid-file G92 after motion takes the machine position then; G92.1 clears it', () => {
    const text = ['G21 G90', 'G0 X10 Y5', 'G92 X0 Y0', 'G1 X2 F100', 'G92.1', 'G0 X1', 'M30', ''].join('\n');
    const { sanitized, analysis } = analyse(text, TINYG_EN, { start: start() });
    const f = analysis.frameTable;
    expect(rows(f)).toEqual([[0, 0, 0, 0], [3, 10, 5, 0], [5, 0, 0, 0]]);
    const src = sanitized.lines.map((l) => l.sourceLine);
    expect(onPath(f, 4, [2, 0, 0])).toEqual(endOf(analysis, src, 4));
    expect(onPath(f, 6, [1, 5, 0])).toEqual(endOf(analysis, src, 6));
    expect(nextG92Line(f, 0)).toBe(3);
    expect(nextG92Line(f, 3)).toBeNull();
  });

  it('inches: offsets are in mm, the board’s pos in inches converts before it is added', () => {
    const text = ['G20 G90', 'G0 X1 Y1', 'G92 X0 Y0', 'G0 X0.5 Y0.25', 'M30', ''].join('\n');
    const { sanitized, analysis } = analyse(text, TINYG_EN, { start: start() });
    const f = analysis.frameTable;
    expect(rows(f)).toEqual([[0, 0, 0, 0], [3, 25.4, 25.4, 0], [5, 0, 0, 0]]);
    const src = sanitized.lines.map((l) => l.sourceLine);
    expect(onPath(f, 4, [0.5, 0.25, 0], 25.4)).toEqual(endOf(analysis, src, 4));
  });

  it('G92.2 suspends and G92.3 resumes; G10 L2, a WCS select and G43.1 change it too', () => {
    const text = ['G21 G90', 'G0 X4', 'G92 X0', 'G92.2', 'G92.3', 'G10 L2 P2 X100', 'G55', 'G43.1 Z-2', 'G49', 'M30', ''].join('\n');
    const f = analyse(text, TINYG_EN, { start: start() }).analysis.frameTable;
    expect(rows(f)).toEqual([[0, 0, 0, 0], [3, 4, 0, 0], [4, 0, 0, 0], [5, 4, 0, 0], [7, 104, 0, 0], [8, 104, 0, -2], [9, 104, 0, 0], [10, 0, 0, 0]]);
  });

  it('a live start with offsets begins from them; M2 keeps the saved offset and drops only G92', () => {
    const st = { ...start({ X: 50 }), wcsOffsets: { ...start().wcsOffsets, G54: { X: 30, Y: 10, Z: -5, A: 0, B: 0, C: 0 } } };
    const f = analyse('G21 G90\nG92 X0\nG0 X1\nM2\n', TINYG_EN, { start: st }).analysis.frameTable;
    expect(rows(f)).toEqual([[0, 30, 10, -5], [2, 50, 10, -5], [4, 30, 10, -5]]);
  });

  it('stays compact: one entry per change, not per line', () => {
    const lines = ['G21 G90', 'G92 X1'];
    for (let i = 0; i < 20_000; i++) lines.push(`G1 X${String(i % 7)} Y${String(i % 5)} F900`);
    lines.push('M30', '');
    const f = analyse(lines.join('\n'), TINYG_EN, { start: start() }).analysis.frameTable;
    expect(f.lines.length).toBe(3);
    expect(f.offsets.length).toBe(9);
  });

  it('a blocked analysis has the empty table; lookups clamp before the first line', () => {
    const a = interpretJob({ lines: [], report: { dialect: 'tinyg-440', blocked: false, entries: [], splits: [], longestMoveSeconds: 0, endState: { spindle: 'off', mist: false, flood: false } } }, TINYG_EN, { start: start() });
    expect(rows(a.frameTable)).toEqual([[0, 0, 0, 0]]);
    const f = emptyFrames([1, 2, 3]);
    expect(programToPath(f, -5)).toEqual([1, 2, 3]);
    expect(nextG92Line(f, 0)).toBeNull();
  });
});
