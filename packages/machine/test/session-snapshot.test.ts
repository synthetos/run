/**
 * The snapshot posted from machine.worker to the window (ROADMAP P1-02):
 * frozen, structured-clone safe, with strings from the board capped.
 */
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_STRING_MAX, snapshotOf } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

describe('snapshotOf', () => {
  it('is frozen, clones across threads, and shows the probe progress while identifying', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'fv');
    const s = snapshotOf(d.state);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.live)).toBe(true);
    expect(structuredClone(s)).toEqual(s);
    expect(s).toMatchObject({ base: 'IDENTIFYING', primaryOverlay: null, probe: { answered: 2, of: 12, banner: 'none', restarts: 0 }, port: { kind: 'sim' } });
    d.answer(EN_ANSWERS);
    expect(snapshotOf(d.state)).toMatchObject({ base: 'CONNECTED_UNKNOWN', probe: null, primaryOverlay: 'READ_ONLY', footerRev: 3, lastAckAt: null, ackVerifying: false });
  });

  it('caps every string that came from the board', () => {
    const long = 'Z'.repeat(SNAPSHOT_STRING_MAX + 50);
    const d = new Driver();
    d.open();
    d.answer({
      ...EN_ANSWERS,
      id: `{"r":{"id":"${long}"},"f":[3,0,10]}`,
      hp: `{"r":{"hp":"${long}"},"f":[3,0,10]}`,
      hv: `{"r":{"hv":"${long}"},"f":[3,0,10]}`,
      fbs: `{"r":{"fbs":"${long}"},"f":[3,0,10]}`,
    });
    const s = snapshotOf(d.state);
    for (const value of [s.identity?.id, s.identity?.hp, s.identity?.hv, s.identity?.fbs, s.classification?.detail]) {
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeLessThanOrEqual(SNAPSHOT_STRING_MAX + 1);
    }
    expect(s.identity?.id).toBe(`${'Z'.repeat(SNAPSHOT_STRING_MAX)}…`);
  });

  it('caps the blocked ids and the fault detail, and keeps a null reported id', () => {
    const long = 'M'.repeat(SNAPSHOT_STRING_MAX * 2);
    const d = new Driver();
    d.open(long);
    d.answer({ ...EN_ANSWERS, id: '{"r":{},"f":[3,100,10]}' });
    expect(snapshotOf(d.state).blocked).toEqual({ expected: `${'M'.repeat(SNAPSHOT_STRING_MAX)}…`, reported: null });
    const e = new Driver();
    e.open(long);
    e.answer({ ...EN_ANSWERS, id: `{"r":{"id":"${long}x"},"f":[3,0,10]}` });
    expect(snapshotOf(e.state).blocked?.reported).toBe(`${'M'.repeat(SNAPSHOT_STRING_MAX)}…`);
    e.line(`{"er":{"fb":450.01,"st":20,"msg":"${'x'.repeat(500)}"}}`);
    expect(snapshotOf(e.state).fault?.detail.length).toBeLessThanOrEqual(SNAPSHOT_STRING_MAX + 1);
  });
});
