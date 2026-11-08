/**
 * T-S134. Clear alarm after an alarm ended a motion of run's (OD-19, owner 2026-11-08; SAFETY §4.5b Clear alarm): once the
 * clear is answered with status 0, `G90` (`G90 G20` when the units read before the motion were inches) is the next
 * line, through its own intent and only as that exact line. On the pure reducer with scripted answers.
 */
import type { ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { checkWrite, type SessionEffect } from '../src/index.ts';
import { ownModeLineRefusal } from '../src/session/modeWrites.ts';
import { alarmRestoreLine, alarmRestoreWritableIn } from '../src/session/alarmRestore.ts';
import { boardModesText } from '../src/session/boardModes.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

const OK = '{"r":{},"f":[3,0,10]}';
const num = (token: string, v: number): string => `{"r":{"${token}":${v}},"f":[3,0,10]}`;
const BASE: Record<string, string> = { ...EN_ANSWERS, gc: OK, clear: '{"r":{"clear":null},"f":[3,0,10]}', home: num('home', 0), unit: num('unit', 1), dist: num('dist', 0) };

function connected(): Driver {
  const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
  d.open();
  d.answer(BASE);
  return d;
}

function motionLines(d: Driver, from: number): string[] {
  return d.effects
    .slice(from)
    .filter((e): e is Extract<SessionEffect, { kind: 'writeLine' }> => e.kind === 'writeLine' && e.motion !== undefined)
    .map((e) => e.line);
}

/** A 10 mm jog from a board in `unit`, ended by an alarm (stat 2 polled) after its first piece. */
function alarmedJog(unit = 1): Driver {
  const d = connected();
  d.intent({ intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 });
  d.answer({ ...BASE, unit: num('unit', unit) }, (t) => t === 'stat');
  d.answer({ ...BASE, stat: num('stat', 2) }, (t) => d.state.base === 'ALARM' || t === 'gc');
  expect(d.state.base).toBe('ALARM');
  d.answer({ ...BASE, stat: num('stat', 2) }); // the rest of that poll cycle
  expect(d.state.writing).toBeNull();
  return d;
}

describe('Clear alarm after an alarm ended a jog', () => {
  it('G90 G20 goes out right after the clear is answered, ahead of the polls, and the note is done once answered', () => {
    const d = alarmedJog(0);
    expect(d.state.alarmRestore).toEqual({ units: 0, cleared: false });
    const from = d.effects.length;
    expect(d.intent({ intent: 'clearAlarm' }).allowed).toBe(true);
    d.written();
    d.line(BASE['clear'] as string);
    expect(d.state.writing?.line).toBe('G90 G20');
    d.answer({ ...BASE, stat: num('stat', 1), home: num('home', 0) });
    expect(motionLines(d, from)).toEqual(['{"clear":null}', 'G90 G20']);
    expect(d.state.alarmRestore).toBeNull();
    expect(d.state.base).toBe('IDLE_UNHOMED');
    expect(d.state.boardModes.dist).toBe(0);
  });

  it('a refused clear writes nothing more and keeps the note; the next clear that succeeds writes G90', () => {
    const d = alarmedJog();
    d.intent({ intent: 'clearAlarm' });
    d.answer({ ...BASE, clear: '{"r":{},"f":[3,9,10]}', stat: num('stat', 2) });
    expect(d.state.alarmRestore).toEqual({ units: 1, cleared: false });
    const from = d.effects.length;
    d.intent({ intent: 'clearAlarm' });
    d.answer({ ...BASE, stat: num('stat', 1) });
    expect(motionLines(d, from)).toEqual(['{"clear":null}', 'G90']);
  });

  it('a refused G90 says the board may still be relative and keeps the note: the next successful clear writes it (S3)', () => {
    const d = alarmedJog();
    d.intent({ intent: 'clearAlarm' });
    d.written();
    d.line(BASE['clear'] as string);
    d.written();
    d.line('{"r":{},"f":[3,30,10]}');
    expect(d.state.alarmRestore).toEqual({ units: 1, cleared: false });
    expect(d.state.notices.motion?.text).toBe('The controller refused G90 after the alarm was cleared (status 30): it may still be in relative mode. Jog once (a jog ends in G90) before you run anything.');
    d.answer({ ...BASE, stat: num('stat', 2) });
    d.state = { ...d.state, base: 'ALARM' };
    const from = d.effects.length;
    d.intent({ intent: 'clearAlarm' });
    d.answer({ ...BASE, stat: num('stat', 1) });
    expect(motionLines(d, from)).toEqual(['{"clear":null}', 'G90']);
    expect(d.state.alarmRestore).toBeNull();
  });

  it('S1: a jog started before the G90 is answered does not take its answer; a refused G90 is said and the jog runs on', () => {
    for (const status of [0, 30]) {
      const d = alarmedJog();
      d.intent({ intent: 'clearAlarm' });
      d.written();
      d.line(BASE['clear'] as string);
      expect(d.state.writing?.line).toBe('G90');
      // A pushed report says the board is idle before the G90's answer: the base is idle, a jog is allowed.
      d.line('{"sr":{"stat":1}}');
      expect(d.state.base).toBe('IDLE_UNHOMED');
      expect(d.intent({ intent: 'jog', axes: { y: 1 }, distanceMm: 1, feed: 600 }).allowed).toBe(true);
      d.written();
      d.line(`{"r":{},"f":[3,${status},10]}`);
      expect(d.state.motion).toMatchObject({ op: 'jog', phase: 'feed' });
      expect(d.state.alarmRestore).toEqual(status === 0 ? null : { units: 1, cleared: false });
      if (status !== 0) expect(d.state.notices.motion?.text).toContain('it may still be in relative mode');
    }
  });

  it('an unanswered G90 drops the note (the link goes STALE)', () => {
    const d = alarmedJog();
    d.intent({ intent: 'clearAlarm' });
    d.written();
    d.line(BASE['clear'] as string);
    d.written();
    d.fire('answer');
    expect(d.state.alarmRestore).toBeNull();
    expect(d.state.overlays).toContain('STALE');
  });

  it('a new alarm after the clear but before the G90 went out: the clear no longer counts, the gate waits for the next one', () => {
    const d = alarmedJog();
    d.intent({ intent: 'clearAlarm' });
    d.written();
    d.line(BASE['clear'] as string);
    expect(d.state.alarmRestore).toEqual({ units: 1, cleared: true });
    // The G90 is being written when a report says the controller alarmed again (no motion of ours runs).
    d.line('{"sr":{"stat":1}}');
    d.line('{"sr":{"stat":2}}');
    expect(d.state.base).toBe('ALARM');
    expect(d.state.alarmRestore).toEqual({ units: 1, cleared: false });
    const s = d.state;
    expect(checkWrite(s, s, PHASE_2_RELEASE, new TextEncoder().encode('G90\n'), 'motion', 'alarmRestore')?.kind).toBe('refused');
  });

  it('an alarm that ends go to zero is noted too', () => {
    const d = connected();
    d.intent({ intent: 'goToZero', axes: ['z'], safeZ: 0 });
    d.answer({ ...BASE, unit: num('unit', 0) }, (t) => t === 'stat');
    d.answer({ ...BASE, stat: num('stat', 2) }, (t) => d.state.base === 'ALARM' || t === 'gc');
    expect(d.state.base).toBe('ALARM');
    expect(d.state.alarmRestore).toEqual({ units: 0, cleared: false });
  });

  it('an alarm with nothing of ours moving: Clear alarm writes only the clear', () => {
    const d = connected();
    d.answer({ ...BASE, stat: num('stat', 2) });
    d.state = { ...d.state, base: 'ALARM' };
    const from = d.effects.length;
    d.intent({ intent: 'clearAlarm' });
    d.answer({ ...BASE, stat: num('stat', 1) });
    expect(motionLines(d, from)).toEqual(['{"clear":null}']);
  });
});

describe('the write gate for the two session mode lines', () => {
  it('admits the restore only as the exact line the note asks for', () => {
    const d = alarmedJog(0);
    const s = d.state;
    const enc = (t: string) => new TextEncoder().encode(t);
    // Not before a clear answered with status 0 (S2).
    expect(checkWrite(s, s, PHASE_2_RELEASE, enc('G90 G20\n'), 'motion', 'alarmRestore')?.kind).toBe('refused');
    const cleared = { ...s, alarmRestore: { units: 0, cleared: true } };
    expect(checkWrite(cleared, cleared, PHASE_2_RELEASE, enc('G90 G20\n'), 'motion', 'alarmRestore')).toBeUndefined();
    expect(checkWrite(cleared, cleared, PHASE_2_RELEASE, enc('G90\n'), 'motion', 'alarmRestore')).toMatchObject({ kind: 'refused', reason: '"G90" is not the restore a cleared alarm asks for' });
    expect(checkWrite(cleared, cleared, PHASE_2_RELEASE, enc('G91 G20\n'), 'motion', 'alarmRestore')?.kind).toBe('refused');
    expect(alarmRestoreWritableIn({ ...s, alarmRestore: null }, 'G90')).toBe(false);
    expect(alarmRestoreLine(undefined)).toBe('G90');
    // The job's start modes: only the planned line of a job checking now.
    expect(ownModeLineRefusal(s, 'jobModes', enc('G90 G21 G17\n'))).toBe('"G90 G21 G17" is not the start-modes line of the job starting now');
    expect(ownModeLineRefusal(s, 'jog', enc('G90\n'))).toBeUndefined();
  });

  it('the board modes in plain words', () => {
    expect(boardModesText({ units: 1, dist: 0 })).toBe('Absolute, mm');
    expect(boardModesText({ units: 0, dist: 1 })).toBe('Relative, inches');
    expect(boardModesText({ units: undefined, dist: undefined })).toBe('Not read yet');
    expect(boardModesText({ units: undefined, dist: 0 })).toBe('Absolute, units not read');
    expect(boardModesText({ units: 1, dist: undefined })).toBe('Distance mode not read, mm');
  });
});
