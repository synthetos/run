import { describe, expect, it } from 'vitest';

import { G2CORE_EDGE, TINYG_440, TINYG_EN } from '@synthetos/protocol';

import { KIND, LINE_FLAG, interpretJob } from '../src/index.ts';

import { analyse, fixture, points, rules, start, unchecked } from './helpers.ts';
import { BOTH } from './interpreterHarness.ts';


describe('barriers, optional stop and pauses', () => {
  it('M0 and M60 are pause points on every TinyG dialect; the spindle stays on there', () => {
    for (const d of BOTH) {
      const { analysis: a } = analyse('G90 G21\nM3 S1000\nG0 X1\nM0\nG0 X2\nM60\nM5\nM30', d);
      expect(a.pausePoints, d.id).toEqual([4, 6]);
      expect(rules(a, 'info')).toContain('pause-outputs-on');
      expect(a.blocked).toBe(false);
    }
  });

  it('EN `os`: M1 is a pause point only with optional stop on', () => {
    expect(analyse('G90 G21\nG0 X1\nM1\nG0 X2', TINYG_EN).analysis.pausePoints).toEqual([]);
    expect(analyse('G90 G21\nG0 X1\nM1\nG0 X2', TINYG_EN, { sanitize: { optionalStop: true } }).analysis.pausePoints).toEqual([3]);
  });

  it('a pause the stream does not honour (or a stop the dialect does not have) blocks', () => {
    // Optional stop on in the preview but off in the sanitiser: the stream would not stop at M1.
    const { sanitized } = analyse('G90 G21\nG0 X1\nM1\nG0 X2', TINYG_EN);
    const a = interpretJob(sanitized, TINYG_EN, { start: start(), optionalStop: true });
    expect(rules(a)).toEqual(['barrier-mismatch']);
    const b = interpretJob(unchecked(['G0 X1'], TINYG_EN, [1]), TINYG_EN, { start: start() });
    expect(rules(b)).toEqual(['barrier-mismatch']);
  });

  it('M6 with C14: M5, M9, M0 are interpreted before the tool change, and the M0 is a pause', () => {
    const { sanitized, analysis: a } = analyse(fixture('cam/18-m6-tool-change.nc'), TINYG_EN, { sanitize: { c14: true, c22: true } });
    const m0 = sanitized.lines.find((l) => l.origin === 'c14' && l.body === 'M0');
    expect(m0).toBeDefined();
    expect(a.pausePoints).toEqual([m0?.n]);
    // Phase 3 (SAFETY §4.4a, H74): without C14, edge-next M6 is a manual tool-change stop (INFO), 440.21 still blocks it.
    expect(rules(analyse(fixture('cam/18-m6-tool-change.nc'), TINYG_EN).analysis, 'info')).toContain('tool-change-stop');
    expect(rules(analyse(fixture('cam/18-m6-tool-change.nc'), TINYG_440).analysis)).toContain('m6-without-c14');
  });
});


describe('old P1-03 goldens', () => {
  it('an R arc with an impossible radius: "firmware will reject"', () => {
    const { analysis } = analyse('G90 G21\nG1 X0 Y0 F100\nG2 X10 Y0 R2', TINYG_EN);
    expect(analysis.blocked).toBe(true);
    const a = interpretJob(unchecked(['G21 G90 F100', 'G2 X10 Y0 R2'], TINYG_EN), TINYG_EN, { start: start() });
    const f = a.findings.find((x) => x.rule === 'arc-rejected');
    expect(f?.message).toMatch(/firmware will reject/);
    expect(a.end.machine.X).toBe(0);
  });

  it('R0 is a radius of 0, never "no R"', () => {
    const a = interpretJob(unchecked(['G21 G90 F100', 'G2 X10 Y0 R0'], TINYG_EN), TINYG_EN, { start: start() });
    expect(rules(a)).toEqual(['arc-rejected']);
  });

  it('units never set, distance never set, and G91 left at the end are findings', () => {
    const { analysis: a } = analyse('G0 X1\nG91\nG0 X1', TINYG_EN);
    expect(rules(a, 'warn')).toEqual(expect.arrayContaining(['units-never-set', 'g91-at-end']));
    expect(rules(analyse('G21\nG0 X1', TINYG_EN).analysis, 'warn')).toContain('distance-never-set');
    expect(rules(analyse('G21 G90\nG0 X1', TINYG_EN).analysis, 'warn')).toEqual([]);
  });

  it('units switched mid-file warn; G20 and G21 versions of the same geometry give the same machine coordinates', () => {
    expect(rules(analyse('G21 G90\nG0 X1\nG20\nG0 X1', TINYG_EN).analysis, 'warn')).toContain('units-switched');
    const mm = analyse('G21 G90\nG0 X25.4 Y50.8\nG1 X50.8 F254\nG2 X76.2 Y76.2 I0 J25.4', TINYG_EN).analysis;
    const inch = analyse('G20 G90\nG0 X1 Y2\nG1 X2 F10\nG2 X3 Y3 I0 J1', TINYG_EN).analysis;
    expect(inch.blocked).toBe(false);
    expect(inch.vertices.length).toBe(mm.vertices.length);
    inch.vertices.forEach((v, i) => expect(v).toBeCloseTo(mm.vertices[i] as number, 4));
  });

  it('G38.2 is a finding: probing is not supported in v1', () => {
    const { analysis: a } = analyse('G21 G90\nG38.2 Z-10 F10', TINYG_EN);
    expect(a.blocked).toBe(true);
    expect(a.findings.some((f) => f.severity === 'block' && f.line === 2)).toBe(true);
  });

  it('lines after G28.2 (rejected, never sent) are flagged uncertain', () => {
    const { sanitized, analysis: a } = analyse('G21 G90\nG0 X1\nG28.2 X0\nG0 X2\nG0 X3', TINYG_EN);
    expect(a.blocked).toBe(true);
    const flags = sanitized.lines.map((l, i) => [l.sourceLine, ((a.lineFlags[i] as number) & LINE_FLAG.UNCERTAIN) !== 0]);
    expect(flags).toEqual([[1, false], [2, false], [4, true], [5, true]]);
    expect(rules(a, 'info')).toContain('after-rejected-line');
    expect(a.findings.find((f) => f.rule === 'after-rejected-line')?.message).toBe("Line 3 is blocked, so it isn't sent: positions after it may not match what the file intends.");
    expect(a.kinds[a.kinds.length - 1]! & KIND.UNCERTAIN).toBeTruthy();
  });

  it('TinyG: "N10 (comment) G0X10", "(comment) G0X10" and an unclosed "(" are rejected, not drawn', () => {
    for (const d of BOTH) {
      const { analysis: a } = analyse(fixture('cam/17-comment-then-code.nc'), d);
      expect(a.blocked).toBe(true);
      expect(a.end.machine.X).not.toBe(10);
      expect(rules(analyse('G21 G90\n(open G0 X10', d).analysis)).toContain('unclosed-comment');
    }
  });

  it('the first feed move before any F is blocked', () => {
    expect(rules(analyse('G21 G90\nG1 X1', TINYG_EN).analysis)).toContain('feed-not-set');
    const a = interpretJob(unchecked(['G21 G90', 'G1 X1'], TINYG_EN), TINYG_EN, { start: start() });
    expect(a.findings.map((f) => [f.rule, f.source])).toContainEqual(['feed-not-set', 'analyser']);
  });

  it('M50 on TG: info "ignored by firmware"', () => {
    const { analysis: a } = analyse('G21 G90\nM50\nG0 X1', TINYG_440);
    expect(a.findings.some((f) => f.rule === 'ignored-code' && f.line === 2 && f.severity !== 'block')).toBe(true);
    expect(a.blocked).toBe(false);
    const own = interpretJob(unchecked(['G21 G90', 'M50', 'M50'], TINYG_440), TINYG_440, { start: start() });
    expect(own.findings.filter((f) => f.rule === 'ignored-code').map((f) => [f.line, f.severity])).toEqual([[2, 'info']]);
  });

  it('rapids below Z0 and cutting with the spindle off are warnings', () => {
    const { analysis: a } = analyse('G21 G90\nG0 Z-1\nG1 X5 F100', TINYG_EN);
    expect(rules(a, 'warn')).toEqual(expect.arrayContaining(['rapid-below-z0', 'spindle-off-cut']));
    expect((a.lineFlags[2] as number) & LINE_FLAG.SPINDLE_OFF_CUT).toBeTruthy();
  });

  it('a stored G28 position that was not read makes the move undrawable and later positions uncertain', () => {
    const st = { ...start() };
    delete (st as { g28?: unknown }).g28;
    const a = interpretJob(unchecked(['G21 G90', 'G28', 'G0 X1'], TINYG_EN), TINYG_EN, { start: st });
    expect(rules(a, 'warn')).toContain('stored-position-unknown');
    expect((a.lineFlags[2] as number) & LINE_FLAG.UNCERTAIN).toBeTruthy();
  });

  it('G28 goes through the intermediate point in the dialect\'s frame, then to the stored position', () => {
    const st = { ...start(), wcsOffsets: { ...start().wcsOffsets, G54: { X: 100, Y: 0, Z: 0, A: 0, B: 0, C: 0 } }, g28: { X: 5, Y: 5, Z: 5, A: 0, B: 0, C: 0 } };
    const legs = (d: typeof TINYG_EN): number[] => {
      const a = interpretJob(unchecked(['G21 G90', 'G28 X1'], d), d, { start: st });
      return points(a).map((p) => p[0]);
    };
    expect(legs(TINYG_EN)).toEqual([0, 101, 5]); // work frame: X1 + G54 offset 100
    expect(legs(TINYG_440)).toEqual([0, 1, 5]); // machine frame (TG canonical_machine.c:907-914)
  });

  it('G92 and G92.1 shift and restore the work frame; G53 moves in machine coordinates', () => {
    const a = interpretJob(unchecked(['G21 G90', 'G0 X10', 'G92 X0', 'G0 X5', 'G53 G0 X1', 'G92.1', 'G0 X2'], TINYG_EN), TINYG_EN, { start: start() });
    expect(points(a).map((p) => p[0])).toEqual([0, 10, 15, 1, 2]);
  });

  it('M30 restores the defaults: G92 off, G90, default units', () => {
    const a = interpretJob(unchecked(['G21 G91', 'G92 X5', 'M30'], TINYG_EN), TINYG_EN, { start: start() });
    expect(a.end.distance).toBe('G90');
    expect(a.end.g92.active).toBe(false);
  });

  it('g2core data is honoured too (G10 L1/L10 data is not a TinyG block)', () => {
    expect(G2CORE_EDGE.gcode.lWords).toContain(20);
  });
});


describe('bounds, envelope and estimates', () => {
  const envelope = { X: { min: 0, max: 100 }, Y: { min: 0, max: 100 }, Z: { min: -50, max: 10 } };

  it('a line leaving the envelope is flagged and the first one is a finding', () => {
    const { analysis: a } = analyse('G21 G90\nG0 X50\nG0 X150\nG0 X200', TINYG_EN, { interpret: { envelope } });
    const f = a.findings.filter((x) => x.rule === 'out-of-bounds');
    expect(f.map((x) => x.line)).toEqual([3]);
    expect([...a.lineFlags].map((x) => (x & LINE_FLAG.OUT_OF_BOUNDS) !== 0)).toEqual([false, false, true, true]);
  });

  it('TG has no arc soft limits: an arc leaving the envelope says only this check stops it', () => {
    // Endpoints inside, the arc's top outside (Y up to 110).
    const text = 'G21 G90\nG0 X30 Y90\nG2 X70 Y90 I20 J0 F100';
    for (const [d, re] of [[TINYG_440, /does not soft-limit arcs/], [TINYG_EN, /^An arc leaves/]] as const) {
      const { analysis: a } = analyse(text, d, { interpret: { envelope } });
      const f = a.findings.find((x) => x.rule === 'arc-out-of-bounds');
      expect(f?.message, d.id).toMatch(re);
      expect(a.bounds?.max[1]).toBeCloseTo(110, 9);
    }
    const { analysis: inside } = analyse('G21 G90\nG0 X40 Y80\nG2 X60 Y80 I10 J0 F100', TINYG_440, { interpret: { envelope } });
    expect(inside.findings.some((x) => x.rule === 'arc-out-of-bounds')).toBe(false);
  });

  it('estimates time from vm/fr, and with jerk the trapezoid is slower; no model means no estimate', () => {
    const timing = { maxVelocity: { X: 6000, Y: 6000, Z: 6000 }, feedrateMax: { X: 6000, Y: 6000, Z: 6000 } };
    const flat = analyse('G21 G90\nG1 X100 F600\nG0 X0\nG4 P2', TINYG_EN, { interpret: { timing } }).analysis;
    expect(flat.stats.estimatedSeconds).toBeCloseTo(10 + 1 + 2, 9);
    const jerk = analyse('G21 G90\nG1 X100 F600', TINYG_EN, { interpret: { timing: { ...timing, jerk: { X: 5e6 } } } }).analysis;
    expect(jerk.stats.estimatedSeconds).toBeGreaterThan(10);
    const short = analyse('G21 G90\nG1 X0.01 F600', TINYG_EN, { interpret: { timing: { ...timing, jerk: { X: 5e6 } } } }).analysis;
    expect(short.stats.estimatedSeconds).toBeGreaterThan(0.001);
    expect(analyse('G21 G90\nG1 X100 F600', TINYG_EN).analysis.stats.estimatedSeconds).toBeNull();
    expect(analyse('G21 G90\nG1 X100 F600', TINYG_EN, { interpret: { timing: { maxVelocity: {}, feedrateMax: {} } } }).analysis.stats.estimatedSeconds).toBeNull();
  });

  it('the vertex cap coarsens arcs instead of exceeding it', () => {
    const text = 'G21 G90\nG0 X0 Y0\n' + Array.from({ length: 20 }, () => 'G2 X0 Y0 I50 J0 F1000').join('\n');
    const fine = analyse(text, TINYG_EN).analysis;
    expect(fine.kinds.length).toBeGreaterThan(3000);
    const capped = analyse(text, TINYG_EN, { interpret: { vertexCap: 1000 } }).analysis;
    expect(capped.kinds.length).toBeLessThanOrEqual(1000);
    expect(capped.stats.chordMm).toBeGreaterThan(0.01);
    expect(capped.bounds).toEqual(fine.bounds);
  });

  it('lineToVertex maps each sent line to its vertices', () => {
    const { sanitized, analysis: a } = analyse('G21 G90\nG0 X1\nG1 X2 F100\nM5', TINYG_EN);
    expect([...a.lineToVertex]).toEqual([1, 1, 2, 3, 3]);
    expect(a.lineToVertex.length).toBe(sanitized.lines.length + 1);
    expect([...a.kinds]).toEqual([KIND.BREAK, KIND.RAPID, KIND.FEED]);
  });

  it('a start state that was not read is assumed and flagged', () => {
    const { sanitized } = analyse('G21 G90\nG0 X1', TINYG_EN);
    const a = interpretJob(sanitized, TINYG_EN, {});
    expect(rules(a, 'warn')).toContain('start-assumed');
    expect((a.lineFlags[1] as number) & LINE_FLAG.UNCERTAIN).toBeTruthy();
  });
});


describe('large files (TB-03)', () => {
  it('a file with hundreds of thousands of rejected lines is interpreted, not a stack overflow', () => {
    const base = unchecked(['G21 G90 G0 X1'], TINYG_EN);
    const entries = Array.from({ length: 300_000 }, (_, i) => ({ line: i + 2, severity: 'block' as const, rule: 'r', message: 'm' }));
    const a = interpretJob({ lines: base.lines, extents: [], report: { ...base.report, blocked: true, entries } }, TINYG_EN, { start: start() });
    expect(a.findings.length).toBeGreaterThanOrEqual(300_000);
    expect(a.kinds.length).toBe(2);
  });
});
