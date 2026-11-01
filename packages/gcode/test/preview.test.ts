import { describe, expect, it } from 'vitest';
import { TINYG_EN } from '@synthetos/protocol';
import { LINE_FLAG, PREVIEW_MARK, VERDICT, indexFindings, lineVerdicts, previewSegments, sentSourceLines } from '../src/index.ts';
import { analyse, start } from './helpers.ts';

const FILE = ['G21 G90', 'G0 X10 Y10', 'G1 X20 F600', 'G1 X400', 'G4 P1', 'M30'].join('\n');

describe('preview adapter (TB-03)', () => {
  it('the segment list is the analysis itself: same vertices, kinds and line map', () => {
    const { analysis } = analyse(FILE, TINYG_EN, { start: start() });
    const s = previewSegments(analysis);
    expect(s.vertices).toBe(analysis.vertices);
    expect(s.kinds).toBe(analysis.kinds);
    expect(s.lineToVertex).toBe(analysis.lineToVertex);
    expect(s.lineMarks.length).toBe(analysis.lineFlags.length);
  });

  it('marks out-of-bounds and uncertain lines for the viewer', () => {
    const { analysis } = analyse(FILE, TINYG_EN);
    const flags = new Uint8Array([0, LINE_FLAG.OUT_OF_BOUNDS, LINE_FLAG.UNCERTAIN, LINE_FLAG.OUT_OF_BOUNDS | LINE_FLAG.UNCERTAIN | LINE_FLAG.ARC]);
    const s = previewSegments({ ...analysis, lineFlags: flags });
    expect(Array.from(s.lineMarks)).toEqual([0, PREVIEW_MARK.OUT_OF_BOUNDS, PREVIEW_MARK.UNCERTAIN, PREVIEW_MARK.OUT_OF_BOUNDS | PREVIEW_MARK.UNCERTAIN]);
  });

  it('a line verdict is the worst finding on that file line; file-level findings stay off the lines', () => {
    const { analysis } = analyse(FILE, TINYG_EN);
    const findings = [
      { line: 2, n: 2, severity: 'info' as const, rule: 'a', message: '', source: 'analyser' as const },
      { line: 2, n: 2, severity: 'block' as const, rule: 'b', message: '', source: 'sanitizer' as const },
      { line: 2, n: 2, severity: 'warn' as const, rule: 'c', message: '', source: 'analyser' as const },
      { line: 4, n: 4, severity: 'change' as const, rule: 'd', message: '', source: 'sanitizer' as const },
      { line: 0, n: null, severity: 'block' as const, rule: 'e', message: '', source: 'analyser' as const },
      { line: 99, n: null, severity: 'block' as const, rule: 'f', message: '', source: 'analyser' as const },
    ];
    expect(Array.from(lineVerdicts({ ...analysis, findings }, 6))).toEqual([VERDICT.OK, VERDICT.BLOCK, VERDICT.OK, VERDICT.CHANGE, VERDICT.OK, VERDICT.OK]);
    const idx = indexFindings(findings);
    expect(idx.between(2, 3).map((f) => f.rule)).toEqual(['a', 'b', 'c']);
    expect(idx.between(3, 4).map((f) => f.rule)).toEqual(['d']);
    expect(idx.fileLevel.map((f) => f.rule)).toEqual(['e']);
    expect(idx.counts).toEqual({ block: 3, warn: 1, change: 1, info: 1 });
  });

  it('a blocked line of a real file gets the block verdict', () => {
    const { analysis } = analyse('G21 G90\nG0 X1\nG28.3 X0\nM30', TINYG_EN);
    const v = lineVerdicts(analysis, 4);
    const blocked = analysis.findings.filter((f) => f.severity === 'block' && f.line > 0).map((f) => f.line);
    expect(blocked.length).toBeGreaterThan(0);
    for (const line of blocked) expect(v[line - 1]).toBe(VERDICT.BLOCK);
  });

  it('maps sent lines back to file lines', () => {
    const { sanitized } = analyse(FILE, TINYG_EN);
    expect(Array.from(sentSourceLines(sanitized))).toEqual(sanitized.lines.map((l) => l.sourceLine));
  });
});
