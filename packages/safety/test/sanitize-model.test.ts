/**
 * The sanitiser's modal and position model (SAFETY §4.7 step 6a): every
 * move's length must be known before it can be checked against the
 * queued-motion ceiling. These tests pin how each code changes the model,
 * and that whatever is unknown blocks rather than being guessed.
 */
import { TINYG_440, TINYG_EN } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import type { StartState } from '../src/index.ts';
import { MOTION, START, blocks, run } from './sanitizeHelpers.ts';

const EN = TINYG_EN;
const TG = TINYG_440;

/** Modelled length of the sent line with this body. */
function lengthOf(file: string, body: string, start: StartState = START, d = EN): number | undefined {
  const r = run(file, d, { start });
  expect(r.report.blocked, JSON.stringify(r.report.entries)).toBe(false);
  return r.lines.find((l) => l.body === body)?.motion?.plannerLength;
}

describe('unknown state blocks moves that depend on it', () => {
  it('with no start state, an absolute move cannot be modelled but an incremental one can', () => {
    const r = run('G21 G90\nG0 X1\n', EN, { start: {} });
    expect(blocks(r)).toEqual(['unknown-state']);
    expect(r.report.entries.find((e) => e.rule === 'unknown-state')?.message).toContain('work position of X');
    const inc = run('G21 G91 G0 X1\n', EN, { start: {} });
    expect(inc.report.blocked).toBe(false);
    expect(inc.lines[0]?.motion?.plannerLength).toBe(1);
  });

  it('a long incremental move from an unknown position is still split', () => {
    const r = run('G21\nG91 G1 X100 F600\n', EN, { start: {}, motion: { ...MOTION, ceilingSeconds: 2, maxVelocity: { X: 600 }, feedrateMax: { X: 600 } } });
    expect(r.report.blocked).toBe(false);
    expect(r.lines.length).toBeGreaterThan(1);
  });

  it('unknown units or distance mode are named', () => {
    expect(run('G0 X1\n', EN, { start: { ...START, units: undefined as never } }).report.entries[0]?.message).toContain('the units');
    expect(run('G0 X1\n', EN, { start: { ...START, distance: undefined as never } }).report.entries[0]?.message).toContain('distance mode');
    // A rotary-only move needs no units.
    expect(run('G91 G0 A90\n', EN, { start: { ...START, units: undefined as never } }).report.blocked).toBe(false);
  });

  it('an unknown motion mode with axis words cannot be modelled', () => {
    expect(blocks(run('X1\n', EN, { start: { ...START, motion: undefined as never } }))).toEqual(['unknown-state']);
  });

  it('a move on an axis with no maximum velocity is blocked', () => {
    const r = run('G0 X1\n', EN, { motion: { ...MOTION, maxVelocity: { Y: 1000 }, feedrateMax: { Y: 1000 } } });
    expect(blocks(r)).toEqual(['no-velocity-limit']);
    const arc = run('G2 X10 Y0 I5 F100\n', EN, { motion: { ...MOTION, maxVelocity: { X: 1000 }, feedrateMax: { X: 1000 } } });
    expect(blocks(arc)).toEqual(['no-velocity-limit']);
  });

  it('after a move that could not be modelled, later absolute moves on that axis are unknown too', () => {
    expect(blocks(run('G0 X1\nG0 X2\n', EN, { start: { ...START, machine: { Y: 0 } } }))).toEqual(['unknown-state', 'unknown-state']);
  });

  it('a start feed that is not a positive number is unknown', () => {
    for (const feedMmPerMin of [0, -1, Number.NaN]) {
      expect(blocks(run('G1 X1\n', EN, { start: { ...START, feedMmPerMin } })), String(feedMmPerMin)).toEqual(['feed-not-set']);
    }
  });
});

describe('offsets and coordinate systems', () => {
  const offset10 = { ...START, wcsOffsets: { ...START.wcsOffsets, G55: { X: 10, Y: 0, Z: 0, A: 0, B: 0, C: 0 } } };

  it('switching to a system with a known offset moves the work position by the offset', () => {
    // At machine X0, G55 X reads -10, so G0 X0 is a 10 mm move.
    expect(lengthOf('G55\nG0 X0\n', 'G0 X0', offset10)).toBe(10);
  });

  it('selecting a system when the active one was unknown uses the machine position and the new offset', () => {
    expect(lengthOf('G55\nG0 X0\n', 'G0 X0', { ...offset10, wcs: undefined as never })).toBe(10);
  });

  it('G92 under unknown units leaves the axis unknown', () => {
    expect(blocks(run('G92 X0\nG21 G0 X1\n', EN, { start: { ...START, units: undefined as never } }))).toEqual(['unknown-state']);
  });

  it('switching to a system with an unknown offset makes the work position unknown', () => {
    const start = { ...START, wcsOffsets: { G54: START.wcsOffsets?.G54 ?? {} } };
    expect(blocks(run('G55\nG0 X0\n', EN, { start }))).toEqual(['unknown-state']);
  });

  it('without a machine position, G92 still makes the work position known, until the frame changes', () => {
    const start: StartState = { ...offset10, machine: {} };
    expect(blocks(run('G0 X0\n', EN, { start }))).toEqual(['unknown-state']);
    expect(lengthOf('G92 X0\nG0 X3\n', 'G0 X3', start)).toBe(3);
    // The G92 offset is unknown, but it applies in both systems: G54 → G55 still moves X by the known -10.
    expect(lengthOf('G92 X0\nG55\nG0 X0\n', 'G0 X0', start)).toBe(10);
    // Cancelling the unknown G92 offset loses the position.
    expect(blocks(run('G92 X0\nG92.1\nG0 X0\n', EN, { start }))).toEqual(['unknown-state']);
  });

  it('G92 sets the work position; G92.1 cancels; G92.2 suspends and G92.3 resumes', () => {
    const at5 = { ...START, machine: { X: 5, Y: 0, Z: 0, A: 0, B: 0, C: 0 } };
    expect(lengthOf('G92 X0\nG0 X10\n', 'G0 X10', at5)).toBe(10);
    expect(lengthOf('G92 X0\nG92.1\nG0 X10\n', 'G0 X10', at5)).toBe(5);
    expect(lengthOf('G92 X0\nG92.2\nG0 X10\n', 'G0 X10', at5)).toBe(5);
    expect(lengthOf('G92 X0\nG92.2\nG92.3\nG0 X10\n', 'G0 X10', at5)).toBe(10);
    // Unknown G92 state with non-zero offsets makes the frame unknown.
    expect(blocks(run('G0 X1\n', EN, { start: { ...START, g92: undefined as never } }))).toEqual(['unknown-state']);
  });

  it('G92 with an unknown coordinate system still knows the axis it sets', () => {
    expect(lengthOf('G92 X0\nG0 X3\n', 'G0 X3', { ...START, wcs: undefined as never })).toBe(3);
  });

  it('G10 L2 on the active system shifts the work position; on another system it does not', () => {
    expect(lengthOf('G10 L2 P1 X5\nG0 X0\n', 'G0 X0')).toBe(5);
    expect(lengthOf('G10 L2 P2 X5\nG0 X1\n', 'G0 X1')).toBe(1);
    expect(blocks(run('G10 L2 P1 X5\nG0 X0\n', EN, { start: { ...START, wcs: undefined as never } }))).toEqual(['unknown-state']);
  });

  it('G10 L20 makes the current position read the value in that system (EN)', () => {
    const at7 = { ...START, machine: { X: 7, Y: 0, Z: 0, A: 0, B: 0, C: 0 } };
    expect(lengthOf('G10 L20 P2 X0\nG55\nG0 X4\n', 'G0 X4', at7)).toBe(4);
    expect(lengthOf('G10 L20 P1 X0\nG0 X4\n', 'G0 X4', at7)).toBe(4);
    // With the machine position unknown, the offset is unknown, so a later switch to it is too.
    const r = run('G10 L20 P2 X0\nG55\nG0 X4\n', EN, { start: { ...START, machine: {} } });
    expect(blocks(r)).toEqual(['unknown-state']);
  });

  it('G10 with unknown units or an unknown old offset, and L20 with G92 applied or unknown', () => {
    expect(blocks(run('G10 L2 P1 X5\nG0 X0\n', EN, { start: { ...START, units: undefined as never } }))).toEqual(['unknown-state']);
    // An unknown G54 offset becomes known when G10 L2 sets it, and the machine position then gives the work position.
    const noG54: StartState = { ...START, wcsOffsets: { G55: START.wcsOffsets?.G55 ?? {} } };
    expect(blocks(run('G0 X0\n', EN, { start: noG54 }))).toEqual(['unknown-state']);
    expect(lengthOf('G10 L2 P1 X5\nG0 X0\n', 'G0 X0', noG54)).toBe(5);
    // L20 with G92 applied: the G92 offset is part of the arithmetic.
    expect(lengthOf('G92 X2\nG10 L20 P2 X0\nG55\nG0 X4\n', 'G0 X4')).toBe(4);
    const r = run('G10 L20 P2 X0\nG55\nG0 X4\n', EN, { start: { ...START, g92: undefined as never } });
    expect(blocks(r)).toEqual(['unknown-state']);
  });

  it('G43.1 shifts the work position by the tool offset; G49 cancels it (EN)', () => {
    expect(lengthOf('G43.1 Z10\nG0 Z0\n', 'G0 Z0')).toBe(10);
    expect(lengthOf('G43.1 Z10\nG49\nG0 Z0\n', 'G0 Z0')).toBe(0);
    expect(blocks(run('G43.1 Z10\nG0 Z0\n', EN, { start: { ...START, units: undefined as never } }))).toEqual(['unknown-state']);
  });

  it('TG has no tool offset: G49 is accepted and changes nothing', () => {
    expect(lengthOf('G49\nG0 Z3\n', 'G0 Z3', START, TG)).toBe(3);
    // And an unknown start tool offset does not matter on TG.
    expect(lengthOf('G0 Z3\n', 'G0 Z3', { ...START, toolOffset: {} }, TG)).toBe(3);
  });

  it('G53 moves in machine coordinates under G90; under G91 (where TinyG treats the values as distances) or an unknown distance mode it is blocked', () => {
    expect(lengthOf('G53 G0 X10\n', 'G53 G0 X10', { ...START, wcsOffsets: { ...START.wcsOffsets, G54: { X: 50, Y: 0, Z: 0, A: 0, B: 0, C: 0 } } })).toBe(10);
    for (const d of [EN, TG]) {
      expect(blocks(run('G91\nG53 G0 X10\n', d)), d.id).toEqual(['modal-conflict']);
      expect(blocks(run('G91 G53 G0 X10\n', d)), d.id).toEqual(['modal-conflict']);
      expect(blocks(run('G53 G0 X10\n', d, { start: { ...START, distance: undefined as never } })), d.id).toEqual(['unknown-state']);
      expect(run('G91\nG90 G53 G0 X10\n', d).report.blocked, d.id).toBe(false);
    }
    expect(blocks(run('G53 G0 X10\n', EN, { start: { ...START, machine: {} } }))).toEqual(['unknown-state']);
    expect(run('G53 G0 X10\n', EN, { start: { ...START, machine: {} } }).report.entries[0]?.message).toContain('machine position');
  });

  it('G28.1 and G30.1 store the current position; G28 and G30 go there', () => {
    const at = { ...START, machine: { X: 4, Y: 3, Z: 0, A: 0, B: 0, C: 0 }, g28: {}, g30: {} };
    expect(lengthOf('G28.1\nG0 X0 Y0\nG28\n', 'G28', at)).toBe(5);
    expect(lengthOf('G30.1\nG0 X0 Y0\nG30\n', 'G30', at)).toBe(5);
    expect(blocks(run('G28\n', EN, { start: at }))).toEqual(['unknown-state']);
    expect(blocks(run('G30 X1\n', EN, { start: { ...at, distance: undefined as never } }))).toEqual(['unknown-state']);
    expect(blocks(run('G28\n', EN, { start: { ...START, g28: { X: 1, Y: 0, Z: 0, A: 0, B: 0, C: 0 } }, motion: { ...MOTION, maxVelocity: { Y: 1 }, feedrateMax: { Y: 1 } } }))).toEqual(['no-velocity-limit']);
  });

  it('program end restores the default system and cancels G92', () => {
    const start = { ...offset10, machine: { X: 5, Y: 0, Z: 0, A: 0, B: 0, C: 0 }, defaults: { units: 'G21', distance: 'G90', plane: 'G17', wcs: 'G55' } } as const;
    // After M30: G55 (X reads -5), G92 gone, G90; G0 X0 is a 5 mm move.
    expect(lengthOf('G92 X0\nM30\nG0 X0\nM30\n', 'G0 X0', start, TG)).toBe(5);
  });

  it('program end keeps the units only if they equal the default (EN restores them, TG keeps them)', () => {
    const r = run('G20\nM30\nG0 X1\nM30\n', TG);
    expect(blocks(r)).toEqual(['unknown-state']);
    expect(blocks(run('G91\nM30\nG0 X1\nM30\n', TG, { start: { ...START, defaults: { ...START.defaults, distance: 'G91' } } }))).toEqual(['unknown-state']);
  });
});

describe('arcs', () => {
  it('names what is unknown', () => {
    const r = run('G2 X10 Y0 I5\n', EN, { start: { ...START, feedMmPerMin: 100, plane: undefined as never, units: undefined as never } });
    expect(r.report.entries[0]?.message).toContain('not known: the plane, the units');
    expect(run('G2 X10 Y0 I5 F100\n', EN, { start: { ...START, distance: undefined as never } }).report.entries[0]?.message).toContain('not known: the distance mode');
    expect(blocks(run('G2 X10 Y0 I5 F100\n', EN, { start: { ...START, arcDistance: undefined as never } }))).toEqual(['unknown-state']);
    // R format does not need the arc distance mode.
    expect(run('G2 X10 Y0 R5 F100\n', EN, { start: { ...START, arcDistance: undefined as never } }).report.blocked).toBe(false);
  });

  it('an absolute arc from an unknown start, or a G90.1 centre from one, cannot be modelled', () => {
    expect(blocks(run('G2 X10 Y0 I5 F100\n', EN, { start: { ...START, machine: {} } }))).toEqual(['unknown-state']);
    expect(blocks(run('G91 G90.1 G2 X10 Y0 I5 J0 F100\n', EN, { start: { ...START, machine: {} } }))).toEqual(['unknown-state']);
    // Incremental arcs need no work position; the machine position is still needed to bound float32 rounding.
    expect(run('G91 G2 X10 Y0 I5 F100\n', EN, { start: (({ wcs: _wcs, ...rest }) => rest)(START) }).report.blocked).toBe(false);
    expect(blocks(run('G91 G2 X10 Y0 I5 F100\n', EN, { start: { ...START, machine: {} } }))).toEqual(['unknown-state']);
  });

  it('G91.1 selects offsets from the start again after G90.1 (EN)', () => {
    expect(lengthOf('G90.1\nG91.1 G2 X10 Y0 I5 J0 F1000\n', 'G91.1 G2 X10 Y0 I5 J0 F1000')).toBeCloseTo(5 * Math.PI, 9);
  });

  it('an absolute helix with an unknown linear start cannot be modelled', () => {
    expect(blocks(run('G2 X10 Y0 Z1 I5 F100\n', EN, { start: { ...START, machine: { X: 0, Y: 0 } } }))).toEqual(['unknown-state']);
  });

  it('an arc that cannot be split within tolerance is a block', () => {
    expect(blocks(run('G2 X1 Y0 I0.5 F0.1\n', EN))).toEqual(['split-impossible']);
  });

  it('rotary words on an arc are refused', () => {
    expect(blocks(run('G2 X10 Y0 I5 A10 F100\n', EN))).toEqual(['unsupported-word']);
  });

  it('arcs the firmware would refuse are blocked', () => {
    expect(blocks(run('G2 X10 Y0 I4 F100\n', EN))).toEqual(['malformed']);
    expect(blocks(run('G2 X10 Y0 R2 F100\n', EN))).toEqual(['malformed']);
    expect(blocks(run('G2 X10 Y0 R0.05 F100\n', EN))).toEqual(['malformed']);
    expect(blocks(run('G2 R5 F100\n', EN))).toEqual(['malformed']);
    expect(blocks(run('G2 X10 I0 J0 F100\n', EN))).toEqual(['malformed']);
  });

  it('a G2 with no words only sets the mode; the next arc words run under it', () => {
    const r = run('G2 F1000\nX10 Y0 I5\n', EN);
    expect(r.report.blocked).toBe(false);
    expect(r.lines[0]?.motion).toBeNull();
    expect(r.lines[1]?.motion?.plannerLength).toBeCloseTo(5 * Math.PI, 9);
  });

  it('feed under G20 is inches per minute once G20 is in force', () => {
    // G20 on an earlier line: 1 inch at 10 in/min × k 0.5 = 12 s modelled, split under a 5 s ceiling.
    const r = run('G20\nG91 G1 X1 F10\n', EN);
    expect(r.report.splits[0]?.seconds).toBeCloseTo(12, 9);
    expect(r.report.splits[0]?.segments).toBe(3);
  });

  it('F on the line that sets G20 is converted with the units in force before it (EN gcode_parser.c:627-659)', () => {
    // The board is in G21: the firmware sets F2 as 2 mm/min, then applies G20. X4 is 101.6 mm at
    // 2 × 0.5 mm/min = 6096 s, far above the ceiling. Read as 2 in/min it would have been 240 s.
    const r = run('G20 G91 G1 X4 F2\n', EN);
    expect(r.report.blocked).toBe(false);
    expect(r.report.splits[0]?.seconds).toBeCloseTo((101.6 / 1) * 60, 6);
    expect(r.report.longestMoveSeconds).toBeLessThanOrEqual(MOTION.ceilingSeconds);
    for (const l of r.lines) expect(l.motion?.seconds ?? 0).toBeLessThanOrEqual(MOTION.ceilingSeconds);
    // The same on its own line: `G20 F2` sets 2 mm/min, which later G1 lines run at.
    const own = run('G20 F2\nG91 G1 X0.1\n', EN);
    expect(own.report.splits[0]?.seconds).toBeCloseTo((2.54 / 1) * 60, 6);
    // And back: on a G20 board, `G21 F100` is 100 in/min = 2540 mm/min.
    const back = run('G21 G91 G1 X100 F100\n', EN, { start: { ...START, units: 'G20' } });
    expect(back.lines[0]?.motion?.seconds).toBeCloseTo((100 / 1270) * 60, 9);
  });

  it('F with a G20/G21 on the line and unknown prior units is unknown, not invented', () => {
    const r = run('G20 G91 G1 X1 F10\n', EN, { start: { ...START, units: undefined as never } });
    expect(blocks(r)).toEqual(['unknown-state']);
    expect(r.report.entries[0]?.message).toContain('converts F');
    // On a line that does not move, the feed just becomes unknown and the next feed move is refused.
    expect(blocks(run('G20 F10\nG91 G1 X1\n', EN, { start: { ...START, units: undefined as never } }))).toEqual(['feed-not-set']);
  });
});

describe('offset arithmetic with non-zero values (signs matter)', () => {
  const pos = (X: number): NonNullable<StartState['machine']> => ({ X, Y: 0, Z: 0, A: 0, B: 0, C: 0 });
  const offsets = (g54: number, g55: number): NonNullable<StartState['wcsOffsets']> => ({
    ...START.wcsOffsets,
    G54: { X: g54, Y: 0, Z: 0, A: 0, B: 0, C: 0 },
    G55: { X: g55, Y: 0, Z: 0, A: 0, B: 0, C: 0 },
  });

  it('work = machine - (system offset + G92 + tool offset)', () => {
    // Machine X30, G54 X10, G92 X2 applied, tool offset X1: work X17; G0 X20 is 3 mm.
    const start: StartState = { ...START, machine: pos(30), wcsOffsets: offsets(10, 0), g92: { offsets: { X: 2, Y: 0, Z: 0, A: 0, B: 0, C: 0 }, active: true }, toolOffset: { X: 1, Y: 0, Z: 0, A: 0, B: 0, C: 0 } };
    expect(lengthOf('G0 X20\n', 'G0 X20', start)).toBe(3);
  });

  it('with the machine position unknown, a system switch shifts a known work position by old minus new offset', () => {
    // G92 X0 makes work X known; G54 X10 → G55 X3 adds 7, so work X7 and G0 X0 is 7 mm.
    const start: StartState = { ...START, machine: { Y: 0, Z: 0, A: 0, B: 0, C: 0 }, wcsOffsets: offsets(10, 3) };
    expect(lengthOf('G92 X0\nG55\nG0 X0\n', 'G0 X0', start)).toBe(7);
  });

  it('G92 offset = machine - system offset - tool offset - value', () => {
    // Machine X5, G54 X1: G92 X2 makes the G92 offset 2; in G55 (X3) the work position is 5 - 3 - 2 = 0.
    const start: StartState = { ...START, machine: pos(5), wcsOffsets: offsets(1, 3) };
    expect(lengthOf('G92 X2\nG55\nG0 X1\n', 'G0 X1', start)).toBe(1);
  });

  it('G10 L20 offset = machine - value - G92 - tool offset', () => {
    // Machine X7, G92 X1 applied: G10 L20 P2 X2 makes G55 X4; G55 then reads 7 - 4 - 1 = 2.
    const start: StartState = { ...START, machine: pos(7), g92: { offsets: { X: 1, Y: 0, Z: 0, A: 0, B: 0, C: 0 }, active: true } };
    expect(lengthOf('G10 L20 P2 X2\nG55\nG0 X5\n', 'G0 X5', start)).toBe(3);
  });

  it('G10 L2 on the active system, with the machine position unknown, shifts work by old minus new offset', () => {
    const start: StartState = { ...START, machine: { Y: 0, Z: 0, A: 0, B: 0, C: 0 }, wcsOffsets: offsets(10, 0) };
    // G92 X0: work X0. G10 L2 P1 X4: offset 10 → 4, work +6. G0 X0 is 6 mm.
    expect(lengthOf('G92 X0\nG10 L2 P1 X4\nG0 X0\n', 'G0 X0', start)).toBe(6);
  });

  it('G43.1 with the machine position unknown shifts work by old minus new tool offset; inches scale it', () => {
    const start: StartState = { ...START, machine: { X: 0, Y: 0, A: 0, B: 0, C: 0 } };
    expect(lengthOf('G92 Z0\nG43.1 Z2\nG0 Z0\n', 'G0 Z0', start)).toBe(2);
    expect(lengthOf('G20\nG92 Z0\nG43.1 Z1\nG21 G0 Z0\n', 'G21 G0 Z0', start)).toBeCloseTo(25.4, 9);
  });

  it('G53 moves from the current machine position', () => {
    expect(lengthOf('G53 G0 X10\n', 'G53 G0 X10', { ...START, machine: pos(4) })).toBe(6);
    expect(lengthOf('G20 G53 G0 X1\n', 'G20 G53 G0 X1', { ...START, machine: pos(4) })).toBeCloseTo(21.4, 9);
  });

  it('G28 goes to the intermediate point, then to the stored position from there', () => {
    const start: StartState = { ...START, machine: pos(4), g28: { X: 10, Y: 0, Z: 0, A: 0, B: 0, C: 0 } };
    // From X4: to work X6 (2 mm), then to machine X10 (4 mm).
    expect(lengthOf('G28 X6\n', 'G28 X6', start)).toBe(6);
    // After it, the machine is at the stored position: G0 X10 from there does not move.
    expect(lengthOf('G28 X6\nG0 X10\n', 'G0 X10', start)).toBe(0);
  });

  it('G28/G30 intermediate point: work coordinates on EN, machine coordinates on TG (440.21 absolute override)', () => {
    const offset = { X: 100, Y: 0, Z: 0, A: 0, B: 0, C: 0 };
    const start: StartState = {
      ...START,
      machine: pos(4),
      wcsOffsets: { ...START.wcsOffsets, G54: offset },
      g28: { X: 10, Y: 0, Z: 0, A: 0, B: 0, C: 0 },
      g30: { X: 10, Y: 0, Z: 0, A: 0, B: 0, C: 0 },
    };
    // EN: work X6 is machine X106 (102 mm), then to machine X10 (96 mm).
    expect(lengthOf('G28 X6\n', 'G28 X6', start, EN)).toBe(198);
    // TG: machine X6 (2 mm), then to machine X10 (4 mm).
    expect(lengthOf('G28 X6\n', 'G28 X6', start, TG)).toBe(6);
    expect(lengthOf('G30 X-196\n', 'G30 X-196', start, TG)).toBe(406);
    // Either way the machine ends at the stored position.
    expect(lengthOf('G28 X6\nG53 G0 X10\n', 'G53 G0 X10', start, TG)).toBe(0);
    // The machine position must be known for the TG intermediate leg.
    expect(blocks(run('G28 X6\n', TG, { start: { ...start, machine: { Y: 0, Z: 0, A: 0, B: 0, C: 0 } } }))).toEqual(['unknown-state']);
  });

  it('a rapid exactly at the ceiling is kept; one just above it is split', () => {
    // 50 mm at vm 1200 mm/min × 0.5 = 5 s.
    const motion = { ...MOTION, maxVelocity: { X: 1200 }, feedrateMax: { X: 1200 } };
    const at = run('G0 X50\n', EN, { motion });
    expect(at.lines).toHaveLength(1);
    expect(at.lines[0]?.motion?.seconds).toBe(5);
    expect(run('G0 X50.01\n', EN, { motion }).lines.length).toBeGreaterThan(1);
  });

  it('boundary values are accepted: T0, G10 P6, G4 P0, arc P0', () => {
    expect(run('T0\nG10 L2 P6 X0\nG4 P0\nG2 X10 Y0 I5 P0 F1000\n', EN).report.blocked).toBe(false);
  });

  it('a centre-format arc with one plane endpoint is not a full circle', () => {
    // X10 alone (Y stays): a half circle of r 5, not a full turn.
    expect(lengthOf('G2 X10 I5 F1000\n', 'G2 X10 I5 F1000')).toBeCloseTo(5 * Math.PI, 9);
    expect(lengthOf('G2 Y0 X10 I5 F1000\n', 'G2 Y0 X10 I5 F1000')).toBeCloseTo(5 * Math.PI, 9);
  });

  it('a G90.1 arc centre is absolute: I/J minus the start position', () => {
    const at = { ...START, machine: { X: 10, Y: 0, Z: 0, A: 0, B: 0, C: 0 } };
    // From X10 about the absolute centre X15: a half circle of r 5 to X20.
    expect(lengthOf('G90.1 G2 X20 Y0 I15 J0 F1000\n', 'G90.1 G2 X20 Y0 I15 J0 F1000', at)).toBeCloseTo(5 * Math.PI, 9);
  });

  it('an R arc in inches is scaled', () => {
    expect(lengthOf('G20\nG91 G2 X1 Y0 R0.5 F100\n', 'G91 G2 X1 Y0 R0.5 F100')).toBeCloseTo(0.5 * 25.4 * Math.PI, 9);
  });

  it('a helix models its linear axis too', () => {
    const slowZ = { ...MOTION, maxVelocity: { X: 20000, Y: 20000, Z: 1 }, feedrateMax: { X: 20000, Y: 20000, Z: 1 } };
    // The Z velocity of 1 mm/min makes this short helix slow, so it is split.
    expect(run('G2 X10 Y0 Z1 I5 F1000\n', EN, { motion: slowZ, start: START }).lines.length).toBeGreaterThan(1);
    expect(run('G2 X10 Y0 I5 F1000\n', EN, { motion: slowZ, start: START }).lines).toHaveLength(1);
  });
});


describe('feed moves are limited by fr, rapids by vm (EN plan_line.c:396-400)', () => {
  const frSlow = { ...MOTION, maxVelocity: { ...MOTION.maxVelocity, X: 16000 }, feedrateMax: { ...MOTION.feedrateMax, X: 1000 } };

  it('a G1 faster than fr is modelled at fr and split', () => {
    // min(F 10000, fr 1000) × 0.5 = 500 mm/min: 300 mm is 36 s. At vm it would have been 3.6 s, unsplit.
    const r = run('G91 G1 X300 F10000\n', EN, { motion: frSlow });
    expect(r.report.splits[0]?.seconds).toBeCloseTo(36, 9);
    for (const l of r.lines) expect(l.motion?.seconds ?? 0).toBeLessThanOrEqual(MOTION.ceilingSeconds);
  });

  it('a G0 is still modelled at vm', () => {
    const r = run('G91 G0 X300\n', EN, { motion: frSlow });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.motion?.seconds).toBeCloseTo(300 / 8000 * 60, 9);
  });

  it('an arc is modelled at fr', () => {
    const slowArc = { ...MOTION, feedrateMax: { ...MOTION.feedrateMax, X: 10, Y: 10 } };
    const r = run('G2 X10 Y0 I5 F1000\n', EN, { motion: slowArc });
    expect(r.report.splits[0]?.seconds).toBeCloseTo((5 * Math.PI) / 5 * 60, 6);
  });

  it('a feed move on an axis with no fr is blocked', () => {
    const r = run('G1 X1 F100\n', EN, { motion: { ...MOTION, feedrateMax: { Y: 100 } } });
    expect(blocks(r)).toEqual(['no-velocity-limit']);
  });
});

describe('rotary axis modes (EN canonical_machine.c:497-500 _calc_ABC)', () => {
  const radius = (radiusMm?: number) => ({ ...MOTION, rotary: { ...MOTION.rotary, A: radiusMm === undefined ? { mode: 3 as const } : { mode: 3 as const, radiusMm } } });
  const DEG_PER_MM = 360 / (2 * Math.PI);

  it('a radius-mode axis reads the word in linear units and turns 360 / (2π ra) degrees per mm', () => {
    const r = run('G91 G0 A10\n', EN, { motion: radius(1) });
    expect(r.lines[0]?.motion?.plannerLength).toBeCloseTo(10 * DEG_PER_MM, 9);
    // Absolute from A0 is the same move.
    expect(run('G0 A10\n', EN, { motion: radius(1) }).lines[0]?.motion?.plannerLength).toBeCloseTo(10 * DEG_PER_MM, 9);
  });

  it('under G20 the radius-mode word is inches, and the long move is split within the ceiling', () => {
    const r = run('G20\nG91 G0 A10\n', EN, { motion: radius(1) });
    expect(r.report.blocked).toBe(false);
    expect(r.report.splits[0]?.seconds).toBeCloseTo((254 * DEG_PER_MM) / 10000 * 60, 6);
    for (const l of r.lines) expect(l.motion?.seconds ?? 0).toBeLessThanOrEqual(MOTION.ceilingSeconds);
    // The sub-segments add up to the 10 inches written.
    const total = r.lines.filter((l) => l.origin === 'split').reduce((sum, l) => sum + Number(/A(-?[\d.]+)/.exec(l.body)?.[1]), 0);
    expect(total).toBeCloseTo(10, 6);
  });

  it('an unknown axis mode, a radius-mode axis with no radius, or radius mode with unknown units blocks', () => {
    expect(blocks(run('G0 A10\n', EN, { motion: { ...MOTION, rotary: {} } }))).toEqual(['unknown-state']);
    expect(blocks(run('G0 A10\n', EN, { motion: radius() }))).toEqual(['unknown-state']);
    const units = run('G91 G0 A10\n', EN, { motion: radius(1), start: { ...START, units: undefined as never } });
    expect(blocks(units)).toEqual(['unknown-state']);
    expect(units.report.entries[0]?.message).toContain('the units');
  });

  it('disabled and inhibited axes are modelled as degrees in the planner length (an inhibited motor can still move: inhibited-axis.test.ts)', () => {
    for (const mode of [0, 2] as const) {
      const r = run('G0 A10\n', EN, { motion: { ...MOTION, rotary: { A: { mode } } } });
      expect(r.lines[0]?.motion?.plannerLength, String(mode)).toBe(10);
    }
  });

  it('G28/G30 are blocked while any rotary axis is in radius mode or of unknown mode', () => {
    expect(blocks(run('G28\n', EN, { motion: radius(1) }))).toEqual(['rotary-radius']);
    expect(blocks(run('G30\n', TG, { motion: { ...MOTION, rotary: { A: { mode: 1 }, B: { mode: 1 } } } }))).toEqual(['rotary-radius']);
    expect(run('G28\n', EN).report.blocked).toBe(false);
  });

  it('offsets are never radius-converted: G92 A on a radius-mode axis is degrees', () => {
    // G92 A0 at machine A0, then G91 G0 A1: a 1 mm word is 57.3 degrees.
    expect(lengthOf('G92 A0\nG91 G0 A1\n', 'G91 G0 A1', START)).toBe(1);
    const r = run('G92 A5\nG90 G0 A0\n', EN, { motion: radius(1) });
    // Work A5 in degrees; A0 is a 5 degree move back.
    expect(r.lines[1]?.motion?.plannerLength).toBeCloseTo(5, 9);
  });

  it('rejects malformed rotary configuration and feed rate tables, saying what is wrong', () => {
    const bad = (motion: object): (() => unknown) => () => run('G0 X1\n', EN, { motion: { ...MOTION, ...motion } as never });
    expect(bad({ rotary: { A: { mode: 4 } } })).toThrow(/^rotary\.A\.mode must be 0, 1, 2 or 3$/);
    expect(bad({ rotary: { A: null } })).toThrow(/^rotary\.A\.mode must be 0, 1, 2 or 3$/);
    expect(bad({ rotary: { A: { mode: 3, radiusMm: 0 } } })).toThrow(/^rotary\.A\.radiusMm must be a positive number$/);
    expect(bad({ rotary: { A: { mode: 3, radiusMm: Number.POSITIVE_INFINITY } } })).toThrow(/radiusMm/);
    expect(bad({ rotary: { X: { mode: 1 } } })).toThrow(/^rotary\.X is not a rotary axis$/);
    for (const rotary of [null, undefined, 'A']) expect(bad({ rotary }), String(rotary)).toThrow(/^rotary axis modes must be given/);
    for (const feedrateMax of [null, undefined, 'x']) expect(bad({ feedrateMax }), String(feedrateMax)).toThrow(/^feedrateMax must be given/);
    expect(bad({ feedrateMax: { X: Number.NaN } })).toThrow(/^feedrateMax\.X must be a positive number$/);
    expect(bad({ maxVelocity: { X: 0 } })).toThrow(/^maxVelocity\.X must be a positive number$/);
    expect(bad({ k: 0 })).toThrow(/^k must be in \(0, 1\]/);
    expect(bad({ ceilingSeconds: 1 })).toThrow(/^ceilingSeconds must be from 2 to 20/);
  });
});

describe('rotary offsets under G20 follow the dialect (TG canonical_machine.c:669, :788-789)', () => {
  it('440.21 scales a rotary G10 L2 offset by 25.4 under G20; EN does not', () => {
    const file = 'G20\nG10 L2 P1 A10\nG90 G0 A0\n';
    expect(lengthOf(file, 'G90 G0 A0', START, TG)).toBeCloseTo(254, 9);
    expect(lengthOf(file, 'G90 G0 A0', START, EN)).toBeCloseTo(10, 9);
  });

  it('440.21 scales a rotary G92 value by 25.4 under G20; EN does not', () => {
    const file = 'G20\nG92 A10\nG0 A0\n';
    expect(lengthOf(file, 'G0 A0', START, TG)).toBeCloseTo(254, 9);
    expect(lengthOf(file, 'G0 A0', START, EN)).toBeCloseTo(10, 9);
  });

  it('under G21 both agree', () => {
    expect(lengthOf('G92 A10\nG0 A0\n', 'G0 A0', START, TG)).toBe(10);
  });
});

describe('the tool length offset is applied to X, Y and Z only (EN canonical_machine.c:515-518 vs :530-536)', () => {
  const zero = { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 };

  it('G43.1 A does not move the A target', () => {
    // EN stores A90 but does not add it to A targets: G0 A0 at A0 does not move.
    expect(lengthOf('G43.1 A90\nG0 A0\n', 'G0 A0')).toBe(0);
    // Z is still offset: G43.1 Z5 then G0 Z0 moves 5 mm.
    expect(lengthOf('G43.1 Z5\nG0 Z0\n', 'G0 Z0')).toBe(5);
    // Cancelling a rotary tool offset does not move the A target either.
    expect(lengthOf('G43.1 A90\nG49\nG0 A0\n', 'G0 A0')).toBe(0);
  });

  it('a start tool offset on A does not shift the A work position', () => {
    const start: StartState = { ...START, toolOffset: { ...zero, A: 90 } };
    expect(lengthOf('G0 A10\n', 'G0 A10', start)).toBe(10);
    // Unknown rotary tool offset does not make A moves unknown.
    expect(lengthOf('G0 A10\n', 'G0 A10', { ...START, toolOffset: { X: 0, Y: 0, Z: 0 } })).toBe(10);
  });

  it('G92 and G10 L20 still subtract the stored rotary tool offset, so A then reads value + offset', () => {
    // G92 A0 with A tool offset 90: origin = 0 - 0 - 90 - 0 = -90, target of A0 = -90, a 90 degree move.
    const start: StartState = { ...START, toolOffset: { ...zero, A: 90 } };
    expect(lengthOf('G92 A0\nG0 A0\n', 'G0 A0', start)).toBe(90);
    expect(lengthOf('G10 L20 P1 A0\nG0 A0\n', 'G0 A0', start)).toBe(90);
    // With the rotary tool offset unknown, A is unknown after G92 A.
    expect(blocks(run('G92 A0\nG0 A0\n', EN, { start: { ...START, toolOffset: { X: 0, Y: 0, Z: 0 } } }))).toEqual(['unknown-state']);
  });
});

describe('P0 review model details (mutation-tested)', () => {
  const zero = { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 };

  it('F0 with unknown prior units is a missing feed, not an unknown unit', () => {
    expect(blocks(run('G20 G91 G1 X1 F0\n', EN, { start: { ...START, units: undefined as never } }))).toEqual(['feed-not-set']);
  });

  it('offset words on a rotary axis need no axis mode: G10 and G92 on A pass with no am known', () => {
    const motion = { ...MOTION, rotary: {} };
    expect(run('G10 L2 P1 A5\n', EN, { motion }).report.blocked).toBe(false);
    expect(run('G92 A0\n', EN, { motion }).report.blocked).toBe(false);
  });

  it('names one risky axis with "is"', () => {
    const r = run('G28\n', EN, { motion: { ...MOTION, rotary: { A: { mode: 1 }, B: { mode: 1 }, C: { mode: 3, radiusMm: 1 } } } });
    expect(r.report.entries[0]?.message).toBe('G28 cannot be modelled while C is in radius mode or of unknown axis mode');
  });

  it('radius mode divides by the radius: 10 mm at ra 2 is 286.48 degrees', () => {
    const r = run('G91 G0 A10\n', EN, { motion: { ...MOTION, rotary: { ...MOTION.rotary, A: { mode: 3, radiusMm: 2 } } } });
    expect(r.lines[0]?.motion?.plannerLength).toBeCloseTo((10 * 360) / (2 * Math.PI * 2), 9);
  });

  it('a standard rotary move with unknown units and an unknown position names the position, not the units', () => {
    const r = run('G90 G0 A10\n', EN, { start: { ...START, units: undefined as never, machine: { X: 0, Y: 0, Z: 0 } } });
    expect(r.report.entries[0]?.message).toContain('work position of A');
    expect(r.report.entries[0]?.message).not.toContain('the units');
  });

  it('a split standard rotary move under G20 keeps rotary (degree) decimals', () => {
    const r = run('G20\nG91 G0 A20000.123456\n', EN, { motion: { ...MOTION, maxVelocity: { ...MOTION.maxVelocity, A: 600 } } });
    expect(r.report.blocked).toBe(false);
    for (const l of r.lines.filter((x) => x.origin === 'split').slice(0, -1)) {
      const value = /A(-?[\d.]+)/.exec(l.body)?.[1] ?? '';
      expect(value.split('.')[1]?.length ?? 0, l.body).toBeLessThanOrEqual(4);
    }
  });

  it('an unknown linear tool offset makes the absolute position of that axis unknown', () => {
    expect(blocks(run('G0 X1\n', EN, { start: { ...START, toolOffset: { Y: 0, Z: 0, A: 0, B: 0, C: 0 } } }))).toEqual(['unknown-state']);
  });

  it('G92 on a linear axis is not shifted by the tool offset (work = value exactly)', () => {
    const start: StartState = { ...START, toolOffset: { ...zero, X: 1 } };
    expect(lengthOf('G92 X5\nG0 X0\n', 'G0 X0', start)).toBe(5);
  });

  it('G92 on a rotary axis reads value + stored tool offset (value 10, tool 90: G0 A0 is 100 degrees)', () => {
    const start: StartState = { ...START, toolOffset: { ...zero, A: 90 } };
    expect(lengthOf('G92 A10\nG0 A0\n', 'G0 A0', start)).toBe(100);
    expect(lengthOf('G10 L20 P1 A10\nG0 A0\n', 'G0 A0', start)).toBe(100);
  });

  it('TG G92 A with unknown units leaves A unknown (the 25.4 may or may not apply)', () => {
    expect(blocks(run('G92 A10\nG0 A0\n', TG, { start: { ...START, units: undefined as never } }))).toEqual(['unknown-state']);
  });

  it('G43.1 with unknown units makes that axis unknown', () => {
    const start: StartState = { ...START, units: undefined as never };
    expect(blocks(run('G43.1 Z5\nG21 G0 Z1\n', EN, { start }))).toEqual(['unknown-state']);
  });

  it('G43.1 shifts a work position known only through G92 by the offset (machine position unknown)', () => {
    // Work Z0 after G92; G43.1 Z5 makes work Z -5; G0 Z1 is then a 6 mm move (not 4).
    const start: StartState = { ...START, machine: { X: 0, Y: 0, A: 0, B: 0, C: 0 } };
    expect(lengthOf('G92 Z0\nG43.1 Z5\nG0 Z1\n', 'G0 Z1', start)).toBe(6);
  });
});
