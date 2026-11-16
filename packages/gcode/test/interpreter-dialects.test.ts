import { describe, expect, it } from 'vitest';

import { TINYG_440, TINYG_449_STOCK, TINYG_EN } from '@synthetos/protocol';

import { KIND, LINE_FLAG, interpretJob } from '../src/index.ts';

import { analyse, fixture, points, rules, start, unchecked } from './helpers.ts';
describe('TB-02 acceptance: dialect data drives the interpreter', () => {

  it('EN: G10 L20 P1 X0 sets the G54 offset to the current position; TG blocks it', () => {
    const st = start({ X: 10 });
    const en = analyse(fixture('cam/13-g10-l20.nc'), TINYG_EN, { start: st }).analysis;
    expect(en.blocked).toBe(false);
    expect(en.end.wcsOffsets.G54.X).toBe(10);
    // X reads 0 at machine X10, so G0 X5 ends at machine X15.
    expect(en.end.machine.X).toBe(15);

    const tg = analyse(fixture('cam/13-g10-l20.nc'), TINYG_440, { start: st }).analysis;
    expect(tg.blocked).toBe(true);
    expect(rules(tg)).toContain('l-word');
  });
});

describe('TB-02 acceptance: dialect data drives the interpreter', () => {


  it('TG: the interpreter itself refuses G10 L20 (never applies L20 or L2 semantics)', () => {
    const a = interpretJob(unchecked(['G10 L20 P1 X0', 'G0 X5'], TINYG_440), TINYG_440, { start: start({ X: 10 }) });
    const f = a.findings.find((x) => x.rule === 'l-word');
    expect(f).toMatchObject({ severity: 'block', source: 'analyser', line: 1 });
    expect(f?.message).toMatch(/no G10 L20/);
    expect(a.end.wcsOffsets.G54.X).toBe(0);
    expect((a.lineFlags[0] as number) & LINE_FLAG.NOT_DRAWN).toBeTruthy();
    // On EN the same lines are applied as L20.
    const en = interpretJob(unchecked(['G10 L20 P1 X0', 'G0 X5'], TINYG_EN), TINYG_EN, { start: start({ X: 10 }) });
    expect(en.blocked).toBe(false);
    expect(en.end.wcsOffsets.G54.X).toBe(10);
  });
});

describe('TB-02 acceptance: dialect data drives the interpreter', () => {


  it('EN draws the E029 fixture G18 arc per the standard: G2 X2 Z0 I1 K0.75 dips to Z-0.5', () => {
    const { analysis: a } = analyse(fixture('cam/12-g18-arc.nc'), TINYG_EN);
    expect(a.blocked).toBe(false);
    expect(a.stats.arcs).toBe(1);
    expect(a.bounds?.min[2]).toBeCloseTo(-0.5, 9);
    expect(a.bounds?.max[2]).toBeCloseTo(0, 9);
    const zs = points(a).map((p) => p[2]);
    expect(Math.min(...zs)).toBeCloseTo(-0.5, 2);
    expect(Math.max(...zs)).toBeLessThan(1e-6);
    expect(a.end.machine.X).toBe(2);
  });
});

describe('TB-02 acceptance: dialect data drives the interpreter', () => {


  it('TG: a G18 arc is blocked, by the sanitiser and by the interpreter itself, and never drawn', () => {
    const { analysis: tg } = analyse(fixture('cam/12-g18-arc.nc'), TINYG_440);
    expect(rules(tg)).toContain('g18-arc');
    expect(tg.stats.arcs).toBe(0);

    const a = interpretJob(unchecked(['G18 G91 G2 X2 Z0 I1 K0.75 F120'], TINYG_440), TINYG_440, { start: start() });
    expect(a.findings.filter((f) => f.source === 'analyser' && f.severity === 'block').map((f) => f.rule)).toEqual(['g18-arc']);
    expect([...a.kinds].some((k) => (k & 0x7f) === KIND.ARC)).toBe(false);
    expect((a.lineFlags[0] as number) & LINE_FLAG.NOT_DRAWN).toBeTruthy();
    // The position still follows the end point, which is direction-independent.
    expect(a.end.machine.X).toBe(2);
  });
});

describe('TB-02 acceptance: dialect data drives the interpreter', () => {


  it('a mid-file M30 blocks on EN and warns on TG', () => {
    const en = analyse(fixture('cam/14-mid-file-m30.nc'), TINYG_EN).analysis;
    expect(en.findings.filter((f) => f.rule === 'mid-file-program-end').map((f) => [f.line, f.severity])).toEqual([[3, 'block']]);
    const tg = analyse(fixture('cam/14-mid-file-m30.nc'), TINYG_440).analysis;
    expect(tg.blocked).toBe(false);
    expect(tg.findings.filter((f) => f.rule === 'mid-file-program-end').map((f) => [f.line, f.severity])).toEqual([[3, 'warn']]);
    // The interpreter applies the same data on its own.
    for (const [d, sev] of [[TINYG_EN, 'block'], [TINYG_440, 'warn']] as const) {
      const a = interpretJob(unchecked(['G0 X1', 'M30', 'G0 X2', 'M30'], d), d, { start: start() });
      expect(a.findings.filter((f) => f.rule === 'mid-file-program-end').map((f) => [f.line, f.severity, f.source])).toEqual([[2, sev, 'analyser']]);
    }
  });
});

describe('TB-02 acceptance: dialect data drives the interpreter', () => {


  it('M201.3 is blocked on EN', () => {
    expect(rules(analyse(fixture('cam/15-m201-3.nc'), TINYG_EN).analysis)).toContain('m201.3');
    const a = interpretJob(unchecked(['M201.3 X1000', 'G0 X1'], TINYG_EN), TINYG_EN, { start: start() });
    expect(a.findings.map((f) => [f.rule, f.severity, f.source])).toContainEqual(['m201.3', 'block', 'analyser']);
  });
});

describe('TB-02 acceptance: dialect data drives the interpreter', () => {


  it('"S1000 T1 M6 M3 M8 G4 P1" is blocked on TG (E088), also with C14', () => {
    const tg = analyse(fixture('cam/16-e088-queued.nc'), TINYG_440, { sanitize: { c14: true } }).analysis;
    expect(rules(tg)).toEqual(['e088-queued-per-line']);
    const a = interpretJob(unchecked(['S1000 T1 M6 M3 M8 G4 P1'], TINYG_440), TINYG_440, { start: start() });
    expect(a.findings.filter((f) => f.severity === 'block').map((f) => [f.rule, f.source])).toEqual([['e088-queued-per-line', 'analyser']]);
    expect(analyse(fixture('cam/16-e088-queued.nc'), TINYG_EN, { sanitize: { c14: true } }).analysis.blocked).toBe(false);
  });
});

describe('TB-02 acceptance: dialect data drives the interpreter', () => {


  it('TG: G28/G30 under G20 or G91 is blocked by the interpreter with that line\'s modes', () => {
    const a = interpretJob(unchecked(['G91 G28 Z0'], TINYG_440), TINYG_440, { start: start() });
    expect(rules(a)).toEqual(['g28-g30-g20-g91']);
    expect(interpretJob(unchecked(['G90 G28 Z0'], TINYG_440), TINYG_440, { start: start() }).blocked).toBe(false);
  });
});

describe('TB-02 acceptance: dialect data drives the interpreter', () => {


  it('a read-only dialect, or lines sanitised for another dialect, are never interpreted', () => {
    const ro = analyse('G0 X1', TINYG_449_STOCK).analysis;
    expect(ro.blocked).toBe(true);
    expect(ro.vertices.length).toBe(0);
    const { sanitized } = analyse('G90 G21\nG0 X1', TINYG_EN);
    const mismatch = interpretJob(sanitized, TINYG_440, { start: start() });
    expect(rules(mismatch)).toEqual(['dialect-mismatch']);
    expect(mismatch.vertices.length).toBe(0);
  });
});
