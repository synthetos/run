/**
 * Codex P0-10 #1 and #2 (batch 13; still open at the 89e2b5f fix
 * verification): arc coincidence decided with each dialect's own float32
 * rule, and absolute arc endpoints never invented.
 *
 * Source, read with `git show` only:
 * - EN ead63997 plan_arc.c:320-350: a centre-format arc whose end point is
 *   fp_EQ to the start on BOTH plane axes (machine coordinates, float32) is a
 *   full circle in its direction; otherwise the atan2 travel decides, and a
 *   travel that is fp_ZERO alarms 159. util.h:134-139: fp_EQ(a,b) is
 *   fabs(a-b) < (float)0.00001.
 * - TG d041839 plan_arc.c:276-303: equal ANGLES (fp_EQ) are zero angular
 *   travel, plus P turns by direction; :165-167 refuses a zero-length arc.
 * - Both: radius arcs with fp_EQ X, Y and Z end points are refused; a radius
 *   arc whose plane end points coincide divides by zero (plan_arc.c, the
 *   `_compute_arc_offsets_from_radius` hypotf(x, y) divisor).
 *
 * The firmware-model cross-check (the same lines run on the corrected
 * test-kit models) is packages/safety/test/arc-models.test.ts.
 */
import { TINYG_440, TINYG_EN } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { overrunBound } from '../src/overrun.ts';
import { lexLine } from '../src/sanitize/lex.ts';
import type { StartState } from '../src/index.ts';
import { blocks, bodies, run, START } from './sanitizeHelpers.ts';

const EN = TINYG_EN;
const TG = TINYG_440;
const CIRCLE_R10 = 2 * Math.PI * 10;

/** START with some fields left out (unknown). */
function without(...keys: (keyof StartState)[]): StartState {
  const s: Record<string, unknown> = { ...START };
  for (const k of keys) delete s[k];
  return s as StartState;
}

function at(x: number, y: number, z = 0): StartState {
  return { ...START, machine: { X: x, Y: y, Z: z, A: 0, B: 0, C: 0 } };
}

function words(body: string): Map<string, number> {
  const lexed = lexLine(body);
  if (lexed.kind !== 'ok') throw new Error(body);
  return new Map(lexed.words.filter((w) => w.letter !== 'G' && w.letter !== 'M').map((w) => [w.letter, w.value]));
}

describe('P0-10 #1: centre-format coincidence follows the dialect fp_EQ rule', () => {
  it('EN: G3/G2 X0.000001 Y0 I0 J10 is a full circle (Codex repro), split, with a true bound', () => {
    for (const code of ['G3', 'G2']) {
      const r = run(`${code} X0.000001 Y0 I0 J10 F100\n`, EN);
      expect(r.report.blocked, code).toBe(false);
      expect(r.report.splits).toHaveLength(1);
      const bound = overrunBound(r.lines).mmUpperBound;
      expect(bound).toBeGreaterThan(CIRCLE_R10 - 0.01);
      expect(bound).toBeLessThan(CIRCLE_R10 + 0.01);
      // Half way round, the circle about (0, 10) passes (0, 20).
      expect(r.lines.some((l) => Math.abs((words(l.body).get('Y') ?? 0) - 20) < 0.01)).toBe(true);
      expect(r.lines.at(-1)?.body).toMatch(new RegExp(`^${code} X0.000001 Y0 I`));
    }
  });

  it('EN: away from the branch cut a 0.000001 mm end point is still a full circle', () => {
    const r = run('G2 X0 Y-0.000001 I-10 J0 F100\n', EN);
    expect(r.report.blocked).toBe(false);
    expect(overrunBound(r.lines).mmUpperBound).toBeGreaterThan(CIRCLE_R10 - 0.01);
  });

  it('EN: P turns are added to the coincident full circle', () => {
    const r = run('G2 X0 Y-0.000001 I-10 J0 P1 F100\n', EN);
    expect(r.report.blocked).toBe(false);
    expect(overrunBound(r.lines).mmUpperBound).toBeGreaterThan(2 * CIRCLE_R10 - 0.01);
  });

  it('EN: a coincident-in-float32 end point at X1000 cannot be decided from double precision: blocked', () => {
    // f32(1000.00003) === 1000, so the firmware runs a full circle; double sees 0.00003 mm (> EPSILON).
    const r = run('G3 X1000.00003 Y0 I0 J10 F100\n', EN, { start: at(1000, 0) });
    expect(r.report.blocked).toBe(true);
    expect(blocks(r)).toContain('arc-ambiguous');
  });

  it('EN: just outside fp_EQ the travel is ~1.1e-6 rad, which the firmware alarms on: blocked', () => {
    const r = run('G3 X0.000011 Y0 I0 J10 F100\n', EN);
    expect(blocks(r)).toContain('arc-ambiguous');
  });

  it('EN: a 0.0002 mm end point with real angular travel stays a tiny arc (contrast)', () => {
    const r = run('G3 X0.0002 Y0 I0 J10 F100\n', EN);
    expect(r.report.blocked).toBe(false);
    expect(overrunBound(r.lines).mmUpperBound).toBeLessThan(0.001);
    expect(bodies(r)).toEqual(['G3 X0.0002 Y0 I0 J10 F100']);
  });

  it('TG: equal angles are zero travel: a 0.000001 mm end point is refused, not run as an arc', () => {
    for (const code of ['G2', 'G3']) {
      const r = run(`${code} X0 Y-0.000001 I-10 J0 F100\n`, TG);
      expect(r.report.blocked, code).toBe(true);
      expect(r.lines.filter((l) => l.motion !== null && l.motion.plannerLength > 0)).toHaveLength(0);
    }
  });

  it('TG: equal angles with P1 travel exactly one turn (EN runs two: full circle plus P1)', () => {
    const tg = run('G2 X0 Y-0.000001 I-10 J0 P1 F100\n', TG);
    expect(tg.report.blocked).toBe(false);
    const b = overrunBound(tg.lines).mmUpperBound;
    expect(b).toBeGreaterThan(CIRCLE_R10 - 0.01);
    expect(b).toBeLessThan(CIRCLE_R10 + 0.01);
  });

  it('TG: at the atan2 branch cut (I0 J10) a near-coincident end point is blocked as ambiguous', () => {
    for (const body of ['G3 X0.000001 Y0 I0 J10 F100', 'G2 X0 Y0 I0 J10 F100', 'G3 X0 Y0 I0 J10 F100']) {
      expect(blocks(run(`${body}\n`, TG)), body).toContain('arc-ambiguous');
    }
  });

  it('R format: end points that coincide in the plane (in float32) are blocked on both dialects', () => {
    for (const d of [EN, TG]) {
      expect(run('G2 X0.000001 Y0 Z1 R10 F100\n', d).report.blocked).toBe(true);
      expect(run('G2 X1000.00003 Y0 R10 F100\n', d, { start: at(1000, 0) }).report.blocked).toBe(true);
    }
  });

  it('R format: a chord too short to place the centre in float32 is blocked; a clear chord is not', () => {
    for (const d of [EN, TG]) {
      // At X1000 the position error band is ~0.001 mm, so a 0.05 mm chord could turn the centre.
      expect(blocks(run('G2 X1000.05 Y0 R10 F100\n', d, { start: at(1000, 0) }))).toEqual(['arc-ambiguous']);
      expect(run('G2 X1001 Y0 R10 F100\n', d, { start: at(1000, 0) }).report.blocked).toBe(false);
    }
  });

  it('sub-arcs are re-checked with the same rule: a large-radius arc whose pieces fall in the angle band cannot be split', () => {
    // r = 2000, 0.05 mm of travel (2.5e-5 rad) is clear of the band; three pieces of 8.3e-6 rad are not.
    expect(run('G3 X0.05 Y0.000000625 I0 J2000 F100\n', EN).report.blocked).toBe(false);
    expect(blocks(run('G3 X0.05 Y0.000000625 I0 J2000 F0.5\n', EN))).toEqual(['split-impossible']);
  });

  it('the machine position is needed to bound float32 rounding of an arc', () => {
    const r = run('G91 G2 X0.000001 Y0 I0 J10 F100\n', EN, { start: without('machine') });
    expect(r.report.blocked).toBe(true);
  });
});

describe('P0-10 #2: full circles and split arcs never invent absolute coordinates', () => {
  it('Codex repro: G2 I10 with the machine position unknown is blocked, not split around (0, 0)', () => {
    const r = run('G2 I10 F100\n', EN, { start: without('machine') });
    expect(r.report.blocked).toBe(true);
    expect(blocks(r)).toContain('unknown-state');
    expect(r.lines.filter((l) => l.motion !== null)).toHaveLength(0);
  });

  it('an absolute full circle needs the start of BOTH plane axes, unsplit too', () => {
    for (const [machine, body] of [
      [{ X: 0, Z: 0 }, 'G2 I10 F100'],
      [{ Y: 0, Z: 0 }, 'G2 I10 F100'],
      [{ X: 0, Z: 0 }, 'G2 I10 F100000'],
      [{ X: 0, Y: 0 }, 'G2 I10 Z-1 F100'],
    ] as const) {
      const r = run(`${body}\n`, EN, { start: { ...START, machine } });
      expect(r.report.blocked, `${JSON.stringify(machine)} ${body}`).toBe(true);
    }
    // Machine position known, but the G54 Y offset (so the work start of Y) unknown: still blocked, even unsplit.
    for (const d of [EN, TG]) {
      const start = { ...START, wcsOffsets: { ...START.wcsOffsets, G54: { X: 0, Z: 0, A: 0, B: 0, C: 0 } } };
      const r = run('G2 I10 F100000\n', d, { start });
      expect(blocks(r)).toEqual(['unknown-state']);
      expect(r.report.entries[0]?.message).toContain('absolute full circle');
      // Incremental, the same circle needs no absolute start.
      expect(run('G91 G2 I10 F100000\n', d, { start }).report.blocked).toBe(false);
    }
  });

  it('a split absolute arc with one plane word needs the start of the omitted axis', () => {
    const r = run('G2 X20 I10 F100\n', EN, { start: { ...START, machine: { X: 0, Z: 0 } } });
    expect(r.report.blocked).toBe(true);
    expect(blocks(r)).toContain('unknown-state');
    // Machine Y known but the G54 Y offset not: the work start of Y is unknown, and the split would have to write it.
    const g54 = { X: 0, Z: 0, A: 0, B: 0, C: 0 };
    const offsetUnknown = run('G2 X20 I10 F100\n', EN, { start: { ...START, wcsOffsets: { ...START.wcsOffsets, G54: g54 } } });
    expect(blocks(offsetUnknown)).toEqual(['unknown-state']);
    expect(offsetUnknown.report.entries[0]?.message).toContain('start position of Y is not known');
    // Unsplit, the same line is sent as written: no Y coordinate is synthesised.
    const fast = run('G2 X20 I10 F100000\n', EN, { start: { ...START, wcsOffsets: { ...START.wcsOffsets, G54: g54 } } });
    expect(bodies(fast)).toEqual(['G2 X20 I10 F100000']);
  });

  it('incremental full circles need no absolute start: sub-deltas add up to zero', () => {
    const start = { ...without('wcs', 'wcsOffsets'), machine: { X: 0, Y: 0, Z: 0 } };
    const r = run('G91 G2 I10 F100\n', EN, { start });
    expect(r.report.blocked).toBe(false);
    const split = r.lines.filter((l) => l.origin === 'split');
    expect(split.length).toBeGreaterThan(1);
    const sum = (k: string): number => split.reduce((s, l) => s + (words(l.body).get(k) ?? 0), 0);
    expect(sum('X')).toBeCloseTo(0, 9);
    expect(sum('Y')).toBeCloseTo(0, 9);
  });

  it('with work offsets, a helical full circle is written about the real work start (10, 0)', () => {
    // G54 = (5, 7, 1); machine (15, 7, 1) is work (10, 0, 0). The circle centre is work (20, 0).
    const off = { X: 5, Y: 7, Z: 1, A: 0, B: 0, C: 0 };
    const start: StartState = { ...START, machine: { X: 15, Y: 7, Z: 1, A: 0, B: 0, C: 0 }, wcsOffsets: { ...START.wcsOffsets, G54: off } };
    const r = run('G2 I10 Z-2 F100\n', EN, { start });
    expect(r.report.blocked).toBe(false);
    const split = r.lines.filter((l) => l.origin === 'split');
    expect(split.length).toBeGreaterThan(3);
    for (const l of split) {
      const w = words(l.body);
      expect(Math.hypot((w.get('X') as number) - 20, w.get('Y') as number), l.body).toBeCloseTo(10, 3);
    }
    expect(split.at(-1)?.body).toMatch(/^G2 X10 Y0 Z-2 I/);
    expect(overrunBound(r.lines).mmUpperBound).toBeCloseTo(Math.hypot(CIRCLE_R10, 2), 3);
  });
});
