/**
 * Firmware semantics the sanitiser's fixes are checked against (independent review batch 14
 * and the 89e2b5f fix verification). Each case is derived from the pinned
 * firmware source, read with `git show` only:
 *
 * - arcs: EN 6ec70652 plan_arc.c:324-341 compares the center-format end point
 *   with the start point position by position (fp_EQ, util.h:134-139) and runs
 *   a full circle; :348-350 alarms on fp_ZERO angular travel. TG d0418390
 *   plan_arc.c:276-295 compares ANGLES with fp_EQ and treats equal angles as
 *   zero angular travel; :165-167 refuses a zero-length arc with 201.
 * - rotary axis modes: EN canonical_machine.c:495-536, TG :430-465; defaults
 *   from settings/settings_default.h (A is AXIS_RADIUS, B and C disabled).
 * - F before G20/G21 in one block: EN gcode_parser.c:634-636 before :656,
 *   TG gcode_parser.c:455 before :473; `_to_millimeters` reads the model's
 *   units (canonical_machine.h:42 EN, :47 TG).
 * - inhibited axes: EN kinematics.c:59 and TG kinematics.c:63 force the joint
 *   to 0; plan_exec.c (EN :707-716, TG :718-727) moves each motor by the
 *   difference between step targets; a step resync (planner.c, EN :187-201,
 *   TG :160-170) rewrites the targets and moves nothing.
 * - soft limits: EN canonical_machine.c:549-567, TG :480-498: fp_EQ(min,max)
 *   skips the axis, each end below DISABLE_SOFT_LIMIT (-1000000) is skipped,
 *   and every homed axis (X..C) is checked.
 *
 * Float32: the AVR build has 32-bit doubles, so these cases sit on float32
 * boundaries (EPSILON is (float)0.00001).
 */
import { describe, expect, it } from 'vitest';
import type { Sim } from '../src/simHost.ts';
import type { TinyGEdgeNextModel } from '../src/firmware/edgeNext.ts';
import type { TinyG440Model } from '../src/firmware/tg440.ts';
import { enSim, exceptions, get, statuses, tgSim } from './helpers.ts';

type AnySim = Sim<TinyGEdgeNextModel> | Sim<TinyG440Model>;

function send(sim: AnySim, line: string, ms = 30): number[] {
  sim.host.take();
  sim.host.sendLine(line);
  sim.clock.advance(ms);
  return statuses(sim.host.take());
}

/** Move to (x, y) in machine coordinates with G0 and wait for it. */
function park(sim: AnySim, x: number, y: number): void {
  expect(send(sim, `G90 G0 X${x} Y${y}`, 100_000)).toEqual([0]);
  expect(sim.device.snapshot().motionState).toBe('stop');
}

const MODELS = [
  ['edge-next', (): AnySim => enSim()],
  ['440.21', (): AnySim => tgSim()],
] as const;

// ---------------------------------------------------------------- arcs, edge-next

describe('edge-next arcs: center-format coincident end points (plan_arc.c:324-350)', () => {
  it('[EN-ARC-COINCIDENT] an end point 0.000001 mm from the start is a full circle (~62.83 mm), not a 0.000001 mm arc', () => {
    const sim = enSim();
    expect(send(sim, 'G3 X0.000001 Y0 I0 J10 F100')).toEqual([0]);
    // 62.83 mm at 100 mm/min is ~37.7 s; half way round a CCW circle about (0,10) is (0,20).
    sim.clock.advance(1000);
    expect(sim.device.snapshot().motionState).toBe('run');
    sim.clock.advance(18_850 - 1000);
    const mid = sim.device.snapshot().position;
    expect(mid[0]).toBeCloseTo(0, 0);
    expect(mid[1]).toBeCloseTo(20, 0);
    sim.clock.advance(20_000);
    expect(sim.device.snapshot().motionState).toBe('stop');
    expect(sim.device.snapshot().position[0]).toBeCloseTo(0, 5);
  });

  it('[EN-ARC-COINCIDENT] G2 with the same near-coincident end point is a full clockwise circle', () => {
    const sim = enSim();
    expect(send(sim, 'G2 X0.000001 Y0 I0 J10 F100')).toEqual([0]);
    sim.clock.advance(18_850);
    const mid = sim.device.snapshot().position;
    expect(mid[1]).toBeCloseTo(20, 0);
    expect(sim.device.snapshot().motionState).toBe('run');
  });

  it('[EN-ARC-COINCIDENT] coincidence is float32: X1000.00003 equals a start of X1000 (float32 ulp 6.1e-5)', () => {
    const sim = enSim();
    park(sim, 1000, 0);
    expect(send(sim, 'G3 X1000.00003 Y0 I0 J10 F100')).toEqual([0]);
    sim.clock.advance(18_850);
    expect(sim.device.snapshot().position[1]).toBeCloseTo(20, 0);
  });

  it('[EN-ARC-COINCIDENT] just outside fp_EQ the angle decides: G3 with 0.000011 mm and ~1.1e-6 rad travel alarms 159', () => {
    const sim = enSim();
    sim.host.sendLine('G3 X0.000011 Y0 I0 J10 F100');
    sim.clock.advance(30);
    const lines = sim.host.take();
    expect(statuses(lines)).toEqual([159]);
    expect(exceptions(lines).map((e) => e.st)).toEqual([159]);
    expect(sim.device.snapshot().machineState).toBe('alarm');
    expect(sim.device.snapshot().position[0]).toBe(0);
  });

  it('[EN-ARC-COINCIDENT] just outside fp_EQ, G2 wraps the tiny negative angle to an almost full clockwise circle', () => {
    const sim = enSim();
    expect(send(sim, 'G2 X0.000011 Y0 I0 J10 F100')).toEqual([0]);
    sim.clock.advance(18_850);
    expect(sim.device.snapshot().position[1]).toBeCloseTo(20, 0);
  });

  it('[EN-ARC-COINCIDENT] an end point 0.0002 mm away with real angular travel is a tiny arc (the contrast case)', () => {
    const sim = enSim();
    expect(send(sim, 'G3 X0.0002 Y0 I0 J10 F100', 1000)).toEqual([0]);
    expect(sim.device.snapshot().motionState).toBe('stop');
    expect(sim.device.snapshot().position[0]).toBeCloseTo(0.0002, 6);
  });

  it('[EN-ARC-COINCIDENT] I/J alone in modal G2 is a full circle; an axis word alone in modal G2 does nothing', () => {
    const sim = enSim();
    expect(send(sim, 'G2 X0 Y20 I0 J10 F600', 5000)).toEqual([0]);
    expect(sim.device.snapshot().position[1]).toBeCloseTo(20, 4);
    // plan_arc.c:127-131: no G2/G3 word, no offsets, no radius: STAT_OK and no motion.
    expect(send(sim, 'X5', 2000)).toEqual([0]);
    expect(sim.device.snapshot().position[0]).toBeCloseTo(0, 4);
    // Offsets with no plane end point: a full circle (plan_arc.c:166-174).
    expect(send(sim, 'I0 J-10', 100)).toEqual([0]);
    expect(sim.device.snapshot().motionState).toBe('run');
    sim.clock.advance(3092); // half of 62.83 mm at 600 mm/min after the 50 ms startup delay
    expect(sim.device.snapshot().position[1]).toBeCloseTo(0, 0);
  });

  it('[EN-ARC-COINCIDENT] away from the atan2 branch cut (centre to the left) a 0.000001 mm end point is still a full circle', () => {
    for (const code of ['G2', 'G3']) {
      const sim = enSim();
      expect(send(sim, `${code} X0 Y-0.000001 I-10 J0 F600`, 100)).toEqual([0]);
      sim.clock.advance(3092); // half of 62.83 mm at 600 mm/min: the far side of the circle about (-10,0)
      expect(sim.device.snapshot().position[0]).toBeCloseTo(-20, 0);
    }
  });

  it('[EN-ARC-COINCIDENT] G2 F100 alone only sets the motion mode (plan_arc.c:135-141)', () => {
    const sim = enSim();
    expect(send(sim, 'G2 F100')).toEqual([0]);
    expect(sim.device.snapshot().machineState).not.toBe('alarm');
    expect(sim.device.snapshot().motionState).toBe('stop');
  });

  it('[EN-ARC-COINCIDENT] P adds whole turns: P1 on a quarter arc travels 1.25 turns', () => {
    const sim = enSim();
    // quarter arc CW from (0,0) about (0,10) to (-10,10)... G2 increases θ: from θ=π to 3π/2 ends at (-10,10).
    expect(send(sim, 'G2 X-10 Y10 I0 J10 P1 F600')).toEqual([0]);
    // 1.25 turns of r=10 is 78.54 mm: 7.85 s at 600 mm/min; a plain quarter arc is 1.57 s.
    sim.clock.advance(3000);
    expect(sim.device.snapshot().motionState).toBe('run');
    sim.clock.advance(6000);
    expect(sim.device.snapshot().motionState).toBe('stop');
    expect(sim.device.snapshot().position[0]).toBeCloseTo(-10, 4);
  });

  it('[EN-ARC-COINCIDENT] a center point whose end radius differs by more than 1 mm alarms 154', () => {
    const sim = enSim();
    expect(send(sim, 'G2 X0 Y25 I0 J10 F600')).toEqual([154]);
    expect(sim.device.snapshot().machineState).toBe('alarm');
  });
});

// ---------------------------------------------------------------- arcs, 440.21

describe('440.21 arcs: angular fp_EQ, zero-length refusal (plan_arc.c:165-167, :276-295)', () => {
  // Centre to the left of the start, (-10,0): theta = atan2(10, 0) = pi/2, away from the atan2 branch cut.
  it('[TG-ARC-ANGULAR] equal angles (fp_EQ) are zero angular travel: a 0.000001 mm end point is refused 201 in both directions', () => {
    for (const code of ['G2', 'G3']) {
      const sim = tgSim();
      expect(send(sim, `${code} X0 Y-0.000001 I-10 J0 F100`, 1000)).toEqual([201]);
      expect(sim.device.snapshot().motionState).toBe('stop');
      expect(sim.device.snapshot().position).toEqual([0, 0, 0, 0, 0, 0]);
      expect(sim.device.snapshot().machineState).not.toBe('alarm');
    }
  });

  it('[TG-ARC-ANGULAR] with equal angles a helix runs its linear travel only', () => {
    const sim = tgSim();
    expect(send(sim, 'G3 X0 Y-0.000001 Z1 I-10 J0 F100', 2000)).toEqual([0]);
    expect(sim.device.snapshot().motionState).toBe('stop');
    expect(sim.device.snapshot().position[2]).toBeCloseTo(1, 5);
  });

  it('[TG-ARC-ANGULAR] angles outside fp_EQ: G2 with 0.0002 mm is a tiny arc, G3 nearly a full circle', () => {
    const cw = tgSim();
    expect(send(cw, 'G2 X0 Y-0.0002 I-10 J0 F100', 1000)).toEqual([0]);
    expect(cw.device.snapshot().motionState).toBe('stop');
    expect(cw.device.snapshot().position[1]).toBeCloseTo(-0.0002, 6);
    const ccw = tgSim();
    expect(send(ccw, 'G3 X0 Y-0.0002 I-10 J0 F600', 100)).toEqual([0]);
    ccw.clock.advance(3142 - 100); // half of ~62.83 mm at 600 mm/min
    expect(ccw.device.snapshot().position[0]).toBeCloseTo(-20, 0);
  });

  it('[TG-ARC-ANGULAR] at the branch cut an exactly coincident end point is a full circle for G2 and zero travel (201) for G3', () => {
    // I0 makes -I a negative zero: theta = atan2(-0, -10) = -pi; the end angle atan2(+0, -10) = +pi.
    const cw = tgSim();
    expect(send(cw, 'G2 X0 Y0 I0 J10 F600', 100)).toEqual([0]);
    cw.clock.advance(3142 - 100);
    expect(cw.device.snapshot().position[1]).toBeCloseTo(20, 0);
    const ccw = tgSim();
    expect(send(ccw, 'G3 X0 Y0 I0 J10 F600', 1000)).toEqual([201]);
    expect(ccw.device.snapshot().motionState).toBe('stop');
  });

  it('[TG-ARC-ANGULAR] no plane end point is a full circle; P adds turns', () => {
    const sim = tgSim();
    expect(send(sim, 'G2 I0 J10 F600', 100)).toEqual([0]);
    expect(sim.device.snapshot().motionState).toBe('run');
    sim.clock.advance(3142 - 100); // half of 62.83 mm at 600 mm/min
    expect(sim.device.snapshot().position[1]).toBeCloseTo(20, 0);
    const turns = tgSim();
    expect(send(turns, 'G2 I0 J10 P2 F600', 100)).toEqual([0]);
    turns.clock.advance(6283 + 3142 - 100); // one and a half of the two turns
    expect(turns.device.snapshot().position[1]).toBeCloseTo(20, 0);
    expect(turns.device.snapshot().motionState).toBe('run');
  });

  it('[TG-ARC-ANGULAR] every block in modal G2 runs the arc code: I/J alone is a full circle, M5 alone is refused 201', () => {
    const sim = tgSim();
    expect(send(sim, 'G2 X0 Y20 I0 J10 F600', 5000)).toEqual([0]);
    expect(sim.device.snapshot().position[1]).toBeCloseTo(20, 4);
    expect(send(sim, 'I0 J-10', 500)).toEqual([0]);
    expect(sim.device.snapshot().motionState).toBe('run');
    sim.clock.advance(10_000);
    expect(send(sim, 'M5')).toEqual([201]);
  });
});

// ---------------------------------------------------------------- rotary axis modes

describe('rotary axis modes and radius (cm_set_model_target)', () => {
  for (const [name, make] of MODELS) {
    const tag = name === 'edge-next' ? 'EN-AXIS-MODES' : 'TG-AXIS-MODES';

    it(`[${tag}] ${name}: aam=3 ara=1, G21 G90 G1 A10 goes to 572.9578 degrees`, () => {
      const sim = make();
      expect(send(sim, '{"aam":3}')).toEqual([0]);
      expect(send(sim, '{"ara":1}')).toEqual([0]);
      expect(send(sim, 'G90 G21 G1 A10 F100000', 60_000)).toEqual([0]);
      expect(sim.device.snapshot().position[3]).toBeCloseTo((10 * 360) / (2 * Math.PI), 3);
    });

    it(`[${tag}] ${name}: radius mode from a nonzero start, absolute and incremental, and in G20`, () => {
      const sim = make();
      send(sim, '{"aam":1}');
      expect(send(sim, 'G90 G21 G0 A10', 60_000)).toEqual([0]);
      expect(sim.device.snapshot().position[3]).toBeCloseTo(10, 6);
      send(sim, '{"aam":3}');
      send(sim, '{"ara":1000}');
      expect(send(sim, 'G1 A10 F100000', 60_000)).toEqual([0]);
      expect(sim.device.snapshot().position[3]).toBeCloseTo((10 * 360) / (2 * Math.PI * 1000), 6);
      expect(send(sim, 'G91 G1 A5', 60_000)).toEqual([0]);
      expect(sim.device.snapshot().position[3]).toBeCloseTo((15 * 360) / (2 * Math.PI * 1000), 6);
      expect(send(sim, 'G90 G20 G1 A1', 60_000)).toEqual([0]);
      expect(sim.device.snapshot().position[3]).toBeCloseTo((25.4 * 360) / (2 * Math.PI * 1000), 5);
    });

    it(`[${tag}] ${name}: the defaults are A radius mode (r = 1.25/2pi) and B, C disabled`, () => {
      const sim = make();
      expect(get(sim, 'aam')).toBe(3);
      expect(get(sim, 'bam')).toBe(0);
      expect(get(sim, 'cam')).toBe(0);
      expect(get(sim, 'xam')).toBe(1);
      expect(send(sim, 'G90 G21 G1 A1 B5 C5 F100000', 60_000)).toEqual([0]);
      const pos = sim.device.snapshot().position;
      expect(pos[3]).toBeCloseTo(360 / 1.25, 1); // 1 mm on a 1.25 mm-per-rev circumference
      expect(pos[4]).toBe(0);
      expect(pos[5]).toBe(0);
    });

    it(`[${tag}] ${name}: a disabled linear axis ignores its word; standard A is degrees`, () => {
      const sim = make();
      send(sim, '{"yam":0}');
      send(sim, '{"aam":1}');
      expect(send(sim, 'G90 G21 G1 X1 Y5 A10 F100000', 60_000)).toEqual([0]);
      const pos = sim.device.snapshot().position;
      expect(pos[0]).toBeCloseTo(1, 6);
      expect(pos[1]).toBe(0);
      expect(pos[3]).toBeCloseTo(10, 6);
    });

    it(`[${tag}] ${name}: radius mode cannot be set on a linear axis (cm_set_am)`, () => {
      const sim = make();
      expect(send(sim, '{"xam":3}')).toEqual([109]);
      expect(get(sim, 'xam')).toBe(1);
      expect(send(sim, '{"aam":4}')).toEqual([109]);
    });
  }
});

// ---------------------------------------------------------------- inhibited axes in motor space

/**
 * Finding: inhibited axis. Each executed segment sets the step target to the
 * joint of the segment's ABSOLUTE target and moves the motor by the
 * difference from the previous step target (EN plan_exec.c:707-716, TG
 * plan_exec.c:718-727); the joint of an inhibited axis is 0 (EN
 * kinematics.c:59, TG kinematics.c:63). So the reported position and the
 * motor part ways, and the next move of ANY axis moves the motor.
 */
describe('inhibited axes: the motor is driven to step 0 by any move (kinematics.c)', () => {
  for (const [name, make] of MODELS) {
    const tag = name === 'edge-next' ? 'EN-INHIBITED-JOINT' : 'TG-INHIBITED-JOINT';

    it(`[${tag}] ${name}: A standard at 10 degrees, then {aam:2}: G0 X5 turns the A motor 10 degrees back to 0 while A still reads 10`, () => {
      const sim = make();
      expect(send(sim, '{"aam":1}')).toEqual([0]);
      expect(send(sim, 'G90 G21 G0 A10', 60_000)).toEqual([0]);
      expect(sim.device.snapshot().motors[3]).toBeCloseTo(10, 6);
      expect(send(sim, '{"aam":2}')).toEqual([0]);
      // Changing the mode moves nothing by itself.
      expect(sim.device.snapshot().motors[3]).toBeCloseTo(10, 6);
      expect(send(sim, 'G0 X5', 60_000)).toEqual([0]);
      const s = sim.device.snapshot();
      expect(s.position[3]).toBeCloseTo(10, 6);
      expect(s.position[0]).toBeCloseTo(5, 6);
      expect(s.motors[0]).toBeCloseTo(5, 6);
      expect(s.motors[3]).toBe(0);
    });

    it(`[${tag}] ${name}: a linear axis (yam=2) at Y20: an X-only move drives the Y motor 20 mm to step 0 at the first segment`, () => {
      const sim = make();
      expect(send(sim, 'G90 G21 G0 Y20', 60_000)).toEqual([0]);
      expect(send(sim, '{"yam":2}')).toEqual([0]);
      expect(get(sim, 'yam')).toBe(2);
      sim.host.take();
      sim.host.sendLine('G1 X5 F60');
      sim.clock.advance(200);
      const early = sim.device.snapshot();
      expect(early.motionState).toBe('run');
      expect(early.position[0]).toBeLessThan(1);
      expect(early.position[1]).toBeCloseTo(20, 6);
      expect(early.motors[1]).toBe(0); // the whole 20 mm at once, before X has moved 1 mm
      sim.clock.advance(10_000);
      expect(sim.device.snapshot().motors[1]).toBe(0);
    });

    it(`[${tag}] ${name}: moves of an inhibited axis change its position but not its motor`, () => {
      const sim = make();
      expect(send(sim, '{"yam":2}')).toEqual([0]);
      expect(send(sim, 'G90 G21 G0 Y10 X1', 60_000)).toEqual([0]);
      const s = sim.device.snapshot();
      expect(s.position[1]).toBeCloseTo(10, 6);
      expect(s.motors[1]).toBe(0);
      expect(s.motors[0]).toBeCloseTo(1, 6);
    });

    it(`[${tag}] ${name}: un-inhibiting an axis whose position is away from 0 drives its motor out on the next move of any axis`, () => {
      const sim = make();
      expect(send(sim, '{"yam":2}')).toEqual([0]);
      expect(send(sim, 'G90 G21 G0 Y10', 60_000)).toEqual([0]);
      expect(send(sim, '{"yam":1}')).toEqual([0]);
      expect(sim.device.snapshot().motors[1]).toBe(0);
      expect(send(sim, 'G0 X1', 60_000)).toEqual([0]);
      expect(sim.device.snapshot().motors[1]).toBeCloseTo(10, 6);
    });

    it(`[${tag}] ${name}: leaving inhibited mode for DISABLED also drives the motor out to the position on the next move of any axis`, () => {
      const sim = make();
      expect(send(sim, '{"aam":2}')).toEqual([0]);
      expect(send(sim, 'G90 G21 G0 A30', 60_000)).toEqual([0]);
      expect(sim.device.snapshot().motors[3]).toBe(0);
      expect(send(sim, '{"aam":0}')).toEqual([0]);
      expect(send(sim, 'G0 X1', 60_000)).toEqual([0]);
      const s = sim.device.snapshot();
      expect(s.position[3]).toBeCloseTo(30, 6);
      expect(s.motors[3]).toBeCloseTo(30, 6); // disabled ignores A words, but its joint is its position
    });

    it(`[${tag}] ${name}: a disabled axis keeps its motor where its position is (no zeroing)`, () => {
      const sim = make();
      expect(send(sim, 'G90 G21 G0 Y10', 60_000)).toEqual([0]);
      expect(send(sim, '{"yam":0}')).toEqual([0]);
      expect(send(sim, 'G0 X1 Y30', 60_000)).toEqual([0]);
      const s = sim.device.snapshot();
      expect(s.position[1]).toBeCloseTo(10, 6);
      expect(s.motors[1]).toBeCloseTo(10, 6);
    });

    it(`[${tag}] ${name}: a queue flush resyncs the step targets without moving a motor (cm_set_position)`, () => {
      const sim = make();
      expect(send(sim, 'G90 G21 G0 Y20', 60_000)).toEqual([0]);
      sim.host.take();
      sim.host.sendLine('G1 X50 F600');
      sim.clock.advance(400);
      sim.host.send('!');
      sim.clock.advance(300);
      expect(sim.device.snapshot().hold).not.toBe(0);
      sim.device.settings.setRam('yam', 2);
      sim.host.send('%');
      sim.clock.advance(50);
      expect(sim.device.snapshot().plannerAvailable).toBeGreaterThan(0);
      expect(sim.device.snapshot().motors[1]).toBeCloseTo(20, 6); // the flush moved nothing
      sim.device.settings.setRam('yam', 1);
      sim.host.take();
      sim.host.sendLine('G0 X0');
      sim.clock.advance(60_000);
      // The step target was 0 after the resync; standard again, the next segment drives Y out by 20 more.
      expect(sim.device.snapshot().position[1]).toBeCloseTo(20, 6);
      expect(sim.device.snapshot().motors[1]).toBeCloseTo(40, 6);
    });

    it(`[${tag}] ${name}: a feedhold mid-move leaves the motors at the held point`, () => {
      const sim = make();
      sim.host.take();
      sim.host.sendLine('G90 G21 G1 X50 F600');
      sim.clock.advance(400);
      sim.host.send('!');
      sim.clock.advance(2000);
      const s = sim.device.snapshot();
      expect(s.velocity).toBe(0);
      expect(s.motors[0]).toBeCloseTo(s.position[0], 9);
      expect(s.motors[0]).toBeGreaterThan(0);
    });
  }
});

describe('inhibited axes: the rotary verifier reproduction as written', () => {
  const run = (sim: AnySim): { readsA: number; motorA: number } => {
    send(sim, '{"aam":1}');
    send(sim, 'G90 G21 G0 A30', 60_000);
    send(sim, '{"aam":2}');
    send(sim, 'G1 X1 F600', 60_000);
    const s = sim.device.snapshot();
    return { readsA: s.position[3], motorA: s.motors[3] };
  };
  it('[EN-INHIBITED-JOINT] edge-next: A at 30 degrees switched to am=2: G1 X1 turns the A motor 30 degrees to step 0; A still reads 30', () => {
    const r = run(enSim());
    expect(r.readsA).toBeCloseTo(30, 6);
    expect(r.motorA).toBe(0);
  });
  it('[TG-INHIBITED-JOINT] 440.21: A at 30 degrees switched to am=2: G1 X1 turns the A motor 30 degrees to step 0; A still reads 30', () => {
    const r = run(tgSim());
    expect(r.readsA).toBeCloseTo(30, 6);
    expect(r.motorA).toBe(0);
  });
});

describe('edge-next G53 under G91 (cm_set_model_target)', () => {
  it('[EN-AXIS-MODES] G53 only zeroes the offset; in G91 the word is still a distance (canonical_machine.c:314-324, :512-521)', () => {
    const sim = enSim();
    expect(send(sim, 'G90 G0 X10', 2000)).toEqual([0]);
    expect(send(sim, 'G91 G53 G0 X5', 2000)).toEqual([0]);
    expect(sim.device.snapshot().position[0]).toBeCloseTo(15, 6);
  });
});

// ---------------------------------------------------------------- F and units order

describe('F is set before G20/G21 in the same block (gcode_parser.c order)', () => {
  for (const [name, make] of MODELS) {
    const tag = name === 'edge-next' ? 'EN-FEED-UNITS-ORDER' : 'TG-FEED-UNITS-ORDER';

    it(`[${tag}] ${name}: G20, then G21 G1 X1 F100 sets 2540 mm/min (F read in inches)`, () => {
      const sim = make();
      send(sim, 'G20');
      expect(send(sim, 'G21 G1 X1 F100')).toEqual([0]);
      expect(get(sim, 'feed')).toBe(2540);
    });

    it(`[${tag}] ${name}: G21, then G20 G1 X1 F100 sets 100 mm/min (F read in mm), reported as 3.94 in/min`, () => {
      const sim = make();
      send(sim, 'G21');
      expect(send(sim, 'G20 G1 X0.01 F100')).toEqual([0]);
      expect(get(sim, 'feed')).toBe(3.94); // 100 / 25.4 at the feed token's 2 decimals; F read in inches would print 100
    });

    it(`[${tag}] ${name}: controls: F alone and units alone`, () => {
      const sim = make();
      send(sim, 'G20');
      send(sim, 'F100');
      send(sim, 'G21');
      expect(get(sim, 'feed')).toBe(2540);
      send(sim, 'F100');
      expect(get(sim, 'feed')).toBe(100);
    });
  }
});

// ---------------------------------------------------------------- soft limits

describe('soft limits: fp_EQ skip, DISABLE_SOFT_LIMIT ends, every homed axis', () => {
  for (const [name, make] of MODELS) {
    const tag = name === 'edge-next' ? 'EN-SOFT-LIMITS' : 'TG-SOFT-LIMITS';
    const setup = (settings: Record<string, number>, homed: readonly ('x' | 'y' | 'z' | 'a' | 'b' | 'c')[] = ['x', 'y', 'z']): AnySim => {
      const sim = make();
      sim.device.settings.setRam('sl', 1);
      for (const [k, v] of Object.entries(settings)) sim.device.settings.setRam(k, v);
      sim.device.setHomed(homed);
      return sim;
    };

    it(`[${tag}] ${name}: xtn=0 xtm=0.000001 are fp_EQ: the X limit is skipped`, () => {
      const sim = setup({ xtn: 0, xtm: 0.000001 });
      expect(send(sim, 'G1 X1 F600', 1000)).toEqual([0]);
      expect(sim.device.snapshot().position[0]).toBeCloseTo(1, 6);
    });

    it(`[${tag}] ${name}: xtn=1000 xtm=1000.000001 collapse in float32: skipped`, () => {
      const sim = setup({ xtn: 1000, xtm: 1000.000001 });
      expect(send(sim, 'G1 X1 F600', 1000)).toEqual([0]);
    });

    it(`[${tag}] ${name}: xtn=0 xtm=0.00002 are distinct: X1 is a soft-limit error 220 (contrast)`, () => {
      const sim = setup({ xtn: 0, xtm: 0.00002 });
      expect(send(sim, 'G1 X1 F600', 1000)).toEqual([220]);
      expect(sim.device.snapshot().position[0]).toBe(0);
    });

    it(`[${tag}] ${name}: a minimum at or below -1000000 disables only that end`, () => {
      const sim = setup({ xtn: -1_000_000, xtm: 150 });
      expect(send(sim, 'G1 X-5 F60000', 1000)).toEqual([0]);
      expect(send(sim, 'G1 X200', 1000)).toEqual([220]);
      const enabled = setup({ xtn: -999_999, xtm: 150 });
      expect(send(enabled, 'G1 X-1000000 F60000', 1000)).toEqual([220]);
    });

    it(`[${tag}] ${name}: a maximum at or below -1000000 disables only that end`, () => {
      const sim = setup({ xtn: 0, xtm: -1_000_000 });
      expect(send(sim, 'G1 X500 F60000', 1000)).toEqual([0]);
      expect(send(sim, 'G1 X-1', 1000)).toEqual([220]);
    });

    it(`[${tag}] ${name}: a homed rotary axis is checked too (A standard, 0..90)`, () => {
      const sim = setup({ aam: 1, atn: 0, atm: 90 }, ['x', 'y', 'z', 'a']);
      expect(send(sim, 'G1 A45 F60000', 1000)).toEqual([0]);
      expect(send(sim, 'G1 A100', 1000)).toEqual([220]);
      const unhomed = setup({ aam: 1, atn: 0, atm: 90 });
      expect(send(unhomed, 'G1 A100 F60000', 1000)).toEqual([0]);
    });
  }

  it('[EN-ARC-SOFT-LIMITS] the arc extent test uses the same fp_EQ skip and DISABLE_SOFT_LIMIT ends', () => {
    const sim = enSim();
    send(sim, 'G0 X5 Y10', 3000);
    sim.device.settings.setRam('sl', 1);
    sim.device.setHomed(['x', 'y', 'z']);
    // xtm=10 is enforced: the G3 from the bottom of the circle about (5,20) sweeps through X=15.
    sim.device.settings.setRam('xtm', 10);
    expect(send(sim, 'G3 X5 Y30 I0 J10 F6000', 100)).toEqual([220]);
    const open = enSim();
    send(open, 'G0 X5 Y10', 3000);
    open.device.settings.setRam('sl', 1);
    open.device.setHomed(['x', 'y', 'z']);
    // xtm=-1000000 disables the max end: the same arc is allowed.
    open.device.settings.setRam('xtm', -1_000_000);
    expect(send(open, 'G3 X5 Y30 I0 J10 F6000', 3000)).toEqual([0]);
    // ytn=0, ytm=0.000001 are fp_EQ and skip Y: an arc ending at Y=50 is allowed.
    open.device.settings.setRam('ytn', 0);
    open.device.settings.setRam('ytm', 0.000001);
    expect(send(open, 'G3 X5 Y50 I0 J10 F6000', 3000)).toEqual([0]);
  });
});

// ---------------------------------------------------------------- the original reproductions, per model

describe('Independent review batch 14 reproductions, as written (review-models.mjs)', () => {
  const radius = (sim: AnySim): number => {
    send(sim, '{"aam":3}');
    send(sim, '{"ara":1}');
    // 572.96 degrees at F100 takes ~5.7 min (the original 70 s wait only covered 10 degrees)
    send(sim, 'G90 G21 G1 A10 F100', 400_000);
    expect(sim.device.snapshot().motionState).toBe('stop');
    return sim.device.snapshot().position[3];
  };
  const units = (sim: AnySim): unknown => {
    send(sim, 'G20');
    send(sim, 'G21 G1 X1 F100');
    return get(sim, 'feed');
  };
  const nearEqualLimits = (sim: AnySim): number[] => {
    sim.device.settings.setRam('sl', 1);
    sim.device.settings.setRam('xtn', 0);
    sim.device.settings.setRam('xtm', 0.000001);
    sim.device.setHomed(['x']);
    return send(sim, 'G1 X1 F100', 50);
  };

  it('[EN-AXIS-MODES] edge-next: {aam:3} {ara:1} G90 G21 G1 A10 ends near 572.9578 degrees, not 10', () => {
    expect(radius(enSim())).toBeCloseTo(572.9578, 3);
  });
  it('[TG-AXIS-MODES] 440.21: {aam:3} {ara:1} G90 G21 G1 A10 ends near 572.9578 degrees, not 10', () => {
    expect(radius(tgSim())).toBeCloseTo(572.9578, 3);
  });
  it('[EN-FEED-UNITS-ORDER] edge-next: G20 then G21 G1 X1 F100 reports feed 2540, not 100', () => {
    expect(units(enSim())).toBe(2540);
  });
  it('[TG-FEED-UNITS-ORDER] 440.21: G20 then G21 G1 X1 F100 reports feed 2540, not 100', () => {
    expect(units(tgSim())).toBe(2540);
  });
  it('[EN-SOFT-LIMITS] edge-next: sl=1, X homed, xtn=0, xtm=0.000001: G1 X1 F100 is accepted (no 220)', () => {
    expect(nearEqualLimits(enSim())).toEqual([0]);
  });
  it('[TG-SOFT-LIMITS] 440.21: sl=1, X homed, xtn=0, xtm=0.000001: G1 X1 F100 is accepted (no 220)', () => {
    expect(nearEqualLimits(tgSim())).toEqual([0]);
  });
  it('[EN-ARC-COINCIDENT] edge-next: G3 X0.000001 Y0 I0 J10 F100 is still running after 1 s (firmware full circle)', () => {
    const sim = enSim();
    send(sim, 'G3 X0.000001 Y0 I0 J10 F100', 1000);
    expect(sim.device.snapshot().motionState).toBe('run');
  });
});

// ---------------------------------------------------------------- leftover partial line, then the connect line

describe('a leftover partial line, a 0.5 s gap, then the connect line (bench 2, 2026-11-02: edge-next d254eb0b, 440.21 d0418390)', () => {
  // TinyG HIL diagnostic test_leftover_line_reconnect. [fragment, connect line, edge-next status or 'runs', 440.21 status or 'runs'].
  const TABLE: readonly (readonly [string, string, number | 'runs', number | 'runs'])[] = [
    ['G0 X0.5', '{sr:null}', 101, 102],
    ['G0 X0.', '{sr:null}', 101, 102],
    ['G0 X0.5', '{"sr":null}', 101, 'runs'],
    ['G0 X0.5 (rough', '{sr:null}', 'runs', 'runs'],
    ['G0 X0.5 ;rough', '{sr:null}', 'runs', 'runs'],
    ['G0 X0.5 (rough', '{"sr":null}', 'runs', 'runs'],
    ['G0 X0.5 ;rough', '{"sr":null}', 'runs', 'runs'],
  ];
  for (const [fragment, connectLine, en, tg] of TABLE) {
    for (const [name, make, expected] of [['edge-next', enSim, en], ['440.21', tgSim, tg]] as const) {
      it(`${name}: "${fragment}" + ${connectLine} ${expected === 'runs' ? 'runs' : `is rejected (${expected})`}; the reply has no "sr" key either way`, () => {
        const sim: AnySim = make();
        sim.clock.advance(2000);
        sim.host.take();
        sim.host.send(fragment);
        sim.clock.advance(500);
        sim.host.sendLine(connectLine);
        sim.clock.advance(5000);
        const lines = sim.host.take();
        const reply = JSON.parse(lines[0] as string) as { r: Record<string, unknown>; f: number[] };
        expect(Object.keys(reply.r)).toEqual([]);
        expect(reply.f[1]).toBe(expected === 'runs' ? 0 : expected);
        expect(sim.device.snapshot().position[0]).toBeCloseTo(expected === 'runs' ? 0.5 : 0, 3);
      });
    }
  }
});
