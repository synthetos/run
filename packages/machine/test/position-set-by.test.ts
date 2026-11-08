/**
 * How the machine position was set, for the words only (first-time walk 2026-11-08, S2). A homing and a G28.3
 * both read back `home` 1; the session notes which of its own commands it was, so the page never calls a
 * position set by hand "Homed". Nothing decides on the note.
 */
import { describe, expect, it } from 'vitest';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import type { SessionEffect, SessionState } from '../src/index.ts';
import { initialState } from '../src/session/reducer.ts';
import { onFollowUp, type MotionTx } from '../src/session/motion.ts';
import { DEFAULT_TIMINGS } from '../src/session/types.ts';
import { EN_APPROVED } from './jobHarness.ts';

function tx(s: SessionState): MotionTx {
  const fx: SessionEffect[] = [];
  const t: MotionTx = {
    s,
    config: { release: PHASE_2_RELEASE, manifest: EN_APPROVED, timings: DEFAULT_TIMINGS },
    set(patch) {
      t.s = { ...t.s, ...patch };
    },
    emit(e) {
      fx.push(e);
    },
    arm() {},
    cancel() {},
  };
  return t;
}

const homedState = (home: number): SessionState => {
  const s = initialState();
  return { ...s, base: 'IDLE_UNHOMED', live: { ...s.live, home } };
};

describe('notices.position (S2)', () => {
  it('a G28.3 read back with home 1 is noted as set by hand', () => {
    const t = tx(homedState(1));
    onFollowUp(t, 'positionSet', 10);
    expect(t.s.notices.position).toEqual({ by: 'hand', at: 10 });
  });
  it('a homing read back with home 1 is noted as homing, and replaces a set by hand', () => {
    const t = tx({ ...homedState(1), notices: { adviseEstop: false, position: { by: 'hand', at: 1 } } });
    onFollowUp(t, 'homed', 20);
    expect(t.s.notices.position).toEqual({ by: 'homing', at: 20 });
  });
  it('nothing is noted while the board does not report X, Y and Z homed', () => {
    const t = tx(homedState(0));
    onFollowUp(t, 'positionSet', 30);
    expect(t.s.notices.position).toBeUndefined();
  });
});
