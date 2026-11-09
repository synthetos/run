/** The last motion result goes when the next action starts (first-time walk 2026-11-08, C25). */
import { describe, expect, it } from 'vitest';
import type { SessionState } from '../src/index.ts';
import { initialState } from '../src/session/reducer.ts';
import { clearMotionNotice } from '../src/session/motion.ts';

function tx(s: SessionState): { s: SessionState; set(patch: Partial<SessionState>): void } {
  const t = { s, set(patch: Partial<SessionState>) { t.s = { ...t.s, ...patch }; } };
  return t;
}

describe('clearMotionNotice (C25)', () => {
  it('drops the last motion result and keeps every other notice', () => {
    const s = initialState();
    const t = tx({ ...s, notices: { adviseEstop: true, motion: { kind: 'stopped', text: 'Stopped: queue cleared, spindle and coolant off', at: 1 } } });
    clearMotionNotice(t);
    expect(t.s.notices.motion).toBeUndefined();
    expect(t.s.notices.adviseEstop).toBe(true);
  });
  it('does nothing when there is none', () => {
    const t = tx(initialState());
    const before = t.s;
    clearMotionNotice(t);
    expect(t.s).toBe(before);
  });
});
