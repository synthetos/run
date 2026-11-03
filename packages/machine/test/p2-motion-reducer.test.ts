/**
 * Phase 2 motion on the pure reducer with scripted answers (SAFETY §4.4, §4.5b; T-S89–T-S92, T-S94):
 * the branches the firmware model does not reach on its own (alarms, refusals, timeouts, damaged
 * answers, the write gate's motion command kind and the line grammar).
 */
import fc from 'fast-check';
import { BYTE, type ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_1_RELEASE, PHASE_2_RELEASE, STOP_TEXT } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import {
  MAX_JOG_FEED,
  MAX_MOTION_MM,
  MAX_RPM,
  MOTION_LIMITS,
  checkWrite,
  motionLineKind,
  phase1WriteVerdict,
  type SessionEffect,
  type SessionIntent,
} from '../src/index.ts';
import { jogLine, mm, restoreLine, setZeroLine, toZeroLine } from '../src/session/motionLines.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

const OK = '{"r":{},"f":[3,0,10]}';
const BASE_ANSWERS: Record<string, string> = { ...EN_ANSWERS, gc: OK, clear: '{"r":{"clear":null},"f":[3,0,10]}', home: '{"r":{"home":0},"f":[3,0,10]}', unit: '{"r":{"unit":1},"f":[3,0,10]}' };

function answers(patch: Record<string, string> = {}): Record<string, string> {
  return { ...BASE_ANSWERS, ...patch };
}

const num = (token: string, v: number): string => `{"r":{"${token}":${v}},"f":[3,0,10]}`;

function connected(patch: Record<string, string> = {}, options: { readonly release?: typeof PHASE_2_RELEASE; readonly unknown?: boolean } = {}): Driver {
  const d = new Driver({ release: options.release ?? PHASE_2_RELEASE, manifest: EN_APPROVED });
  if (options.unknown === true) d.state = { ...d.state, unknownOnNextConnect: true };
  d.open();
  d.answer(answers(patch));
  return d;
}

function req(d: Driver, r: SessionIntent) {
  return d.intent(r);
}

function motionLines(d: Driver, from = 0): string[] {
  return d.effects
    .slice(from)
    .filter((e): e is Extract<SessionEffect, { kind: 'writeLine' }> => e.kind === 'writeLine' && e.motion !== undefined)
    .map((e) => e.line);
}

function realtimeNames(d: Driver, from = 0): string[] {
  return d.effects
    .slice(from)
    .filter((e): e is Extract<SessionEffect, { kind: 'writeRealtime' }> => e.kind === 'writeRealtime')
    .map((e) => e.name);
}

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

  it('go to zero with an out-of-range safe height is refused; Z alone is one line', () => {
    const d = connected({ mpo: '{"r":{"mpo":{"x":0,"y":0,"z":-3}},"f":[3,0,10]}' });
    req(d, { intent: 'read', tokens: ['mpo'] });
    d.answer(answers({ mpo: '{"r":{"mpo":{"x":0,"y":0,"z":-3}},"f":[3,0,10]}' }));
    expect(req(d, { intent: 'goToZero', axes: ['y'], safeZ: MAX_MOTION_MM * 10 })).toMatchObject({ allowed: false, reason: 'The safe height is out of range.' });
    const from = d.effects.length;
    expect(req(d, { intent: 'goToZero', axes: ['z'], safeZ: 0 }).allowed).toBe(true);
    d.answer(answers({ stat: num('stat', 3) }));
    d.answer(answers({ stat: num('stat', 3) }));
    expect(motionLines(d, from)).toEqual(['G90 G0 Z0']);
    expect(d.state.base).toBe('IDLE_UNHOMED');
  });

  it('a status-report mpoz is used for the safe height; mist and flood are M7 and M8', () => {
    const d = connected();
    d.line('{"sr":{"mpoz":-1}}');
    expect(req(d, { intent: 'goToZero', axes: ['x'], safeZ: -4 }).allowed).toBe(true);
    d.answer(answers());
    expect(motionLines(d)[0]).toBe('G53 G0 Z-1');
    const c = connected();
    req(c, { intent: 'spindleOn', output: 'mist' });
    req(c, { intent: 'spindleOn', output: 'flood' });
    c.answer(answers());
    expect(motionLines(c)).toEqual(['M7', 'M8']);
  });
});

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

  it('a damaged answer to a motion line is a FAULT (and a FAULT while moving holds); a damaged poll is asked again', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
    d.written();
    const from = d.effects.length;
    d.line('{"r":{"gc":"G1"},"f":[3,0');
    expect(d.state.overlays).toContain('FAULT');
    expect(realtimeNames(d, from)).toEqual(['feedhold']);
    const p = connected();
    req(p, { intent: 'jog', axes: { x: 1 }, distanceMm: 0.1, feed: 600 });
    p.written();
    p.line(OK);
    p.written();
    p.line('{"r":{"stat":3},"f":[3,0');
    expect(p.state.overlays).not.toContain('FAULT');
  });

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

  it('a Stop job from CONNECTED_UNKNOWN returns there', () => {
    const d = connected({}, { unknown: true });
    d.intent({ intent: 'stopJob' });
    d.answer(answers());
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.notices.motion?.text).toBe(STOP_TEXT.stopped);
  });
});

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

  it('a second release while the hold step runs sends nothing more', () => {
    const d = connected();
    req(d, { intent: 'jog', axes: { y: -1 }, distanceMm: null, feed: 600 });
    d.intent({ intent: 'feedhold', release: true });
    const n = realtimeNames(d).length;
    d.intent({ intent: 'feedhold', release: true });
    expect(realtimeNames(d).length).toBe(n);
  });

  it('a refused closing line still completes the stop, with the refusal kept', () => {
    const d = connected();
    d.intent({ intent: 'stopJob' });
    d.answer(answers({ gc: '{"r":{"gc":"M5"},"f":[3,130,10]}' }));
    expect(d.state.motion).toBeNull();
    expect(d.state.notices.motion?.text).toBe(STOP_TEXT.stopped);
  });

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

describe('T-S94: the motion command kind of the write gate and the line grammar', () => {
  const ctx = { readable: () => false, enqAllowed: false };
  const enc = (t: string) => new TextEncoder().encode(t);

  it('admits each shape with a motion release, and nothing without one', () => {
    const lines = [
      'G21 G91 G1 X0.1 F600',
      'G21 G91 G1 X-1 Y2 Z0.5 A3 F5000',
      'G90',
      'G90 G20',
      'G53 G0 Z-1.5',
      'G90 G0 X0 Y0',
      'G10 L20 P1 Z0',
      'G10 L20 P6 X0 Y0',
      'G28.2 X0 Y0 Z0',
      'G28.2 Z0',
      'G28.3 X0 Y0 Z0 A0',
      'G92 X0 Y0',
      'G92.1',
      'G54',
      'G59',
      'M3 S12000',
      'M4 S1',
      'M5',
      'M7',
      'M8',
      'M9',
      '{"clear":null}',
    ];
    for (const l of lines) {
      expect(motionLineKind(l), l).toBeDefined();
      expect(phase1WriteVerdict(enc(`${l}\n`), { ...ctx, motion: true }), l).toEqual({ ok: true, kind: 'motion', lineKind: motionLineKind(l) });
      expect(phase1WriteVerdict(enc(`${l}\n`), ctx).ok, l).toBe(false);
    }
    expect(phase1WriteVerdict(Uint8Array.of(BYTE.FLUSH), { ...ctx, motion: true })).toEqual({ ok: true, kind: 'flush' });
    expect(phase1WriteVerdict(Uint8Array.of(BYTE.RESUME), { ...ctx, motion: true })).toEqual({ ok: true, kind: 'resume' });
    expect(phase1WriteVerdict(Uint8Array.of(BYTE.FLUSH), ctx).ok).toBe(false);
    expect(phase1WriteVerdict(Uint8Array.of(BYTE.KILL), { ...ctx, motion: true }).ok).toBe(false);
    expect(phase1WriteVerdict(Uint8Array.of(BYTE.RESET), { ...ctx, motion: true }).ok).toBe(false);
  });

  it('refuses everything else', () => {
    const bad = [
      'G21 G91 G1 F600',
      'G21 G91 G1 X0 F600',
      `G21 G91 G1 X${MAX_MOTION_MM + 1} F600`,
      'G21 G91 G1 X1 F0',
      `G21 G91 G1 X1 F${MAX_JOG_FEED + 1}`,
      'G21 G91 G1 Y1 X1 F600',
      `G53 G0 Z${MAX_MOTION_MM + 1}`,
      'G90 G0',
      'G90 G0 X1',
      'G10 L20 P1',
      'G10 L2 P1 X0',
      'G10 L20 P7 X0',
      'G10 L20 P0 X0',
      'G28.2',
      'G28.2 X1',
      'G28.3 Z5',
      'G28.1',
      'G92 X1',
      'G92',
      'G92.2',
      'G92.3',
      'G53',
      'G60',
      `M3 S${MAX_RPM + 1}`,
      'M3',
      'M6',
      'G0 X10',
      'G28',
      'M3 S1000 (x',
      '{"clear":true}',
      '$xvm=1',
    ];
    for (const l of bad) {
      expect(motionLineKind(l), l).toBeUndefined();
      expect(phase1WriteVerdict(enc(`${l}\n`), { ...ctx, motion: true }).ok, l).toBe(false);
    }
    expect(phase1WriteVerdict(enc('M5'), { ...ctx, motion: true }).ok).toBe(false);
  });

  it('every generated jog piece is admitted (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -MAX_MOTION_MM, max: MAX_MOTION_MM, noNaN: true }), fc.integer({ min: 1, max: MAX_JOG_FEED }), (x, f) => {
        const line = jogLine({ X: x, Y: 1 }, f);
        expect(motionLineKind(line), line).toBe('jog');
      }),
    );
  });

  it('the builders', () => {
    expect(mm(-0.00001)).toBe('0');
    expect(mm(1.23456)).toBe('1.2346');
    expect(jogLine({ X: 0, Y: 2 }, 600)).toBe('G21 G91 G1 Y2 F600');
    expect(restoreLine(0)).toBe('G90 G20');
    expect(restoreLine(1)).toBe('G90');
    expect(toZeroLine(['Y', 'X'])).toBe('G90 G0 X0 Y0');
    expect(setZeroLine(['Z', 'A'])).toBe('G10 L20 P1 Z0 A0');
    expect(setZeroLine(['X'], 3)).toBe('G10 L20 P3 X0');
  });

  it('checkWrite: a motion write must name its issuing intent; under Phase 1 it is denied by the matrix', () => {
    const d = connected();
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('M5\n'), 'motion')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('M5\n'), 'motion', 'spindleOffNow')).toBeUndefined();
    expect(checkWrite(d.state, d.state, PHASE_1_RELEASE, enc('G90\n'), 'motion', 'jog')).toMatchObject({ kind: 'denied' });
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('G0 X1\n'), 'motion', 'jog')).toMatchObject({ kind: 'refused' });
    // A line only from an intent that may send its kind (amendment 2026-11-02): no G28.2 as a jog, no M3 as a stop.
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('G28.2 X0\n'), 'motion', 'jog')).toMatchObject({ kind: 'refused', reason: 'a home line was issued by jog' });
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('M3 S100\n'), 'motion', 'stopJob')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('G92.1\n'), 'motion', 'tempOffset')).toBeUndefined();
  });
});
