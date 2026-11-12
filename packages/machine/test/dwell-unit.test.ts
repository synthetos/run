import { describe, expect, it } from 'vitest';
import { dialectById, mapStat } from '@synthetos/protocol';
import { acknowledgeDwell, DWELL_MARGIN_MS, observeDwellPoll, restartDwellWait } from '../src/session/dwell.ts';
import type { PolledValues, SessionState } from '../src/session/types.ts';

const EN = dialectById('tinyg-en')!;
const IDLE = Number(Object.keys(EN.stat).find((k) => mapStat(EN, Number(k)) === 'idle'));
const RUN = Number(Object.keys(EN.stat).find((k) => mapStat(EN, Number(k)) === 'running'));

/** The few fields the dwell ledger reads; everything else in the session is irrelevant here. */
function tx(over: Partial<Record<string, unknown>> = {}): { s: SessionState; set(p: Partial<SessionState>): void; sets: number } {
  const t = {
    s: { dialect: EN, dwellWait: null, expected: [], queue: [], writing: null, job: null, ...over } as unknown as SessionState,
    sets: 0,
    set(p: Partial<SessionState>) { t.s = { ...t.s, ...p }; t.sets++; },
  };
  return t;
}
const poll = (over: Partial<PolledValues> = {}): PolledValues =>
  ({ stat: IDLE, hold: 0, vel: 0, qr: EN.limits.plannerBlocks, ...over }) as PolledValues;

describe('acknowledgeDwell', () => {
  it('ignores a missing line', () => {
    const t = tx();
    acknowledgeDwell(t, undefined);
    expect(t.sets).toBe(0);
  });
  it('adds P seconds in ms, case-insensitive, and treats G4 without P as zero', () => {
    const t = tx();
    acknowledgeDwell(t, 'g4 p1.5');
    expect(t.s.dwellWait).toEqual({ durationMs: 1500, until: null });
    acknowledgeDwell(t, 'G04');
    expect(t.s.dwellWait).toEqual({ durationMs: 1500, until: null });
  });
  it('a non-dwell line restarts a pending wait but starts none', () => {
    const idle = tx();
    acknowledgeDwell(idle, 'G1 X1 F100');
    expect(idle.sets).toBe(0);
    const pending = tx({ dwellWait: { durationMs: 2000, until: 9 } });
    acknowledgeDwell(pending, 'G90');
    expect(pending.s.dwellWait).toEqual({ durationMs: 2000, until: null });
  });
});

describe('restartDwellWait', () => {
  it('does nothing without a pending wait', () => {
    const t = tx();
    restartDwellWait(t);
    expect(t.sets).toBe(0);
  });
});

describe('observeDwellPoll', () => {
  it('does nothing without a pending wait', () => {
    const t = tx();
    observeDwellPoll(t, poll(), 0);
    expect(t.sets).toBe(0);
  });
  it('a missing poll or an unknown dialect cannot prove rest', () => {
    const missing = tx({ dwellWait: { durationMs: 1000, until: 5 } });
    observeDwellPoll(missing, null, 10);
    expect(missing.s.dwellWait).toEqual({ durationMs: 1000, until: null });
    const noDialect = tx({ dialect: null, dwellWait: { durationMs: 1000, until: 5 } });
    observeDwellPoll(noDialect, poll(), 10);
    expect(noDialect.s.dwellWait).toEqual({ durationMs: 1000, until: null });
  });
  it('a data line being written, queued or owed keeps the wait from counting', () => {
    const cases = [
      { writing: { token: 'gc', purpose: 'job' } },
      { queue: [{ token: 'gc', purpose: 'motion' }] },
      { expected: [{ token: 'gc', purpose: 'probeZ', late: false }] },
    ];
    for (const c of cases) {
      const t = tx({ ...c, dwellWait: { durationMs: 1000, until: 5 } });
      observeDwellPoll(t, poll(), 10);
      expect(t.s.dwellWait).toEqual({ durationMs: 1000, until: null });
    }
    const notData = tx({ writing: { token: 'qr', purpose: 'poll' }, dwellWait: { durationMs: 1000, until: null } });
    observeDwellPoll(notData, poll(), 10);
    expect(notData.s.dwellWait?.until).toBe(10 + 1000 + DWELL_MARGIN_MS);
  });
  it('a busy poll restarts; quiet polls start the interval, then discharge it', () => {
    const t = tx({ dwellWait: { durationMs: 1000, until: null } });
    observeDwellPoll(t, poll({ stat: RUN }), 0);
    expect(t.s.dwellWait?.until).toBeNull();
    observeDwellPoll(t, poll(), 100);
    expect(t.s.dwellWait?.until).toBe(100 + 1000 + DWELL_MARGIN_MS);
    observeDwellPoll(t, poll(), 500);
    expect(t.s.dwellWait).not.toBeNull();
    observeDwellPoll(t, poll(), 100 + 1000 + DWELL_MARGIN_MS);
    expect(t.s.dwellWait).toBeNull();
  });
});
