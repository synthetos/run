/**
 * Phase 0 finding row 35, its Phase 1 consequence: a read-only session
 * surfaces (never hides) axis-mode facts that are unsafe for later motion
 * (src/axisModeFacts.ts). The cross-check at the end ties the facts to the
 * sanitiser: whenever the facts say "inhibited away from 0" or "mode not
 * read", the sanitiser blocks motion for the same axis, and a clean set of
 * facts never coexists with an inhibited-axis block.
 */
import { TINYG_440, TINYG_EN } from '@synthetos/protocol';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AXES,
  EMPTY_AXIS_MODE_SESSION,
  INHIBITED_JOINT_BEHAVIOUR,
  axisModeFacts,
  type Axis,
  type AxisModeReading,
  type MotionModel,
  type StartState,
} from '../src/index.ts';
import { MOTION, START, blocks, run, runs } from './sanitizeHelpers.ts';

const ALL_STANDARD = { X: 1, Y: 1, Z: 1, A: 1, B: 1, C: 1 } as const;
const ZERO = { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 } as const;
const reading = (modes: Partial<Record<Axis, number>>, machine: Partial<Record<Axis, number | null>> = ZERO): AxisModeReading => ({ modes, machine });
const codes = (r: AxisModeReading, family: 'tinyg' | 'g2core' = 'tinyg') => axisModeFacts(family, r).facts.map((f) => `${f.axis}:${f.code}`);

describe('axisModeFacts', () => {
  it('reports nothing for an all-standard machine', () => {
    expect(codes(reading(ALL_STANDARD))).toEqual([]);
  });

  it('never assumes an axis that was not read: each one is mode-not-read', () => {
    expect(codes(reading({}))).toEqual(AXES.map((a) => `${a}:mode-not-read`));
    expect(codes(reading({ X: 1, Y: 1, Z: 1 }))).toEqual(['A:mode-not-read', 'B:mode-not-read', 'C:mode-not-read']);
  });

  it('the row 35 reproduction: A inhibited at 30 degrees is reported, with its position', () => {
    const { facts } = axisModeFacts('tinyg', reading({ ...ALL_STANDARD, A: 2 }, { ...ZERO, A: 30 }));
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ axis: 'A', code: 'inhibited-away-from-zero', mode: 2, position: 30, unsafeForMotion: true });
    expect(facts[0]?.text).toContain('A is inhibited (aam=2) and it reads 30');
    expect(facts[0]?.text).toContain('next move of any axis');
  });

  it('an inhibited axis whose position is unknown is reported as away from 0', () => {
    expect(codes(reading({ ...ALL_STANDARD, Y: 2 }, { ...ZERO, Y: null }))).toEqual(['Y:inhibited-away-from-zero']);
    expect(codes(reading({ ...ALL_STANDARD, Y: 2 }, { X: 0 }))).toEqual(['Y:inhibited-away-from-zero']);
    expect(codes(reading({ ...ALL_STANDARD, Y: 2 }, { ...ZERO, Y: Number.NaN }))).toEqual(['Y:inhibited-away-from-zero']);
  });

  it('an inhibited axis at 0 is still reported (the remainder: a later mode change needs a resync)', () => {
    const { facts } = axisModeFacts('tinyg', reading({ ...ALL_STANDARD, B: 2 }));
    expect(facts.map((f) => f.code)).toEqual(['inhibited']);
    expect(facts[0]?.text).toContain('G28.3');
  });

  it('leaving inhibited mode during the session is reported for the rest of the session, disabled included', () => {
    const first = axisModeFacts('tinyg', reading({ ...ALL_STANDARD, A: 2 }));
    for (const next of [1, 0, 3]) {
      const second = axisModeFacts('tinyg', reading({ ...ALL_STANDARD, A: next }), first.session);
      expect(second.facts.map((f) => `${f.axis}:${f.code}`)).toEqual(['A:left-inhibited-this-session']);
      // It stays: a third read in standard mode still reports it.
      const third = axisModeFacts('tinyg', reading(ALL_STANDARD), second.session);
      expect(third.facts.map((f) => f.code)).toEqual(['left-inhibited-this-session']);
    }
    // A new session starts clean.
    expect(axisModeFacts('tinyg', reading(ALL_STANDARD), EMPTY_AXIS_MODE_SESSION).facts).toEqual([]);
  });

  it('a linear axis disabled or in radius mode is reported; a rotary one is not (the sanitiser models it)', () => {
    expect(codes(reading({ ...ALL_STANDARD, Z: 0 }))).toEqual(['Z:linear-disabled']);
    expect(codes(reading({ ...ALL_STANDARD, X: 3 }))).toEqual(['X:linear-radius']);
    expect(codes(reading({ ...ALL_STANDARD, A: 0, B: 3 }))).toEqual([]);
  });

  it('a value outside 0..3 is reported, never mapped to a mode', () => {
    expect(codes(reading({ ...ALL_STANDARD, C: 7 }))).toEqual(['C:mode-not-recognised']);
    expect(codes(reading({ ...ALL_STANDARD, C: 1.5 }))).toEqual(['C:mode-not-recognised']);
    expect(codes(reading({ ...ALL_STANDARD, C: -1 }))).toEqual(['C:mode-not-recognised']);
  });

  it('is data-driven per family: where the inhibited-joint behaviour is not verified, every inhibited axis is reported as such', () => {
    expect(INHIBITED_JOINT_BEHAVIOUR).toEqual({ tinyg: 'cited', g2core: 'unverified' });
    expect(codes(reading({ ...ALL_STANDARD, A: 2 }), 'g2core')).toEqual(['A:inhibited-behaviour-unverified']);
    expect(codes(reading({ ...ALL_STANDARD, A: 2 }, { ...ZERO, A: 30 }), 'g2core')).toEqual(['A:inhibited-behaviour-unverified']);
  });

  it('each fact says, in plain words, which axis, what was read and why motion stays blocked', () => {
    const text = (r: AxisModeReading, family: 'tinyg' | 'g2core' = 'tinyg', session = EMPTY_AXIS_MODE_SESSION) => axisModeFacts(family, r, session).facts.map((f) => f.text);
    expect(text(reading({ X: 1, Y: 1, Z: 1, A: 1, B: 1 }))).toEqual([
      'The axis mode of C (cam) was not read, so C may be inhibited or disabled. Motion stays blocked until it is read.',
    ]);
    expect(text(reading({ ...ALL_STANDARD, C: 7 }))).toEqual(['C reports axis mode cam=7, which is not a mode this controller defines. Motion stays blocked.']);
    expect(text(reading({ ...ALL_STANDARD, Y: 2 }, { X: 0 }))).toEqual([
      "Y is inhibited (yam=2) and its position is not known. TinyG drives an inhibited axis's motor to step 0 on the next move of any axis, by an amount no overrun bound covers. Motion stays blocked until Y reads 0.",
    ]);
    expect(text(reading({ ...ALL_STANDARD, A: 2 }, { ...ZERO, A: 12.5 }), 'g2core')).toEqual([
      "A is inhibited (aam=2) and it reads 12.5. How this controller moves an inhibited axis's motor is not verified, so motion stays blocked.",
    ]);
    expect(text(reading({ ...ALL_STANDARD, A: 2 }, { ...ZERO, A: null }), 'g2core')).toEqual([
      "A is inhibited (aam=2) and its position is not known. How this controller moves an inhibited axis's motor is not verified, so motion stays blocked.",
    ]);
    expect(text(reading({ ...ALL_STANDARD, B: 2 }))).toEqual([
      'B is inhibited (bam=2) and reads 0. If its mode is changed later, re-home or set its position (G28.3) before any move: the board does not report where its motor is.',
    ]);
    const was = axisModeFacts('tinyg', reading({ ...ALL_STANDARD, B: 2 })).session;
    expect(text(reading({ ...ALL_STANDARD, B: 0 }), 'tinyg', was)).toEqual([
      'B read inhibited earlier in this session and now reads bam=0. Its motor may not be where its position says, and no read shows it; the next move of any axis could drive it there. Motion stays blocked until B is re-homed or its position is set.',
    ]);
    expect(text(reading({ ...ALL_STANDARD, Z: 0 }))).toEqual(['Z is disabled (zam=0): TinyG ignores Z words, so a program would not run as written. Motion on Z stays blocked.']);
    expect(text(reading({ ...ALL_STANDARD, X: 3 }))).toEqual([
      'X reads radius mode (xam=3), which TinyG refuses on a linear axis and in which it ignores X words. Motion on X stays blocked.',
    ]);
  });

  it('a position that is not a finite number counts as unknown', () => {
    for (const p of [null, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      const { facts } = axisModeFacts('tinyg', reading({ ...ALL_STANDARD, Y: 2 }, { ...ZERO, Y: p as number | null }));
      expect(facts[0]?.position, String(p)).toBeNull();
    }
    expect(axisModeFacts('tinyg', reading({ ...ALL_STANDARD, Y: 2 }, { ...ZERO, Y: -3.25 })).facts[0]?.position).toBe(-3.25);
  });

  it('every fact is unsafe for motion, frozen, and its text is plain (no markup, no signal word)', () => {
    const { facts } = axisModeFacts('tinyg', reading({ X: 0, Y: 2, Z: 3, A: 9 }, { Y: 5 }));
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.unsafeForMotion).toBe(true);
      expect(Object.isFrozen(f)).toBe(true);
      expect(f.text).not.toMatch(/[<>]|WARNING|DANGER|NOTICE/);
    }
  });
});

describe('cross-check with the sanitiser (row 35): a fact is shown whenever motion would be blocked for that reason', () => {
  const MODE = fc.constantFrom(0, 1, 2, 3, undefined);
  const POS = fc.constantFrom(0, 0.001, 20, -5, null);

  function motionFor(modes: Partial<Record<Axis, number>>): MotionModel {
    const linear: MotionModel['linear'] = {};
    const rotary: MotionModel['rotary'] = {};
    for (const a of ['X', 'Y', 'Z'] as const) if (modes[a] !== undefined) (linear as Record<string, number>)[a] = modes[a] as number;
    for (const a of ['A', 'B', 'C'] as const) if (modes[a] !== undefined) (rotary as Record<string, { mode: number }>)[a] = { mode: modes[a] as number };
    return { ...MOTION, linear, rotary } as MotionModel;
  }

  it.each([
    ['EN', TINYG_EN],
    ['440.21', TINYG_440],
  ])('%s: inhibited-axis blocks exactly when the facts report an inhibited or unread axis away from 0', (_name, dialect) => {
    fc.assert(
      fc.property(fc.tuple(MODE, MODE, MODE, MODE, MODE, MODE), fc.tuple(POS, POS, POS, POS, POS, POS), (ms, ps) => {
        const modes: Partial<Record<Axis, number>> = {};
        const machine: Partial<Record<Axis, number | null>> = {};
        AXES.forEach((a, i) => {
          if (ms[i] !== undefined) modes[a] = ms[i] as number;
          machine[a] = ps[i] ?? null;
        });
        const { facts } = axisModeFacts('tinyg', { modes, machine });
        const risky = new Set(facts.filter((f) => f.code === 'inhibited-away-from-zero' || (f.code === 'mode-not-read' && f.position !== 0)).map((f) => f.axis));
        // An X-only move, the shape of the row 35 reproduction, on a fully specified start state.
        const start: StartState = { ...START, machine: Object.fromEntries(AXES.map((a) => [a, machine[a] ?? null])) as NonNullable<StartState['machine']> };
        const r = run('G1 X1 F600\n', dialect, { motion: motionFor(modes), start });
        const inhibitedBlock = blocks(r).includes('inhibited-axis');
        expect(inhibitedBlock).toBe(risky.size > 0);
        // No axis-mode fact: no axis-mode reason to block (an unknown position is another reason, unknown-state).
        if (facts.length === 0) expect(blocks(r).filter((b) => b === 'inhibited-axis' || b === 'axis-mode')).toEqual([]);
        // A disabled or radius X (the moved axis) is reported and blocked.
        if (facts.some((f) => f.axis === 'X' && (f.code === 'linear-disabled' || f.code === 'linear-radius'))) expect(blocks(r)).toContain('axis-mode');
      }),
      { numRuns: runs(400) },
    );
  });
});
