/**
 * T-S140 (with travel-check.test.ts). The axes homed here are forgotten when the board may have lost its homing
 * within the connection (re-review 2026-11-09, S1; homedAxes.ts): a FAULT (and the reset behind it), a shutdown or
 * panic (edge-next's cm_shutdown unhomes every axis), a read of `home` that shows 0, and, per axis, a read of `hom`
 * that shows it at 0. And an axis counts as homed only while the board reports `home` 1.
 */
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import type { SessionState } from '../src/index.ts';
import { axisHomedHere } from '../src/session/homedAxes.ts';
import { EN_APPROVED } from './jobHarness.ts';
import { Driver, EN_ANSWERS, EN_READY_BANNER } from './sessionDriver.ts';

const OK = '{"r":{},"f":[3,0,10]}';
const num = (token: string, v: number): string => `{"r":{"${token}":${v}},"f":[3,0,10]}`;
const hom = (x: number, y: number, z: number): string => `{"r":{"hom":{"x":${x},"y":${y},"z":${z},"a":0,"b":0,"c":0}},"f":[3,0,10]}`;
const BASE: Record<string, string> = { ...EN_ANSWERS, gc: OK, clear: '{"r":{"clear":null},"f":[3,0,10]}' };

/** A connected motion session in which a homing cycle homed X, Y and Z (as read back). */
function homedHere(): Driver {
  const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
  d.open();
  d.answer(BASE);
  const s = d.state;
  const homValue = { value: { x: 1, y: 1, z: 1, a: 0, b: 0, c: 0 }, status: 0, at: 1 };
  d.state = { ...s, base: 'IDLE_HOMED', live: { ...s.live, home: 1 }, values: { ...s.values, hom: homValue }, notices: { ...s.notices, homedAxes: ['x', 'y', 'z'] } };
  expect(axisHomedHere(d.state, 'X')).toBe(true);
  return d;
}

const homedAxes = (s: SessionState) => s.notices.homedAxes ?? [];

describe('S1: the homing this connection saw is forgotten when the board may have lost it', () => {
  it('an axis counts only while the board reports home 1', () => {
    const d = homedHere();
    expect(axisHomedHere({ ...d.state, live: { ...d.state.live, home: 0 } }, 'X')).toBe(false);
    const { home: _home, ...unread } = d.state.live;
    expect(axisHomedHere({ ...d.state, live: unread }, 'X')).toBe(false);
  });

  it('a FAULT forgets every axis', () => {
    const d = homedHere();
    d.line(EN_READY_BANNER);
    expect(d.state.fault?.cause).toBe('bannerAfterReady');
    expect(homedAxes(d.state)).toEqual([]);
  });

  it.each([
    ['shutdown', 12],
    ['panic', 13],
  ])('a %s forgets every axis', (_label, stat) => {
    const d = homedHere();
    d.line(`{"sr":{"stat":${stat}}}`);
    expect(homedAxes(d.state)).toEqual([]);
  });

  it('an alarm alone keeps them; the poll of home after Clear alarm that shows 0 forgets them', () => {
    const d = homedHere();
    d.line('{"sr":{"stat":2}}');
    expect(d.state.base).toBe('ALARM');
    expect(homedAxes(d.state)).toEqual(['x', 'y', 'z']);
    expect(d.intent({ intent: 'clearAlarm' })).toEqual({ allowed: true });
    d.answer({ ...BASE, stat: num('stat', 1), hold: num('hold', 0), vel: num('vel', 0), qr: num('qr', 32), home: num('home', 1) }, (t) => t === 'home');
    d.written();
    d.line(num('home', 0));
    expect(homedAxes(d.state)).toEqual([]);
  });

  it('a read asked for (here a hom, then home): hom drops each axis it shows at 0, home 0 drops the rest; a refused read changes nothing', () => {
    const d = homedHere();
    d.intent({ intent: 'read', tokens: ['hom'] });
    d.answer({ ...BASE, hom: hom(1, 0, 1) });
    expect(homedAxes(d.state)).toEqual(['x', 'z']);
    d.intent({ intent: 'read', tokens: ['home'] });
    d.answer({ ...BASE, home: '{"r":{},"f":[3,100,10]}' });
    expect(homedAxes(d.state)).toEqual(['x', 'z']);
    d.intent({ intent: 'read', tokens: ['home'] });
    d.answer({ ...BASE, home: num('home', 1) });
    expect(homedAxes(d.state)).toEqual(['x', 'z']);
    d.intent({ intent: 'read', tokens: ['home'] });
    d.answer({ ...BASE, home: num('home', 0) });
    expect(homedAxes(d.state)).toEqual([]);
  });

  it("the session's own read-back (here after a refused G28.2): hom drops each axis at 0, home 0 drops the rest", () => {
    const d = homedHere();
    d.intent({ intent: 'read', tokens: ['x'] });
    d.answer({ ...BASE, x: '{"r":{"x":{"am":1,"sn":0,"sx":1,"sv":500,"tn":0,"tm":100,"lb":2}},"f":[3,0,10]}' });
    expect(d.intent({ intent: 'home', axes: ['x'] })).toEqual({ allowed: true });
    d.written();
    d.line('{"r":{},"f":[3,246,10]}');
    expect([d.state.writing?.token, ...d.state.queue.map((q) => q.token)]).toEqual(['hom', 'home']);
    d.written();
    d.line(hom(0, 1, 1));
    expect(homedAxes(d.state)).toEqual(['y', 'z']);
    d.written();
    d.line(num('home', 0));
    expect(homedAxes(d.state)).toEqual([]);
  });
});
