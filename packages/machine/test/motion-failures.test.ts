import { STOP_TEXT } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import {
  MOTION_LIMITS
} from '../src/index.ts';
import { OK, answers, connected, modes, motionLines, num, realtimeNames, req } from './motionHarness.ts';


describe('refusals, timeouts and damaged answers', () => {
  it('a refused jog piece ends the jog with the board\'s status; a refused single line says so', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    d.answer(answers({ gc: '{"r":{},"f":[3,204,10]}', hold: num('hold', 6), stat: num('stat', 6) }), (t) => t === 'qr' && d.state.motion?.phase === 'flush');
    d.answer(answers({ hold: num('hold', 0), qr: num('qr', 32) }));
    expect(realtimeNames(d)).toContain('flush');
    expect(d.state.motion).toBeNull();
    expect(d.state.notices.motion).toMatchObject({ kind: 'refused' });
    expect(d.state.notices.motion?.text).toContain('status 204');
    const z = connected();
    req(z, { intent: 'setWorkZero', axes: ['x'] });
    z.answer(answers({ gc: '{"r":{},"f":[3,130,10]}' }));
    expect(z.state.notices.change).toMatchObject({ kind: 'refused' });
    expect(z.state.notices.change?.text).toContain('G10 L20 P1 X0');
    expect(z.state.motion).toBeNull();
  });
});

describe('refusals, timeouts and damaged answers', () => {
  it('a hold that is never reported is W12: FAULT stopNotConfirmed after the stop step time', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    d.answer(answers({ stat: num('stat', 5), vel: num('vel', 10), qr: num('qr', 31) }));
    d.intent({ intent: 'stopJob' });
    d.answer(answers({ stat: num('stat', 5), vel: num('vel', 10), qr: num('qr', 31) }));
    d.at += MOTION_LIMITS.stopStepMs + 1;
    d.fire('motion');
    expect(d.state.overlays).toContain('FAULT');
    expect(d.state.fault?.cause).toBe('stopNotConfirmed');
    expect(d.state.motion).toBeNull();
    expect(d.state.notices.motion?.kind).toBe('failed');
  });
});

describe('refusals, timeouts and damaged answers', () => {
  it('a flush that never empties the planner is W12 too', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    d.intent({ intent: 'stopJob' });
    const held = answers({ stat: num('stat', 6), hold: num('hold', 6), qr: num('qr', 30) });
    d.answer(held, (t) => t === 'stat' && d.state.motion?.phase === 'flush');
    expect(d.state.motion?.phase).toBe('flush');
    d.answer(held);
    d.at += MOTION_LIMITS.stopStepMs + 1;
    d.fire('motion');
    expect(d.state.fault?.detail).toContain('empty queue');
  });
});

describe('refusals, timeouts and damaged answers', () => {
  it('a damaged answer to a motion line is a FAULT (and a FAULT while moving holds); a damaged poll is asked again', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    modes(d);
    d.written();
    const from = d.effects.length;
    d.line('{"r":{"gc":"G1"},"f":[3,0');
    expect(d.state.overlays).toContain('FAULT');
    expect(realtimeNames(d, from)).toEqual(['feedhold']);
    const p = connected();
    req(p, { intent: 'jog', axes: { x: 1 }, distanceMm: 0.1, feed: 600 });
    modes(p);
    p.written();
    p.line(OK); // G21
    p.written();
    p.line(OK); // the piece
    p.written();
    p.line('{"r":{"stat":3},"f":[3,0');
    expect(p.state.overlays).not.toContain('FAULT');
  });
});

describe('refusals, timeouts and damaged answers', () => {
  it('a FAULT while held writes nothing more; Stop job under FAULT still runs the flush sequence', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    d.intent({ intent: 'feedhold' });
    const held = answers({ stat: num('stat', 6), hold: num('hold', 6), qr: num('qr', 31) });
    d.answer(held);
    expect(d.state.base).toBe('HELD');
    const from = d.effects.length;
    d.line('{"er":{"fb":450.01,"st":13,"msg":"x"}}');
    expect(d.state.overlays).toContain('FAULT');
    expect(realtimeNames(d, from)).toEqual([]);
    expect(d.intent({ intent: 'stopJob' }).allowed).toBe(true);
    d.answer(held, (t) => t === 'stat' && d.state.motion?.phase === 'flush');
    d.answer(answers({ qr: num('qr', 32) }));
    expect(motionLines(d, from)).toEqual(['M5', 'M9', 'G90']);
    expect(d.state.notices.motion?.text).toBe(STOP_TEXT.stopped);
  });
});

describe('refusals, timeouts and damaged answers', () => {
  it('a queued motion line the matrix no longer allows is dropped, never written later', () => {
    const d = connected();
    req(d, { intent: 'read', tokens: ['posx'] });
    d.written();
    req(d, { intent: 'setWorkZero', axes: ['x'] });
    d.fire('answer'); // the read went unanswered: STALE
    expect(d.state.overlays).toContain('STALE');
    expect(d.state.queue.some((q) => q.purpose === 'motion')).toBe(false);
    expect(motionLines(d)).toEqual([]);
  });
});
