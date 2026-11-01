/**
 * T-S64 (ROADMAP P0-10, SAFETY §4.7 step 6a): long-move splitting.
 * - no sanitised line has a modelled duration above the ceiling;
 * - the split path equals the original path within tolerance, for lines
 *   and arcs, G90 and G91, mm and inch.
 *
 * The path check re-reads the sent lines with a small interpreter written
 * here, independent of the sanitiser's own model.
 */
import fc from 'fast-check';
import { TINYG_440, TINYG_EN } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { lexLine } from '../src/sanitize/lex.ts';
import { sanitizeJob, type MotionModel, type SentLine, type StartState } from '../src/index.ts';
import { STANDARD_LINEAR, STANDARD_ROTARY, START, runs } from './sanitizeHelpers.ts';

/** Slow axes so that ordinary moves need splitting. */
const SLOW: MotionModel = { ceilingSeconds: 2, k: 0.5, maxVelocity: { X: 900, Y: 1200, Z: 600, A: 3600, B: 3600, C: 3600 }, feedrateMax: { X: 900, Y: 1200, Z: 600, A: 3600, B: 3600, C: 3600 }, rotary: STANDARD_ROTARY, linear: STANDARD_LINEAR };

const TOL_MM = 0.002;

interface Pt {
  x: number;
  y: number;
  z: number;
}

function startAt(p: Pt): StartState {
  return { ...START, machine: { X: p.x, Y: p.y, Z: p.z, A: 0, B: 0, C: 0 } };
}

function words(body: string): Map<string, number> {
  const lexed = lexLine(body);
  if (lexed.kind !== 'ok') throw new Error(body);
  const m = new Map<string, number>();
  for (const w of lexed.words) m.set(w.letter === 'G' || w.letter === 'M' ? `${w.letter}${w.value}` : w.letter, w.value);
  return m;
}

/** Re-reads sent lines: returns each motion line's start, end (mm) and arc centre (mm), in work coordinates. */
function trace(lines: readonly SentLine[], start: Pt, units: 'mm' | 'in', absolute: boolean) {
  const s = units === 'in' ? 25.4 : 1;
  let abs = absolute;
  let pos = { ...start };
  const out: { from: Pt; to: Pt; centre: Pt | null; cw: boolean; line: SentLine }[] = [];
  let mode = 0;
  for (const l of lines) {
    const w = words(l.body);
    if (w.has('G90')) abs = true;
    if (w.has('G91')) abs = false;
    for (const g of [0, 1, 2, 3]) if (w.has(`G${g}`)) mode = g;
    if (!['X', 'Y', 'Z'].some((a) => w.has(a))) continue;
    const axis = (a: 'X' | 'Y' | 'Z', cur: number): number => {
      const v = w.get(a);
      if (v === undefined) return cur;
      return abs ? v * s : cur + v * s;
    };
    const to = { x: axis('X', pos.x), y: axis('Y', pos.y), z: axis('Z', pos.z) };
    const centre = mode >= 2 ? { x: pos.x + (w.get('I') ?? 0) * s, y: pos.y + (w.get('J') ?? 0) * s, z: 0 } : null;
    out.push({ from: pos, to, centre, cw: mode === 2, line: l });
    pos = to;
  }
  return out;
}

const fmt = (v: number, d: number): string => v.toFixed(d);

describe('T-S64: long moves are split within the ceiling, on the original path', () => {
  const lineCase = fc.record({
    inch: fc.boolean(),
    absolute: fc.boolean(),
    rapid: fc.boolean(),
    start: fc.record({ x: fc.integer({ min: -100, max: 100 }), y: fc.integer({ min: -100, max: 100 }), z: fc.integer({ min: -20, max: 20 }) }),
    d: fc.record({
      x: fc.double({ min: -400, max: 400, noNaN: true }),
      y: fc.double({ min: -400, max: 400, noNaN: true }),
      z: fc.double({ min: -50, max: 50, noNaN: true }),
    }),
    feed: fc.integer({ min: 30, max: 3000 }),
  });

  it('straight moves: G0/G1, G90/G91, mm/inch', () => {
    fc.assert(
      fc.property(lineCase, (c) => {
        const s = c.inch ? 25.4 : 1;
        const dec = c.inch ? 5 : 3;
        const target = { x: c.start.x + c.d.x, y: c.start.y + c.d.y, z: c.start.z + c.d.z };
        const value = (a: 'x' | 'y' | 'z'): string => fmt((c.absolute ? target[a] : c.d[a]) / s, dec);
        const header = `${c.inch ? 'G20' : 'G21'} ${c.absolute ? 'G90' : 'G91'}`;
        const move = `${c.rapid ? 'G0' : 'G1'} X${value('x')} Y${value('y')} Z${value('z')}${c.rapid ? '' : ` F${fmt(c.feed / s, 4)}`}`;
        for (const d of [TINYG_EN, TINYG_440]) {
          const r = sanitizeJob(`${header}\n${move}\n`, d, { motion: SLOW, start: startAt(c.start) });
          expect(r.report.blocked, JSON.stringify(r.report.entries)).toBe(false);
          for (const l of r.lines) expect(l.motion?.seconds ?? 0).toBeLessThanOrEqual(SLOW.ceilingSeconds);
          const segs = trace(r.lines, c.start, c.inch ? 'in' : 'mm', true);
          // The written target, as the firmware will read it.
          const exact = segs.at(-1)?.to as Pt;
          const len = Math.hypot(exact.x - c.start.x, exact.y - c.start.y, exact.z - c.start.z);
          let lastT = 0;
          for (const seg of segs) {
            // Every endpoint on the original segment, in order.
            const t = len === 0 ? 1 : ((seg.to.x - c.start.x) * (exact.x - c.start.x) + (seg.to.y - c.start.y) * (exact.y - c.start.y) + (seg.to.z - c.start.z) * (exact.z - c.start.z)) / (len * len);
            const px = c.start.x + t * (exact.x - c.start.x);
            const py = c.start.y + t * (exact.y - c.start.y);
            const pz = c.start.z + t * (exact.z - c.start.z);
            expect(Math.hypot(seg.to.x - px, seg.to.y - py, seg.to.z - pz)).toBeLessThan(TOL_MM);
            expect(t).toBeGreaterThan(lastT - 1e-9);
            lastT = t;
          }
          expect(lastT).toBeCloseTo(1, 9);
          expect(Math.hypot(exact.x - target.x, exact.y - target.y, exact.z - target.z)).toBeLessThan(s * 10 ** -dec);
          if (r.lines.filter((l) => l.motion !== null).length > 1) {
            expect(r.report.splits).toHaveLength(1);
            expect(r.lines.filter((l) => l.origin === 'split').length).toBe(r.report.splits[0]?.segments);
          }
        }
      }),
      { numRuns: runs(300) },
    );
  });

  const arcCase = fc.record({
    inch: fc.boolean(),
    absolute: fc.boolean(),
    cw: fc.boolean(),
    start: fc.record({ x: fc.integer({ min: -100, max: 100 }), y: fc.integer({ min: -100, max: 100 }) }),
    radius: fc.double({ min: 2, max: 150, noNaN: true }),
    phase: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
    sweep: fc.double({ min: 0.2, max: 2 * Math.PI - 0.2, noNaN: true }),
    dz: fc.double({ min: -10, max: 10, noNaN: true }),
    feed: fc.integer({ min: 30, max: 2000 }),
  });

  it('arcs and helices: G2/G3, G90/G91, mm/inch, sub-arcs on the original circle', () => {
    fc.assert(
      fc.property(arcCase, (c) => {
        const s = c.inch ? 25.4 : 1;
        const dec = c.inch ? 5 : 4;
        // Centre so that the start lies on the circle at angle `phase`; end `sweep` further in the arc direction.
        const cx = c.start.x - c.radius * Math.cos(c.phase);
        const cy = c.start.y - c.radius * Math.sin(c.phase);
        const endAngle = c.phase + (c.cw ? -c.sweep : c.sweep);
        const target = { x: cx + c.radius * Math.cos(endAngle), y: cy + c.radius * Math.sin(endAngle), z: c.dz };
        const v = (val: number): string => fmt(val / s, dec);
        const xy = c.absolute ? `X${v(target.x)} Y${v(target.y)}` : `X${v(target.x - c.start.x)} Y${v(target.y - c.start.y)}`;
        const z = c.absolute ? `Z${v(target.z)}` : `Z${v(c.dz)}`;
        const file = `${c.inch ? 'G20' : 'G21'} ${c.absolute ? 'G90' : 'G91'} G17\n${c.cw ? 'G2' : 'G3'} ${xy} ${z} I${v(cx - c.start.x)} J${v(cy - c.start.y)} F${fmt(c.feed / s, 4)}\n`;
        const start = { x: c.start.x, y: c.start.y, z: 0 };
        const r = sanitizeJob(file, TINYG_EN, { motion: SLOW, start: startAt(start) });
        fc.pre(!r.report.entries.some((e) => e.rule === 'malformed')); // rounding of the generated end point
        expect(r.report.blocked, JSON.stringify(r.report.entries)).toBe(false);
        for (const l of r.lines) expect(l.motion?.seconds ?? 0).toBeLessThanOrEqual(SLOW.ceilingSeconds);
        const segs = trace(r.lines, start, c.inch ? 'in' : 'mm', c.absolute);
        let swept = 0;
        for (const seg of segs) {
          const centre = seg.centre as Pt;
          // Every sub-arc is centred on the original centre and both its ends are on the original circle.
          expect(Math.hypot(centre.x - cx, centre.y - cy)).toBeLessThan(TOL_MM);
          expect(Math.abs(Math.hypot(seg.to.x - cx, seg.to.y - cy) - c.radius)).toBeLessThan(TOL_MM + 0.0001 * s);
          expect(seg.cw).toBe(c.cw);
          const a0 = Math.atan2(seg.from.y - cy, seg.from.x - cx);
          const a1 = Math.atan2(seg.to.y - cy, seg.to.x - cx);
          let d = a1 - a0;
          if (c.cw && d > 0) d -= 2 * Math.PI;
          if (!c.cw && d < 0) d += 2 * Math.PI;
          swept += Math.abs(d);
          // Helix: Z moves linearly with the swept angle. `swept` is measured from the rounded end point,
          // which can sit half a rounding step off per axis, so the angle read back is off by up to
          // that distance over the radius; Z inherits it scaled by the helix pitch |dz| / sweep.
          const angleReadErr = (0.5 * Math.SQRT2 * s * 10 ** -dec) / c.radius;
          expect(Math.abs(seg.to.z - (c.dz * swept) / c.sweep)).toBeLessThan(TOL_MM + 0.0001 * s + (Math.abs(c.dz) / c.sweep) * angleReadErr);
        }
        expect(swept).toBeCloseTo(c.sweep, 3);
      }),
      { numRuns: runs(300) },
    );
  });
});

describe('split details', () => {
  const motion: MotionModel = { ceilingSeconds: 2, k: 0.5, maxVelocity: { X: 600, Y: 600, Z: 600 }, feedrateMax: { X: 600, Y: 600, Z: 600 }, rotary: STANDARD_ROTARY, linear: STANDARD_LINEAR };

  it('a G1 at 600 mm/min that models 20 s becomes ten 2 s segments with the F on the first', () => {
    // 100 mm at min(F, vm) × k = 300 mm/min = 20 s; ten segments of 10 mm at the 2 s ceiling would sit exactly
    // on it, so the budget below the ceiling makes it eleven.
    const r = sanitizeJob('G1 X100 F600 M8\n', TINYG_EN, { motion, start: START, c22: true });
    const split = r.lines.filter((l) => l.origin === 'split');
    expect(split.length).toBe(11);
    expect(split[0]?.body).toBe('M8 F600 G1 X9.0909');
    expect(split.at(-1)?.body).toBe('G1 X100');
    expect(r.report.splits).toEqual([{ line: 1, segments: 11, seconds: 20 }]);
    expect(r.report.longestMoveSeconds).toBeLessThanOrEqual(2);
    expect(r.report.entries.find((e) => e.rule === 'split')?.message).toContain('11 segments');
  });

  it('program flow codes go on the last segment, so its barrier and holdback land there', () => {
    const r = sanitizeJob('G1 X100 F600 M0\nG1 X0 M30\n', TINYG_EN, { motion, start: START });
    const first = r.lines.filter((l) => l.sourceLine === 1);
    expect(first.at(-1)?.body).toBe('G1 X100 M0');
    expect(first.map((l) => l.barrier)).toEqual([...first.slice(1).map(() => false), true]);
    const second = r.lines.filter((l) => l.sourceLine === 2);
    expect(second.at(-1)?.body).toBe('G1 X0 M30');
    expect(r.lines.map((l) => l.holdback).lastIndexOf(true)).toBe(r.lines.length - 1);
    expect(r.lines.filter((l) => l.holdback)).toHaveLength(1);
  });

  it('G53 is repeated on every segment, in machine coordinates', () => {
    const start = { ...START, wcsOffsets: { ...START.wcsOffsets, G54: { X: 10, Y: 0, Z: 0, A: 0, B: 0, C: 0 } } };
    const r = sanitizeJob('G53 G0 X100\n', TINYG_EN, { motion, start });
    expect(r.report.blocked).toBe(false);
    expect(r.lines.every((l) => l.body.startsWith('G53 G0 X'))).toBe(true);
    expect(r.lines.at(-1)?.body).toBe('G53 G0 X100');
  });

  it('G91 sub-deltas add up exactly to the original delta', () => {
    const r = sanitizeJob('G91 G1 X-50.123456 F600\n', TINYG_EN, { motion, start: START });
    const deltas = r.lines.filter((l) => l.origin === 'split').map((l) => words(l.body).get('X') as number);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.reduce((a, b) => a + b, 0)).toBeCloseTo(-50.123456, 9);
  });

  it('an R-format arc is re-expressed as I/J, and a full circle with P turns is split into sub-arcs', () => {
    const r = sanitizeJob('G2 X40 Y0 R20 F600\nG3 I-10 P2 F600\n', TINYG_EN, { motion, start: START });
    expect(r.report.blocked).toBe(false);
    const arcs = r.lines.filter((l) => /G[23]/.test(l.body));
    expect(arcs.some((l) => /R/.test(l.body))).toBe(false);
    expect(arcs.filter((l) => l.sourceLine === 1).length).toBeGreaterThanOrEqual(2);
    // A centre-format full circle runs P turns (@cite EN plan_arc.c:200-212): two turns of r = 10 are at
    // least 8 quarter-turn sub-arcs, none with a P word.
    const circle = arcs.filter((l) => l.sourceLine === 2);
    expect(circle.length).toBeGreaterThanOrEqual(8);
    expect(circle.some((l) => /P/.test(l.body))).toBe(false);
    expect(circle.at(-1)?.body).toMatch(/^G3 X40 Y0 I/);
  });

  it('G90.1 (EN): I/J are written as the absolute centre on every sub-arc', () => {
    const r = sanitizeJob('G90.1 G2 X20 Y0 I10 J0 F600\n', TINYG_EN, { motion, start: START });
    expect(r.report.blocked).toBe(false);
    for (const l of r.lines.filter((x) => x.origin === 'split')) {
      expect(words(l.body).get('I')).toBe(10);
      expect(words(l.body).get('J')).toBe(0);
    }
  });

  it('G18 and G19 arcs are split in their own planes (EN)', () => {
    const g18 = sanitizeJob('G18 G2 X40 Z0 I20 K0 F600\n', TINYG_EN, { motion, start: START });
    expect(g18.report.blocked).toBe(false);
    expect(g18.lines.filter((l) => l.origin === 'split').every((l) => /G2 Z\S+ X\S+ K\S+ I\S+$/.test(l.body))).toBe(true);
    const g19 = sanitizeJob('G19 G3 Y40 Z0 J20 K0 F600\n', TINYG_EN, { motion, start: START });
    expect(g19.report.blocked).toBe(false);
    expect(g19.lines.filter((l) => l.origin === 'split').length).toBeGreaterThan(1);
  });

  it('rotary moves are split with 0.0001 degree endpoints', () => {
    const r = sanitizeJob('G0 A720.123456\n', TINYG_EN, { motion: { ...motion, maxVelocity: { A: 600 }, feedrateMax: { A: 600 } }, start: START });
    expect(r.report.blocked).toBe(false);
    const split = r.lines.filter((l) => l.origin === 'split');
    expect(split.length).toBeGreaterThan(1);
    expect(split[0]?.body).toMatch(/^G0 A\d+\.\d{1,4}$/);
    expect(split.at(-1)?.body).toBe('G0 A720.123456');
  });

  it('inch moves and arcs are split with 0.00001 in endpoints', () => {
    const lin = sanitizeJob('G20 G1 X10 F10\n', TINYG_EN, { motion, start: START });
    expect(lin.report.blocked).toBe(false);
    expect(lin.lines.filter((l) => l.origin === 'split').length).toBeGreaterThan(1);
    expect(lin.lines.some((l) => /X\d+\.\d{5}\b/.test(l.body))).toBe(true);
    const arc = sanitizeJob('G20 G2 X4 Y0 I2 F10\n', TINYG_EN, { motion, start: START });
    expect(arc.report.blocked).toBe(false);
    expect(arc.lines.filter((l) => l.origin === 'split').length).toBeGreaterThan(1);
  });

  it('helices carry the linear axis on every sub-arc, absolute and incremental', () => {
    for (const file of ['G2 X-100 Y0 Z-5 I-50 F600\n', 'G91 G2 X-100 Y0 Z-5 I-50 F600\n']) {
      const r = sanitizeJob(file, TINYG_EN, { motion, start: START });
      expect(r.report.blocked, file).toBe(false);
      const split = r.lines.filter((l) => l.origin === 'split');
      expect(split.length).toBeGreaterThan(1);
      expect(split.every((l) => / Z-?\d/.test(l.body))).toBe(true);
    }
    // The last sub-arc ends exactly at the target as written; clockwise from (0, 0) about (-50, 0) it arrives from below.
    const last = sanitizeJob('G2 X-100 Y0 Z-5 I-50 F600\n', TINYG_EN, { motion, start: START }).lines.at(-1)?.body ?? '';
    expect(last).toMatch(/^G2 X-100 Y0 Z-5 I\S+ J\S+$/);
    const j = Number(/J(\S+)/.exec(last)?.[1]);
    expect(j).toBeGreaterThan(0);
  });

  it('a move that would need sub-segments below the split tolerance is a block', () => {
    const crawl: MotionModel = { ceilingSeconds: 2, k: 0.5, maxVelocity: { X: 600 }, feedrateMax: { X: 600 }, rotary: STANDARD_ROTARY, linear: STANDARD_LINEAR };
    const r = sanitizeJob('G1 X1 F0.0001\n', TINYG_EN, { motion: crawl, start: START });
    expect(r.report.entries.map((e) => e.rule)).toContain('split-impossible');
    expect(r.lines.filter((l) => l.motion !== null)).toHaveLength(0);
  });

  it('a sub-segment too long for 120 bytes blocks its whole move', () => {
    const r = sanitizeJob(`G1 X100 F600 ${'S1'.padEnd(110, '0')}\n`, TINYG_EN, { motion, start: START });
    expect(r.report.entries.map((e) => e.rule)).toContain('split-impossible');
    expect(r.lines).toHaveLength(0);
  });

  it('G28 within the ceiling is one line; beyond it, a block (two moves in one block cannot be split)', () => {
    const fast: MotionModel = { ceilingSeconds: 5, k: 0.5, maxVelocity: { X: 20000, Y: 20000, Z: 20000, A: 20000, B: 20000, C: 20000 }, feedrateMax: { X: 20000, Y: 20000, Z: 20000, A: 20000, B: 20000, C: 20000 }, rotary: STANDARD_ROTARY, linear: STANDARD_LINEAR };
    const near = { ...START, g28: { X: 10, Y: 0, Z: 0, A: 0, B: 0, C: 0 } };
    const ok = sanitizeJob('G28 Z5\n', TINYG_EN, { motion: fast, start: near });
    expect(ok.report.blocked).toBe(false);
    expect(ok.lines[0]?.motion?.plannerLength).toBeCloseTo(5 + Math.hypot(10, 5), 9);
    const far = sanitizeJob('G28\n', TINYG_EN, { motion, start: { ...START, g28: { X: 500, Y: 0, Z: 0, A: 0, B: 0, C: 0 } } });
    expect(far.report.entries.map((e) => e.rule)).toEqual(['split-impossible']);
  });
});
