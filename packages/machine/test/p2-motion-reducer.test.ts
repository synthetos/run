import { STOP_TEXT } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { answers, connected, motionLines, num, realtimeNames, req } from './motionHarness.ts';


describe('more branches', () => {
  it('a hold that the board ignored (moving, hold 0) gets ! again on the next poll', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    d.intent({ intent: 'feedhold' });
    const n = realtimeNames(d).length;
    const moving = answers({ stat: num('stat', 5), vel: num('vel', 10), qr: num('qr', 31) });
    // The first cycle after `!` may predate it: no re-send yet. The second still moving with hold 0: `!` again.
    d.answer(moving, (t) => t === 'stat' && (d.state.motion?.holdPolls ?? 0) >= 2);
    expect(realtimeNames(d).slice(n)).toEqual(['feedhold']);
  });
});

describe('more branches', () => {
  it('go to zero while a jog runs is refused; a second Resume before the first poll is refused', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    expect(req(d, { intent: 'goToZero', axes: ['z'], safeZ: 0 })).toMatchObject({ allowed: false, reason: 'Another move is still running.' });
    d.intent({ intent: 'feedhold' });
    d.answer(answers({ stat: num('stat', 6), hold: num('hold', 6), qr: num('qr', 31) }));
    expect(d.state.base).toBe('HELD');
    expect(req(d, { intent: 'resume' }).allowed).toBe(true);
    expect(req(d, { intent: 'resume' }).allowed).toBe(false);
  });
});

describe('more branches', () => {
  it('a second release while the hold step runs sends nothing more', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { y: -1 }, distanceMm: null, feed: 600 });
    d.intent({ intent: 'feedhold', release: true });
    const n = realtimeNames(d).length;
    d.intent({ intent: 'feedhold', release: true });
    expect(realtimeNames(d).length).toBe(n);
  });
});

describe('more branches', () => {
  it('a refused closing line still completes the stop, with the refusal kept', () => {
    const d = connected();
    d.intent({ intent: 'stopJob' });
    d.answer(answers({ gc: '{"r":{"gc":"M5"},"f":[3,130,10]}' }));
    expect(d.state.motion).toBeNull();
    expect(d.state.notices.motion?.text).toBe(STOP_TEXT.stopped);
  });
});

describe('more branches', () => {
  it('CCW is M4; an answer that echoes the line as gc is accepted; a poll with an error status changes nothing', () => {
    const d = connected();
    req(d, { intent: 'spindleOn', output: 'spindle', direction: 'ccw', rpm: 800 });
    d.answer(answers({ gc: '{"r":{"gc":"M4S800"},"f":[3,0,10]}' }));
    expect(motionLines(d)).toEqual(['M4 S800']);
    expect(d.state.overlays).toEqual([]);
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 0.1, feed: 600 });
    d.answer(answers({ stat: '{"r":{},"f":[3,100,10]}', vel: num('vel', 0) }), (t) => t === 'qr');
    expect(d.state.live.stat).toBe(1);
  });
});
