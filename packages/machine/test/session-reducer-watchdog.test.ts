import { OVERLAYS } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { type SessionEffect } from '../src/index.ts';
import { Driver, EN_ANSWERS, EN_READY_BANNER } from './sessionDriver.ts';
import { connected, seedValues } from './sessionReducerFixtures.ts';
import { PORT } from './simTransport.ts';

describe('LOST, STALE, NEEDS_REVIEW', () => {

  it('LOST closes the port; acknowledging it returns to NOT_CONNECTED and the next connect starts UNKNOWN', () => {
    const d = connected();
    d.feed({ type: 'linkLost', epoch: d.state.epoch, at: 0 });
    expect(d.state.overlays[0]).toBe('LOST');
    expect(d.last).toContainEqual({ kind: 'close', epoch: d.state.epoch });
    expect(d.intent({ intent: 'feedhold' }).allowed).toBe(false);
    expect(d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null }).allowed).toBe(false);
    expect(d.intent({ intent: 'acknowledgeLost' })).toEqual({ allowed: true });
    expect(d.state).toMatchObject({ base: 'NOT_CONNECTED', overlays: [], unknownOnNextConnect: true });
    d.open();
    expect(d.state.overlays).toEqual(['UNKNOWN']);
    expect(d.state.unknownOnNextConnect).toBe(false);
    d.answer(EN_ANSWERS);
    expect(d.state.overlays).toEqual(['UNKNOWN', 'READ_ONLY']);
  });


  it('acknowledgeLost without LOST is denied', () => {
    const d = connected();
    expect(d.intent({ intent: 'acknowledgeLost' }).allowed).toBe(false);
  });


  it('a read that goes unanswered is STALE; the next byte received clears it', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx', 'mpox'] });
    d.written();
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'answer', seq: expect.any(Number), ms: 2000 });
    d.fire('answer');
    expect(d.state.overlays).toContain('STALE');
    expect(d.state.queue).toEqual([]);
    d.line(EN_ANSWERS.posx as string);
    expect(d.state.overlays).not.toContain('STALE');
    expect(seedValues(d)).toEqual({});
  });


  it('a READING read that goes unanswered: STALE, and the board is not trusted as resting', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'stat');
    d.written();
    d.fire('answer');
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(expect.arrayContaining(['ORPHANED_MOTION', 'STALE']));
  });


  it('a request read timing out while READING still has reads queued finishes READING', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'stat');
    d.intent({ intent: 'read', tokens: ['posx'] });
    // Answer stat, hold, vel, qr are queued; time out the first one.
    d.written();
    d.fire('answer');
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
  });


  it('a late answer is consumed; a late entry the board never answers is dropped when a later answer arrives', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx', 'mpox'] });
    d.written();
    d.fire('answer');
    d.intent({ intent: 'read', tokens: ['mpox'] });
    d.written();
    d.line(EN_ANSWERS.mpox as string);
    expect(d.state.values['mpox']).toMatchObject({ value: 2.5, status: 0 });
    expect(d.state.fault).toBeNull();
    expect(d.state.expected).toEqual([]);
  });
});

describe('LOST, STALE, NEEDS_REVIEW', () => {


  it('an answer timer with nothing in flight does nothing', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx'] });
    d.written();
    d.state = { ...d.state, expected: [] };
    d.fire('answer');
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });


  it('driftDetected raises NEEDS_REVIEW, the lowest-precedence overlay', () => {
    const d = connected();
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    expect(d.state.overlays).toEqual(['READ_ONLY', 'NEEDS_REVIEW']);
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    expect(d.state.overlays).toEqual(['READ_ONLY', 'NEEDS_REVIEW']);
  });


  it('driftResolved (C23, the board\'s settings kept as the reference) clears NEEDS_REVIEW for the current link only, and writes nothing (OD-13 §5)', () => {
    const d = connected();
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    const before = d.effects.length;
    d.feed({ type: 'driftResolved', epoch: d.state.epoch + 1 });
    expect(d.state.overlays).toEqual(['READ_ONLY', 'NEEDS_REVIEW']);
    d.feed({ type: 'driftResolved', epoch: d.state.epoch });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    expect(d.effects.slice(before).some((e) => e.kind === 'writeLine')).toBe(false);
    expect(d.effects.slice(before).filter((e) => e.kind === 'log').map((e) => (e as Extract<SessionEffect, { kind: 'log'; }>).text)).toEqual(["settings: the board's settings were kept as this computer's reference (C23, nothing written): review resolved"]);
    d.feed({ type: 'driftResolved', epoch: d.state.epoch }); // nothing to resolve: nothing happens
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });


  it('overlays are always kept in precedence order', () => {
    const d = connected();
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    d.line(EN_READY_BANNER);
    d.feed({ type: 'linkLost', epoch: d.state.epoch, at: 0 });
    expect(d.state.overlays).toEqual(OVERLAYS.filter((o) => d.state.overlays.includes(o)));
    expect(d.state.overlays).toEqual(['FAULT', 'LOST', 'UNKNOWN', 'READ_ONLY', 'NEEDS_REVIEW']);
  });
});
