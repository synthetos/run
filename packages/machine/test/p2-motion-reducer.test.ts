/**
 * Phase 2 motion on the pure reducer with scripted answers (SAFETY §4.4, §4.5b; T-S89–T-S92, T-S94):
 * the branches the firmware model does not reach on its own (alarms, refusals, timeouts, damaged
 * answers, the write gate's motion command kind and the line grammar).
 */
import fc from 'fast-check';

import { BYTE } from '@synthetos/protocol';

import { PHASE_1_RELEASE, PHASE_2_RELEASE, STOP_TEXT } from '@synthetos/safety';

import { describe, expect, it } from 'vitest';

import {
    MAX_JOG_FEED,
    MAX_MOTION_MM,
    MAX_RPM,
    checkWrite,
    motionLineKind,
    phase1WriteVerdict
} from '../src/index.ts';

import { ABSOLUTE_MM_LINE, UNITS_LINE, jogLine, mm, restoreLine, returnXYLine, setZeroLine, toZeroLine } from '../src/session/motionLines.ts';

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
      'G21',
      'G21 G91 G1 X0.1 F600',
      'G21 G91 G1 X-1 Y2 Z0.5 A3 F5000',
      'G90',
      'G90 G20',
      'G90 G21',
      'G91',
      'G91 G20',
      'G91 G21',
      'G53 G0 Z-1.5',
      'G53 G0 X1.5 Y-2',
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
      'G20',
      'G21 G90',
      'G90 G21 G53 G0 Z1',
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
    expect(restoreLine(0, 1)).toBe('G91 G20');
    expect(restoreLine(undefined, 1)).toBe('G91');
    expect(returnXYLine(1.5, -2)).toBe('G53 G0 X1.5 Y-2');
    expect(motionLineKind(UNITS_LINE)).toBe('units');
    expect(motionLineKind(ABSOLUTE_MM_LINE)).toBe('restore');
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
    // H91: a typed-move line with no typed move sending (stopped, ended, never started) is held back, never a FAULT.
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('G0 X1\n'), 'motion', 'typedMove')).toMatchObject({ kind: 'denied', reason: 'not written: the typed move was stopped or has ended' });
    // A line only from an intent that may send its kind (amendment 2026-11-02): no G28.2 as a jog, no M3 as a stop.
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('G28.2 X0\n'), 'motion', 'jog')).toMatchObject({ kind: 'refused', reason: 'a home line was issued by jog' });
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('M3 S100\n'), 'motion', 'stopJob')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('G92.1\n'), 'motion', 'tempOffset')).toBeUndefined();
  });
});
