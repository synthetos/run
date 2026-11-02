/**
 * P0-10 #3 (Codex, fix verification at 89e2b5f): the overrun distance is a
 * true upper bound in millimetres (SAFETY §4.3, H1), so it must never sum
 * rotary degrees as if they were millimetres.
 *
 * Firmware facts these tests rest on (read-only, pinned source):
 * - A rotary target is held in degrees. In radius mode (am=3) the program
 *   word is linear units, turned into degrees as
 *   `_to_millimeters(w) * 360 / (2π ra)` (@cite EN 97321391
 *   canonical_machine.c:491-496 `_calc_ABC`; TG d041839 canonical_machine.c:430-440).
 *   So one degree of travel on a radius-mode axis is `π ra / 180` mm of
 *   surface travel at the configured radius.
 * - In standard mode (am=1) the word is degrees and the board knows no
 *   physical radius, so degrees cannot be turned into a distance.
 * - A disabled axis (am=0) is skipped when the target is set (@cite EN
 *   canonical_machine.c:522-523; TG :457), so it does not move.
 * - An inhibited axis (am=2) has its absolute joint forced to 0 in the
 *   kinematics (@cite EN kinematics.c:59; TG kinematics.c:63), so a motor
 *   left away from 0 can move on a move of ANY axis; its travel is not
 *   bounded here (inhibited-axis.test.ts blocks that case).
 *
 * Every case goes through the production path: sanitizeJob, then
 * overrunBound on the lines the streamer would send.
 */
import { TINYG_440, TINYG_EN, type Dialect } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { overrunBound, type MotionModel, type StartState } from '../src/index.ts';
import { MOTION, START, run } from './sanitizeHelpers.ts';

const DIALECTS: readonly [string, Dialect][] = [
  ['EN', TINYG_EN],
  ['440.21', TINYG_440],
];

function rotary(rotaryCfg: MotionModel['rotary'], extra: Partial<MotionModel> = {}): MotionModel {
  return { ...MOTION, rotary: { ...MOTION.rotary, ...rotaryCfg }, ...extra };
}
const radiusA = (radiusMm: number): MotionModel => rotary({ A: { mode: 3, radiusMm } });

function bound(file: string, d: Dialect, motion: MotionModel, start: StartState = START): number {
  const r = run(file, d, { motion, start });
  expect(r.report.blocked, JSON.stringify(r.report.entries)).toBe(false);
  return overrunBound(r.lines).mmUpperBound;
}

describe.each(DIALECTS)('the overrun bound converts rotary travel with a known radius (%s)', (_name, d) => {
  it('Codex residual: ra = 1000, A0 -> G1 A10 is 10 mm of travel, not 0.573', () => {
    // Firmware target: 10 * 360 / (2π 1000) = 0.5729578 degrees; at ra = 1000 that is 10 mm.
    const b = bound('G21 G90\nG1 A10 F100\n', d, radiusA(1000));
    expect(b).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(b).toBeCloseTo(10, 9);
  });

  it('a radius above 180/π (ra = 100) and an incremental move', () => {
    expect(bound('G21 G91\nG0 A10\n', d, radiusA(100))).toBeCloseTo(10, 9);
    expect(bound('G21 G91\nG0 A-7.5\n', d, radiusA(180 / Math.PI + 1))).toBeCloseTo(7.5, 9);
  });

  it('the original radius = 1 case: live A = 10 degrees, G1 A10 travels 9.82547 mm', () => {
    // Target 10 * 360 / (2π) = 572.9578 degrees (EN canonical_machine.c:523-532); travel 562.9578 degrees.
    const start: StartState = { ...START, machine: { ...START.machine, A: 10 } };
    const travelDeg = (10 * 360) / (2 * Math.PI) - 10;
    const b = bound('G21 G90\nG1 A10 F100\n', d, radiusA(1), start);
    expect(b).toBeCloseTo((travelDeg * Math.PI) / 180, 9);
    expect(b).toBeCloseTo(9.82547, 5);
  });

  it('G20 radius-mode words are inches of surface travel', () => {
    expect(bound('G20 G91\nG0 A1\n', d, radiusA(1000))).toBeCloseTo(25.4, 9);
  });

  it('a rotary offset in degrees on a radius-mode axis converts at the radius', () => {
    // G92 A5 makes work A5 (degrees); G0 A0 is then a 5 degree move: 5 * π * 1000 / 180 mm.
    const r = run('G21\nG92 A5\nG90 G0 A0\n', d, { motion: radiusA(1000) });
    expect(r.report.blocked).toBe(false);
    expect(overrunBound(r.lines).mmUpperBound).toBeCloseTo((5 * Math.PI * 1000) / 180, 6);
  });

  it('mixed linear and rotary motion: never below the helical path, never sums degrees', () => {
    // X3 Y4 is 5 mm; A10 at ra = 1000 is 10 mm of surface travel. The true path of a point at the
    // radius lies between hypot(5, 10) and 5 + 10, and the bound must not be ~5.03 (degrees as mm).
    const b = bound('G21 G91\nG1 X3 Y4 A10 F600\n', d, radiusA(1000));
    expect(b).toBeGreaterThanOrEqual(Math.hypot(5, 10));
    expect(b).toBeCloseTo(15, 9);
    // Two radius-mode axes add: A10 at ra 1000 and B20 at ra 50.
    const two = rotary({ A: { mode: 3, radiusMm: 1000 }, B: { mode: 3, radiusMm: 50 } });
    expect(bound('G21 G91\nG1 X3 Y4 A10 B20 F600\n', d, two)).toBeCloseTo(5 + 10 + 20, 9);
  });

  it('a long radius-mode move that is split still bounds every segment in mm', () => {
    const slow = rotary({ A: { mode: 3, radiusMm: 1000 } }, { maxVelocity: { ...MOTION.maxVelocity, A: 60, X: 60 } });
    const r = run('G21 G91\nG0 X10 A100\n', d, { motion: slow });
    expect(r.report.blocked).toBe(false);
    expect(r.lines.filter((l) => l.origin === 'split').length).toBeGreaterThan(1);
    // The segments add back to 10 mm of X and 100 mm of A surface travel.
    expect(overrunBound(r.lines).mmUpperBound).toBeCloseTo(110, 3);
    expect(overrunBound(r.lines).mmUpperBound).toBeGreaterThanOrEqual(Math.hypot(10, 100));
  });
});

describe.each(DIALECTS)('rotary travel with no known radius is reported unknown, never as mm (%s)', (_name, d) => {
  it('a standard-mode rotary move has no finite mm bound, alone or with linear motion', () => {
    expect(bound('G21 G91\nG0 A10\n', d, MOTION)).toBe(Number.POSITIVE_INFINITY);
    expect(bound('G21 G91\nG1 X1 A10 F600\n', d, MOTION)).toBe(Number.POSITIVE_INFINITY);
    // The time estimate still exists.
    const r = run('G21 G91\nG0 A10\n', d, { motion: MOTION });
    expect(Number.isFinite(overrunBound(r.lines).secondsEstimate)).toBe(true);
  });

  it('a rotary axis with no conversion that does not move leaves the bound finite', () => {
    expect(bound('G21 G90\nG0 X5 A0\n', d, MOTION)).toBe(5);
    // A in radius mode with no known radius: an X move does not touch it.
    expect(bound('G21 G90\nG0 X5\n', d, { ...MOTION, rotary: { ...MOTION.rotary, A: { mode: 3 } } })).toBe(5);
    // B and C with no known mode may be inhibited, and an X move drives an inhibited motor to step 0
    // (finding: inhibited axis). Reading 0 they are within 0.0005 degrees of it, which has no mm value
    // without a radius, so the bound is unknown, not 5.
    expect(bound('G21 G90\nG0 X5\n', d, { ...MOTION, rotary: { A: { mode: 3 } } })).toBe(Number.POSITIVE_INFINITY);
  });

  it('a standard-mode split move is unknown too', () => {
    const slow = { ...MOTION, maxVelocity: { ...MOTION.maxVelocity, A: 60 } };
    const r = run('G21 G91\nG0 A100\n', d, { motion: slow });
    expect(r.lines.filter((l) => l.origin === 'split').length).toBeGreaterThan(1);
    expect(overrunBound(r.lines).mmUpperBound).toBe(Number.POSITIVE_INFINITY);
  });

  it('an inhibited axis is unknown; a disabled axis adds nothing', () => {
    expect(bound('G21 G91\nG0 X2 A10\n', d, rotary({ A: { mode: 2 } }))).toBe(Number.POSITIVE_INFINITY);
    expect(bound('G21 G91\nG0 X2 A10\n', d, rotary({ A: { mode: 0 } }))).toBe(2);
  });

  it('G28 returning a standard-mode rotary axis is unknown; with A already there it is finite', () => {
    const away: StartState = { ...START, machine: { ...START.machine, A: 30 } };
    expect(bound('G28\n', d, MOTION, away)).toBe(Number.POSITIVE_INFINITY);
    const atX: StartState = { ...START, machine: { ...START.machine, X: 4 } };
    expect(bound('G28\n', d, MOTION, atX)).toBe(4);
  });
});
