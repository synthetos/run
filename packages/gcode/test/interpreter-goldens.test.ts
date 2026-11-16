import { describe, expect, it } from 'vitest';

import { G2CORE_EDGE, TINYG_440, TINYG_EN } from '@synthetos/protocol';

import { KIND, LINE_FLAG, interpretJob } from '../src/index.ts';

import { analyse, fixture, points, rules, start, unchecked } from './helpers.ts';
import { BOTH } from './interpreterHarness.ts';
describe('old P1-03 goldens', () => {

  it('an R arc with an impossible radius: "firmware will reject"', () => {
    const { analysis } = analyse('G90 G21\nG1 X0 Y0 F100\nG2 X10 Y0 R2', TINYG_EN);
    expect(analysis.blocked).toBe(true);
    const a = interpretJob(unchecked(['G21 G90 F100', 'G2 X10 Y0 R2'], TINYG_EN), TINYG_EN, { start: start() });
    const f = a.findings.find((x) => x.rule === 'arc-rejected');
    expect(f?.message).toMatch(/firmware will reject/);
    expect(a.end.machine.X).toBe(0);
  });
});

describe('old P1-03 goldens', () => {


  it('R0 is a radius of 0, never "no R"', () => {
    const a = interpretJob(unchecked(['G21 G90 F100', 'G2 X10 Y0 R0'], TINYG_EN), TINYG_EN, { start: start() });
    expect(rules(a)).toEqual(['arc-rejected']);
  });
});

describe('old P1-03 goldens', () => {


  it('units never set, distance never set, and G91 left at the end are findings', () => {
    const { analysis: a } = analyse('G0 X1\nG91\nG0 X1', TINYG_EN);
    expect(rules(a, 'warn')).toEqual(expect.arrayContaining(['units-never-set', 'g91-at-end']));
    expect(rules(analyse('G21\nG0 X1', TINYG_EN).analysis, 'warn')).toContain('distance-never-set');
    expect(rules(analyse('G21 G90\nG0 X1', TINYG_EN).analysis, 'warn')).toEqual([]);
  });
});

describe('old P1-03 goldens', () => {


  it('units switched mid-file warn; G20 and G21 versions of the same geometry give the same machine coordinates', () => {
    expect(rules(analyse('G21 G90\nG0 X1\nG20\nG0 X1', TINYG_EN).analysis, 'warn')).toContain('units-switched');
    const mm = analyse('G21 G90\nG0 X25.4 Y50.8\nG1 X50.8 F254\nG2 X76.2 Y76.2 I0 J25.4', TINYG_EN).analysis;
    const inch = analyse('G20 G90\nG0 X1 Y2\nG1 X2 F10\nG2 X3 Y3 I0 J1', TINYG_EN).analysis;
    expect(inch.blocked).toBe(false);
    expect(inch.vertices.length).toBe(mm.vertices.length);
    inch.vertices.forEach((v, i) => expect(v).toBeCloseTo(mm.vertices[i] as number, 4));
  });
});

describe('old P1-03 goldens', () => {


  it('G38.2 is a finding: probing is not supported in v1', () => {
    const { analysis: a } = analyse('G21 G90\nG38.2 Z-10 F10', TINYG_EN);
    expect(a.blocked).toBe(true);
    expect(a.findings.some((f) => f.severity === 'block' && f.line === 2)).toBe(true);
  });
});

describe('old P1-03 goldens', () => {


  it('lines after G28.2 (rejected, never sent) are flagged uncertain', () => {
    const { sanitized, analysis: a } = analyse('G21 G90\nG0 X1\nG28.2 X0\nG0 X2\nG0 X3', TINYG_EN);
    expect(a.blocked).toBe(true);
    const flags = sanitized.lines.map((l, i) => [l.sourceLine, ((a.lineFlags[i] as number) & LINE_FLAG.UNCERTAIN) !== 0]);
    expect(flags).toEqual([[1, false], [2, false], [4, true], [5, true]]);
    expect(rules(a, 'info')).toContain('after-rejected-line');
    expect(a.findings.find((f) => f.rule === 'after-rejected-line')?.message).toBe("Line 3 is blocked, so it isn't sent: positions after it may not match what the file intends.");
    expect(a.kinds[a.kinds.length - 1]! & KIND.UNCERTAIN).toBeTruthy();
  });
});

describe('old P1-03 goldens', () => {


  it('TinyG: "N10 (comment) G0X10", "(comment) G0X10" and an unclosed "(" are rejected, not drawn', () => {
    for (const d of BOTH) {
      const { analysis: a } = analyse(fixture('cam/17-comment-then-code.nc'), d);
      expect(a.blocked).toBe(true);
      expect(a.end.machine.X).not.toBe(10);
      expect(rules(analyse('G21 G90\n(open G0 X10', d).analysis)).toContain('unclosed-comment');
    }
  });
});

describe('old P1-03 goldens', () => {


  it('the first feed move before any F is blocked', () => {
    expect(rules(analyse('G21 G90\nG1 X1', TINYG_EN).analysis)).toContain('feed-not-set');
    const a = interpretJob(unchecked(['G21 G90', 'G1 X1'], TINYG_EN), TINYG_EN, { start: start() });
    expect(a.findings.map((f) => [f.rule, f.source])).toContainEqual(['feed-not-set', 'analyser']);
  });
});

describe('old P1-03 goldens', () => {


  it('M50 on TG: info "ignored by firmware"', () => {
    const { analysis: a } = analyse('G21 G90\nM50\nG0 X1', TINYG_440);
    expect(a.findings.some((f) => f.rule === 'ignored-code' && f.line === 2 && f.severity !== 'block')).toBe(true);
    expect(a.blocked).toBe(false);
    const own = interpretJob(unchecked(['G21 G90', 'M50', 'M50'], TINYG_440), TINYG_440, { start: start() });
    expect(own.findings.filter((f) => f.rule === 'ignored-code').map((f) => [f.line, f.severity])).toEqual([[2, 'info']]);
  });
});

describe('old P1-03 goldens', () => {


  it('rapids below Z0 and cutting with the spindle off are warnings', () => {
    const { analysis: a } = analyse('G21 G90\nG0 Z-1\nG1 X5 F100', TINYG_EN);
    expect(rules(a, 'warn')).toEqual(expect.arrayContaining(['rapid-below-z0', 'spindle-off-cut']));
    expect((a.lineFlags[2] as number) & LINE_FLAG.SPINDLE_OFF_CUT).toBeTruthy();
  });
});

describe('old P1-03 goldens', () => {


  it('a stored G28 position that was not read makes the move undrawable and later positions uncertain', () => {
    const st = { ...start() };
    delete (st as { g28?: unknown }).g28;
    const a = interpretJob(unchecked(['G21 G90', 'G28', 'G0 X1'], TINYG_EN), TINYG_EN, { start: st });
    expect(rules(a, 'warn')).toContain('stored-position-unknown');
    expect((a.lineFlags[2] as number) & LINE_FLAG.UNCERTAIN).toBeTruthy();
  });
});

describe('old P1-03 goldens', () => {


  it('G28 goes through the intermediate point in the dialect\'s frame, then to the stored position', () => {
    const st = { ...start(), wcsOffsets: { ...start().wcsOffsets, G54: { X: 100, Y: 0, Z: 0, A: 0, B: 0, C: 0 } }, g28: { X: 5, Y: 5, Z: 5, A: 0, B: 0, C: 0 } };
    const legs = (d: typeof TINYG_EN): number[] => {
      const a = interpretJob(unchecked(['G21 G90', 'G28 X1'], d), d, { start: st });
      return points(a).map((p) => p[0]);
    };
    expect(legs(TINYG_EN)).toEqual([0, 101, 5]); // work frame: X1 + G54 offset 100
    expect(legs(TINYG_440)).toEqual([0, 1, 5]); // machine frame (TG canonical_machine.c:907-914)
  });
});

describe('old P1-03 goldens', () => {


  it('G92 and G92.1 shift and restore the work frame; G53 moves in machine coordinates', () => {
    const a = interpretJob(unchecked(['G21 G90', 'G0 X10', 'G92 X0', 'G0 X5', 'G53 G0 X1', 'G92.1', 'G0 X2'], TINYG_EN), TINYG_EN, { start: start() });
    expect(points(a).map((p) => p[0])).toEqual([0, 10, 15, 1, 2]);
  });
});

describe('old P1-03 goldens', () => {


  it('M30 restores the defaults: G92 off, G90, default units', () => {
    const a = interpretJob(unchecked(['G21 G91', 'G92 X5', 'M30'], TINYG_EN), TINYG_EN, { start: start() });
    expect(a.end.distance).toBe('G90');
    expect(a.end.g92.active).toBe(false);
  });
});

describe('old P1-03 goldens', () => {


  it('g2core data is honoured too (G10 L1/L10 data is not a TinyG block)', () => {
    expect(G2CORE_EDGE.gcode.lWords).toContain(20);
  });
});
