import { PHASE_1_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { answers, connected, motionLines, num, req } from './motionHarness.ts';


describe('connect in a motion session', () => {
  it('a homed board is IDLE_HOMED; an alarmed quiet board is ALARM; Clear alarm returns to idle', () => {
    expect(connected({ home: num('home', 1) }).state.base).toBe('IDLE_HOMED');
    const d = connected({ stat: num('stat', 2) });
    expect(d.state.base).toBe('ALARM');
    expect(d.state.overlays).toEqual([]);
    expect(req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 }).allowed).toBe(false);
    const from = d.effects.length;
    expect(req(d, { intent: 'clearAlarm' }).allowed).toBe(true);
    d.answer(answers({ stat: num('stat', 1), home: num('home', 1) }));
    expect(motionLines(d, from)).toEqual(['{"clear":null}']);
    expect(d.state.base).toBe('IDLE_HOMED');
  });
});

describe('connect in a motion session', () => {
  it('after a reconnect (UNKNOWN) motion waits for "I\'ve checked the machine"; in Phase 1 it only clears UNKNOWN', () => {
    const d = connected({}, { unknown: true });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(['UNKNOWN']);
    expect(req(d, { intent: 'positionVerify' }).allowed).toBe(true);
    expect(d.state.base).toBe('IDLE_UNHOMED');
    expect(d.state.overlays).toEqual([]);
    // Never a trap (amendment 2026-11-02): without motion the acknowledgement clears UNKNOWN and nothing moves.
    const p1 = connected({}, { release: PHASE_1_RELEASE, unknown: true });
    expect(req(p1, { intent: 'positionVerify' })).toMatchObject({ allowed: true });
    expect(p1.state.overlays).not.toContain('UNKNOWN');
    expect(p1.state.base).toBe('CONNECTED_UNKNOWN');
  });
});

describe('connect in a motion session', () => {
  it('an alarm report while idle or jogging ends the motion and moves to ALARM', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    d.line('{"sr":{"stat":2}}');
    expect(d.state.base).toBe('ALARM');
    expect(d.state.motion).toBeNull();
    expect(d.state.notices.motion?.kind).toBe('failed');
    const idle = connected();
    idle.line('{"sr":{"stat":2}}');
    expect(idle.state.base).toBe('ALARM');
    expect(idle.state.notices.motion).toBeUndefined();
  });
});
