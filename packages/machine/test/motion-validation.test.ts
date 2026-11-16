import { describe, expect, it } from 'vitest';
import {
  MAX_MOTION_MM,
  MAX_RPM,
  type SessionIntent
} from '../src/index.ts';
import { answers, connected, motionLines, num, realtimeNames, req } from './motionHarness.ts';


describe('T-S92: request validation', () => {
  it('refuses bad requests with a reason and sends nothing', () => {
    const d = connected();
    const from = d.effects.length;
    const bad: SessionIntent[] = [
      { intent: 'jog', renew: true },
      { intent: 'jog', axes: { q: 1 } as never, distanceMm: 1, feed: 600 },
      { intent: 'jog', axes: null as never, distanceMm: 1, feed: 600 },
      { intent: 'jog', axes: { x: 2 } as never, distanceMm: 1, feed: 600 },
      { intent: 'jog', axes: { x: 1 }, distanceMm: 0, feed: 600 },
      { intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: Number.NaN },
      { intent: 'goToZero', axes: [], safeZ: 0 },
      { intent: 'goToZero', axes: ['x', 'x'], safeZ: 0 },
      { intent: 'goToZero', axes: ['q' as never], safeZ: 0 },
      { intent: 'goToZero', axes: ['x'], safeZ: Number.NaN },
      { intent: 'setWorkZero', axes: [] },
      { intent: 'spindleOn', output: 'spindle', direction: 'cw', rpm: 0 },
      { intent: 'spindleOn', output: 'spindle', direction: 'up' as never, rpm: 1000 },
      { intent: 'spindleOn', output: 'spindle', direction: 'cw', rpm: MAX_RPM + 1 },
      { intent: 'spindleOn', output: 'laser' as never },
      { intent: 'resume' },
    ];
    for (const r of bad) expect(req(d, r).allowed, JSON.stringify(r)).toBe(false);
    expect(motionLines(d, from)).toEqual([]);
    expect(realtimeNames(d, from)).toEqual([]);
  });
});

describe('T-S92: request validation', () => {
  it('go to zero with an out-of-range safe height is refused; Z alone is one line', () => {
    const d = connected({ mpo: '{"r":{"mpo":{"x":0,"y":0,"z":-3}},"f":[3,0,10]}' });
    req(d, { intent: 'read', tokens: ['mpo'] });
    d.answer(answers({ mpo: '{"r":{"mpo":{"x":0,"y":0,"z":-3}},"f":[3,0,10]}' }));
    expect(req(d, { intent: 'goToZero', axes: ['y'], safeZ: MAX_MOTION_MM * 10 })).toMatchObject({ allowed: false, reason: 'The safe height is out of range.' });
    const from = d.effects.length;
    expect(req(d, { intent: 'goToZero', axes: ['z'], safeZ: 0 }).allowed).toBe(true);
    // `G90 G21` first and the modes put back after (R1): each line after two polled reads at rest.
    for (let i = 0; i < 5; i++) d.answer(answers({ stat: num('stat', 3) }));
    expect(motionLines(d, from)).toEqual(['G90 G21', 'G90 G0 Z0', 'G90']);
    expect(d.state.base).toBe('IDLE_UNHOMED');
  });
});

describe('T-S92: request validation', () => {
  it('a status-report mpoz is used for the safe height; mist and flood are M7 and M8', () => {
    const d = connected();
    d.line('{"sr":{"mpoz":-1}}');
    expect(req(d, { intent: 'goToZero', axes: ['x'], safeZ: -4 }).allowed).toBe(true);
    for (let i = 0; i < 3; i++) d.answer(answers());
    expect(motionLines(d).slice(0, 2)).toEqual(['G90 G21', 'G53 G0 Z-1']);
    const c = connected();
    req(c, { intent: 'spindleOn', output: 'mist' });
    req(c, { intent: 'spindleOn', output: 'flood' });
    c.answer(answers());
    expect(motionLines(c)).toEqual(['M7', 'M8']);
  });
});
