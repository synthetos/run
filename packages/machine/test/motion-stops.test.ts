import { PHASE_1_RELEASE, STOP_TEXT } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { answers, connected, motionLines, num, realtimeNames, req } from './motionHarness.ts';


describe('Pause, Stop job and Spindle off variants', () => {
  it('Pause when the move already ended says nothing changed; a second Stop job re-sends !', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 0.1, feed: 600 });
    d.answer(answers({ stat: num('stat', 3) }), (t) => t === 'stat' && d.state.motion?.phase === 'drain');
    d.intent({ intent: 'feedhold' });
    d.answer(answers({ stat: num('stat', 3) }));
    expect(d.state.notices.motion?.text).toBe(STOP_TEXT.pausedIdle);
    expect(d.state.motion).toBeNull();
    const s = connected();
    req(s, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    s.intent({ intent: 'stopJob' });
    const n = realtimeNames(s).length;
    s.intent({ intent: 'stopJob' });
    expect(realtimeNames(s).slice(n)).toEqual(['feedhold']);
  });
});

describe('Pause, Stop job and Spindle off variants', () => {
  it('Spindle off during a jog ends it like Stop job, once; a release with no hold jog sends nothing', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    expect(d.intent({ intent: 'spindleOffNow' }).allowed).toBe(true);
    expect(d.state.base).toBe('STOPPING_JOB');
    const n = realtimeNames(d).length;
    d.intent({ intent: 'spindleOffNow', outputs: 'spindle' });
    expect(realtimeNames(d).length).toBe(n);
    const r = connected();
    req(r, { intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 });
    const m = realtimeNames(r).length;
    expect(r.intent({ intent: 'feedhold', release: true }).allowed).toBe(true);
    expect(realtimeNames(r).length).toBe(m);
    const ro = connected({}, { release: PHASE_1_RELEASE });
    expect(ro.intent({ intent: 'feedhold', release: true }).allowed).toBe(true);
    expect(realtimeNames(ro)).toEqual([]);
  });
});

describe('Pause, Stop job and Spindle off variants', () => {
  it('Spindle off alone is M5; under ORPHANED_MOTION Stop job stays ! with "Use your E-stop"', () => {
    const d = connected();
    d.intent({ intent: 'spindleOffNow', outputs: 'spindle' });
    d.answer(answers());
    expect(motionLines(d)).toEqual(['M5']);
    const o = connected({ stat: num('stat', 5) });
    expect(o.state.overlays).toContain('ORPHANED_MOTION');
    o.intent({ intent: 'stopJob' });
    expect(realtimeNames(o)).toEqual(['feedhold']);
    expect(o.state.notices.adviseEstop).toBe(true);
  });
});

describe('Pause, Stop job and Spindle off variants', () => {
  it('a Stop job from CONNECTED_UNKNOWN returns there', () => {
    const d = connected({}, { unknown: true });
    d.intent({ intent: 'stopJob' });
    d.answer(answers());
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.notices.motion?.text).toBe(STOP_TEXT.stopped);
  });
});
