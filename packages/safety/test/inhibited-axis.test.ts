/**
 * Finding: inhibited axis (rotary verifier, round 2). An inhibited axis
 * (am=2) is "computed but not activated": its position follows the program,
 * but the kinematics force its joint to 0 on every segment of every move
 * (@cite EN 93a723b8 kinematics.c:59; TG d041839 kinematics.c:63), and each
 * segment moves the motor by the difference of ABSOLUTE step targets
 * (@cite EN plan_exec.c:712-721; TG plan_exec.c:718-727). So an axis switched
 * to inhibited while its motor sits away from step 0 is driven back to step
 * 0 by the next move of ANY axis, while the overrun bound of that move
 * reported only the axes it names.
 *
 * Firmware facts for linear axes (@cite EN canonical_machine.c:510-523,
 * :2616-2629; TG canonical_machine.c:444-454, :1723-1732): a disabled X/Y/Z
 * ignores its word; INHIBITED is computed like STANDARD; radius mode is
 * refused by `cm_set_am` on a linear axis and, if present, its word is
 * ignored too.
 *
 * The firmware side of each case runs on the test-kit models (motor space:
 * `snapshot().motors`), the sanitiser side through `sanitizeJob` and
 * `overrunBound`, the production path.
 */
import { TINYG_440, TINYG_EN, type Dialect } from '@synthetos/protocol';
import { TinyG440Model, TinyGEdgeNextModel, createSim, type Sim } from '@synthetos/testkit';
import { describe, expect, it } from 'vitest';
import { overrunBound, type MotionModel, type StartState } from '../src/index.ts';
import { MOTION, START, blocks, run } from './sanitizeHelpers.ts';

type AnySim = Sim<TinyGEdgeNextModel> | Sim<TinyG440Model>;

const DIALECTS: readonly [string, Dialect, () => AnySim][] = [
  ['EN', TINYG_EN, () => createSim(new TinyGEdgeNextModel())],
  ['440.21', TINYG_440, () => createSim(new TinyG440Model())],
];

function send(sim: AnySim, line: string, ms = 60_000): void {
  sim.host.sendLine(line);
  sim.clock.advance(ms);
}

/** A value as the board prints it: three decimals (@cite EN config_app.c:166-171 `mpo`). */
const reported = (v: number): number => Number(v.toFixed(3));

function startFrom(sim: AnySim): StartState {
  const p = sim.device.snapshot().position;
  return { ...START, machine: { X: reported(p[0]), Y: reported(p[1]), Z: reported(p[2]), A: reported(p[3]), B: reported(p[4]), C: reported(p[5]) } };
}

const withA = (mode: 0 | 1 | 2 | 3): MotionModel => ({ ...MOTION, rotary: { ...MOTION.rotary, A: { mode } } });
const withLinear = (linear: MotionModel['linear']): MotionModel => ({ ...MOTION, linear: { ...MOTION.linear, ...linear } });

describe.each(DIALECTS)('an axis inhibited away from step 0 blocks motion (%s)', (_name, d, make) => {
  it('the reproduction: A standard at 30 degrees, then aam=2: the firmware turns A 30 degrees on G1 X1, so the job is blocked, not bounded at 1 mm', () => {
    const sim = make();
    send(sim, '{"aam":1}');
    send(sim, 'G90 G21 G0 A30');
    send(sim, '{"aam":2}');
    const start = startFrom(sim);
    expect(start.machine?.A).toBe(30);

    const r = run('G1 X1 F600\n', d, { motion: withA(2), start });
    expect(blocks(r)).toEqual(['inhibited-axis']);
    expect(r.report.entries[0]?.message).toContain('A (inhibited; it reads 30)');

    // What the board would have done with the line: the A motor goes 30 degrees to step 0.
    const before = sim.device.snapshot().motors[3];
    send(sim, 'G1 X1 F600');
    const after = sim.device.snapshot();
    expect(before).toBeCloseTo(30, 6);
    expect(after.motors[3]).toBe(0);
    expect(after.position[3]).toBeCloseTo(30, 6);
  });

  it('a linear axis: Y inhibited at 20 mm, an X-only move drives the Y motor 20 mm; the job is blocked', () => {
    const sim = make();
    send(sim, 'G90 G21 G0 Y20');
    send(sim, '{"yam":2}');
    const start = startFrom(sim);
    expect(blocks(run('G0 X5\n', d, { motion: withLinear({ Y: 2 }), start }))).toEqual(['inhibited-axis']);
    send(sim, 'G0 X5');
    expect(sim.device.snapshot().motors[1]).toBe(0);
    expect(sim.device.snapshot().position[1]).toBeCloseTo(20, 6);
  });

  it('every kind of motion line is blocked; lines that do not move are not', () => {
    const start: StartState = { ...START, machine: { ...START.machine, A: 12.5 } };
    const motion = withA(2);
    for (const line of ['G0 X1', 'G1 X1 F100', 'G2 X10 Y0 I5 F100', 'G28', 'G30', 'G53 G0 X1', 'G91 G0 Z-1', 'G0 A0']) {
      expect(blocks(run(`${line}\n`, d, { motion, start })), line).toContain('inhibited-axis');
    }
    const still = run('G4 P1\nG92 X0\nM3 S1000\nM5\nG21\n', d, { motion, start });
    expect(blocks(still)).toEqual([]);
  });

  it('every motion line of the file is blocked, since none of them would run', () => {
    const start: StartState = { ...START, machine: { ...START.machine, Z: -3 } };
    const r = run('G0 X1\nG0 X2\nG0 X3\n', d, { motion: withLinear({ Z: 2 }), start });
    expect(blocks(r)).toEqual(['inhibited-axis', 'inhibited-axis', 'inhibited-axis']);
    expect(r.report.blocked).toBe(true);
  });

  it('an inhibited axis whose position is not known is blocked', () => {
    const start: StartState = { ...START, machine: { X: 0, Y: 0, Z: 0, B: 0, C: 0 } };
    const r = run('G0 X1\n', d, { motion: withA(2), start });
    expect(blocks(r)).toEqual(['inhibited-axis']);
    expect(r.report.entries[0]?.message).toContain('A (inhibited; its position is not known)');
  });

  it('an axis of unknown mode away from 0 may be inhibited: blocked; one of known non-inhibited mode is not', () => {
    const away: StartState = { ...START, machine: { ...START.machine, B: 45, Z: -2 } };
    const unknownB: MotionModel = { ...MOTION, rotary: { A: { mode: 1 }, C: { mode: 1 } } };
    const r = run('G0 X1\n', d, { motion: unknownB, start: away });
    expect(blocks(r)).toEqual(['inhibited-axis']);
    expect(r.report.entries[0]?.message).toContain('B (axis mode not known, so it may be inhibited; it reads 45)');
    const unknownZ: MotionModel = { ...MOTION, linear: { X: 1, Y: 1 } };
    expect(blocks(run('G0 X1\n', d, { motion: unknownZ, start: away }))).toEqual(['inhibited-axis']);
    for (const mode of [0, 1, 3] as const) {
      expect(blocks(run('G0 X1\n', d, { motion: { ...MOTION, rotary: { ...MOTION.rotary, B: { mode, radiusMm: 10 } } }, start: away })), String(mode)).toEqual([]);
    }
    expect(blocks(run('G0 X1\n', d, { motion: withLinear({ Z: 0 }), start: away }))).toEqual([]);
  });
});

describe.each(DIALECTS)('an inhibited axis that reads 0 adds its rounding to every bound (%s)', (_name, d, make) => {
  it('Y inhibited, parked at 0.0004 (reads 0.000): the bound covers the 0.0004 mm the Y motor still moves', () => {
    const sim = make();
    send(sim, 'G90 G21 G0 Y0.0004');
    send(sim, '{"yam":2}');
    const start = startFrom(sim);
    expect(start.machine?.Y).toBe(0);
    const r = run('G0 X5\n', d, { motion: withLinear({ Y: 2 }), start });
    expect(r.report.blocked).toBe(false);
    const b = overrunBound(r.lines).mmUpperBound;

    const m0 = sim.device.snapshot().motors;
    send(sim, 'G0 X5');
    const m1 = sim.device.snapshot().motors;
    const travel = Math.abs((m1[0] as number) - (m0[0] as number)) + Math.abs((m1[1] as number) - (m0[1] as number));
    expect(Math.abs((m1[1] as number) - (m0[1] as number))).toBeGreaterThan(0.0003);
    expect(b).toBeGreaterThanOrEqual(travel);
    expect(b).toBeGreaterThan(5);
    expect(b).toBeLessThan(5.001);
  });

  it('each line and each split segment carries the residual', () => {
    const slow: MotionModel = { ...withLinear({ Z: 2 }), maxVelocity: { ...MOTION.maxVelocity, X: 600 }, feedrateMax: { ...MOTION.feedrateMax, X: 600 } };
    const r = run('G1 X100 F600\nG1 X0\n', d, { motion: slow });
    expect(r.report.blocked).toBe(false);
    const split = r.lines.filter((l) => l.origin === 'split');
    expect(split.length).toBeGreaterThan(2);
    for (const l of split) {
      const plain = l.motion?.plannerLength as number;
      expect(l.motion?.boundMm as number).toBeGreaterThan(plain);
    }
  });

  it('a rotary axis that is inhibited (or of unknown mode) and reads 0 makes the bound unknown: its rounding is degrees with no radius', () => {
    expect(overrunBound(run('G0 X5\n', d, { motion: withA(2) }).lines).mmUpperBound).toBe(Number.POSITIVE_INFINITY);
    expect(overrunBound(run('G0 X5\n', d, { motion: { ...MOTION, rotary: { A: { mode: 1 }, B: { mode: 1 } } } }).lines).mmUpperBound).toBe(Number.POSITIVE_INFINITY);
    // Controls: every axis of known non-inhibited mode, or the inhibited axis linear.
    expect(overrunBound(run('G0 X5\n', d, { motion: MOTION }).lines).mmUpperBound).toBe(5);
    expect(overrunBound(run('G0 X5\n', d, { motion: withA(0) }).lines).mmUpperBound).toBe(5);
  });

  it('moving the inhibited axis itself is accepted when it reads 0 (its position moves, its motor does not)', () => {
    const r = run('G0 Y10\nG0 X1 Y0\n', d, { motion: withLinear({ Y: 2 }) });
    expect(r.report.blocked).toBe(false);
    expect(r.lines.every((l) => (l.motion?.boundMm ?? 0) > 0)).toBe(true);
  });
});

describe.each(DIALECTS)('linear axis modes follow the firmware (%s)', (_name, d, make) => {
  it('a disabled linear axis ignores its word on the board, so a move naming it is blocked', () => {
    const sim = make();
    send(sim, '{"yam":0}');
    send(sim, 'G90 G21 G0 X1 Y5');
    expect(sim.device.snapshot().position[1]).toBe(0);
    for (const line of ['G0 Y5', 'G1 X1 Y5 F100', 'G2 X0 Y10 I0 J5 F100', 'G53 G0 Y1']) {
      expect(blocks(run(`${line}\n`, d, { motion: withLinear({ Y: 0 }) })), line).toEqual(['axis-mode']);
    }
    expect(run('G0 X1\n', d, { motion: withLinear({ Y: 0 }) }).report.blocked).toBe(false);
  });

  it('radius mode on a linear axis is refused by the board, and a move naming an axis that reads it is blocked', () => {
    const sim = make();
    sim.host.take();
    sim.host.sendLine('{"zam":3}');
    sim.clock.advance(50);
    expect(sim.host.take().join('\n')).toMatch(/"f":\[\d,109,/);
    const r = run('G0 Z-1\n', d, { motion: withLinear({ Z: 3 }) });
    expect(blocks(r)).toEqual(['axis-mode']);
    expect(r.report.entries[0]?.message).toContain('zam=3');
  });

  it('a linear axis of unknown mode: a move naming it cannot be modelled', () => {
    const r = run('G0 X1\n', d, { motion: { ...MOTION, linear: { Y: 1, Z: 1 } } });
    expect(blocks(r)).toEqual(['unknown-state']);
    expect(r.report.entries[0]?.message).toContain('xam');
  });

  it('G28/G30 are blocked while a linear axis is disabled, in radius mode or of unknown mode; inhibited and standard are modelled', () => {
    for (const linear of [{ Y: 0 }, { Z: 3 }] as const) {
      for (const g of ['G28', 'G30']) expect(blocks(run(`${g}\n`, d, { motion: withLinear(linear) })), `${g} ${JSON.stringify(linear)}`).toEqual(['axis-mode']);
    }
    expect(blocks(run('G28\n', d, { motion: { ...MOTION, linear: { X: 1, Y: 1 } } }))).toEqual(['axis-mode']);
    expect(run('G28\n', d, { motion: withLinear({ Y: 2 }) }).report.blocked).toBe(false);
  });

  it('an inhibited linear axis is computed like a standard one: the position moves and the bound counts it', () => {
    const sim = make();
    send(sim, '{"yam":2}');
    send(sim, 'G90 G21 G0 Y7');
    expect(sim.device.snapshot().position[1]).toBeCloseTo(7, 6);
    const r = run('G0 Y7\n', d, { motion: withLinear({ Y: 2 }) });
    expect(r.lines[0]?.motion?.plannerLength).toBe(7);
    expect(r.lines[0]?.motion?.boundMm as number).toBeGreaterThanOrEqual(7);
  });
});

describe('linear axis mode configuration is checked', () => {
  const bad = (motion: object): (() => unknown) => () => run('G0 X1\n', TINYG_EN, { motion: { ...MOTION, ...motion } as never });
  it('rejects a missing table, an unknown axis and an out-of-range mode, saying what is wrong', () => {
    for (const linear of [null, undefined, 'X']) expect(bad({ linear }), String(linear)).toThrow(/^linear axis modes must be given/);
    expect(bad({ linear: { A: 1 } })).toThrow(/^linear\.A is not a linear axis$/);
    expect(bad({ linear: { X: 4 } })).toThrow(/^linear\.X must be 0, 1, 2 or 3$/);
    expect(bad({ linear: { X: 1.5 } })).toThrow(/^linear\.X must be 0, 1, 2 or 3$/);
    expect(bad({ linear: {} })).not.toThrow();
  });
});
