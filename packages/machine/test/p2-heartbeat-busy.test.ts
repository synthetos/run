/**
 * Liveness with the heartbeat on while the machine is held, dwelling or busy (SAFETY §4.2 amendment
 * 2026-11-02 "heartbeat silence during hold and dwell", H69, T-S103).
 *
 * The edge-next heartbeat beats only while the machine is quiet (EN runtime.c:37-52, :62-71), and a finished
 * feedhold or a long dwell pushes no report, so a silent window there is expected: the watchdog asks once per
 * window (ENQ) and goes STALE only if that is not answered within `staleAfterMs`. While steps move nothing is
 * sent: pushed position reports are the proof of life.
 */
import { BYTE, type ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMINGS, HEARTBEAT_INTERVAL_MS, RUN_SR_FIELDS, heartbeatCoversHold, type SessionEffect } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

const OK = '{"r":{},"f":[3,0,10]}';
const num = (token: string, v: number): string => `{"r":{"${token}":${v}},"f":[3,0,10]}`;
const RUN_SR = `{"r":{"sr":{${RUN_SR_FIELDS.map((f) => `"${f}":0`).join(',')}}},"f":[3,0,10]}`;
const RT = '{"r":{"rt":{"hb":0,"qt":"","up":5}},"f":[3,0,10]}';
/** An edge-next board with the heartbeat: `{"rt":null}` and `{"rt":{"hb":1}}` both answer status 0. */
const HB_ANSWERS: Record<string, string> = { ...EN_ANSWERS, sr: RUN_SR, rt: RT, gc: OK, clear: '{"r":{"clear":null},"f":[3,0,10]}' };
const HELD: Record<string, string> = { ...HB_ANSWERS, stat: num('stat', 6), hold: num('hold', 6), vel: num('vel', 0), qr: num('qr', 31) };

const W = DEFAULT_TIMINGS.reportSilenceMs;
const ASK = DEFAULT_TIMINGS.staleAfterMs;

/** A configured motion session on a board whose heartbeat is on. */
function connected(): Driver {
  const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
  d.open();
  d.answer(HB_ANSWERS);
  expect(d.state.reports).toMatchObject({ phase: 'done', heartbeatMs: HEARTBEAT_INTERVAL_MS });
  expect(d.state.link.silenceMs).toBe(W);
  return d;
}

/** A jog paused with Pause: the hold has completed (stat 6, hold 6, vel 0). */
function held(): Driver {
  const d = connected();
  expect(d.intent({ intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 })).toEqual({ allowed: true });
  d.intent({ intent: 'feedhold' });
  d.answer(HELD);
  expect(d.state.base).toBe('HELD');
  return d;
}

function enqs(effects: readonly SessionEffect[]): number {
  return effects.filter((e) => e.kind === 'writeRealtime' && e.byte === BYTE.ENQ).length;
}

function writes(effects: readonly SessionEffect[]): SessionEffect[] {
  return effects.filter((e) => e.kind === 'writeLine' || e.kind === 'writeRealtime');
}

/**
 * Silence for `totalMs`, firing the watchdog whenever it is due and answering each ENQ with `{"ack":true}`
 * at once. Returns the time of each ENQ.
 */
function silence(d: Driver, totalMs: number): number[] {
  const end = d.at + totalMs;
  const asked: number[] = [];
  let due = d.at + W;
  while (due <= end) {
    d.at = due;
    const effects = d.fire('watchdog');
    if (enqs(effects) > 0) {
      asked.push(d.at);
      d.line('{"ack":true}');
      due = d.at + W;
    } else {
      due = d.at + (d.state.liveness !== null ? ASK : W);
    }
  }
  d.at = end;
  return asked;
}

describe('T-S103: heartbeat silence during hold and dwell', () => {
  it('the capability seam says the heartbeat does not cover a hold today', () => {
    expect(heartbeatCoversHold()).toBe(false);
  });

  it('a hold of 10 s: no STALE, and exactly one ENQ per silence window, each after a full window of silence', () => {
    const d = held();
    const from = d.effects.length;
    const start = d.at;
    const asked = silence(d, 10_000);
    expect(d.state.overlays).not.toContain('STALE');
    expect(asked).toEqual([start + W, start + 2 * W, start + 3 * W]);
    expect(enqs(d.effects.slice(from))).toBe(3);
    // Nothing else was written: no GET, no line.
    expect(writes(d.effects.slice(from)).length).toBe(3);
  });

  it('a hold whose ENQ goes unanswered is STALE after staleAfterMs, then asks again next window', () => {
    const d = held();
    d.at += W;
    expect(enqs(d.fire('watchdog'))).toBe(1);
    expect(d.state.overlays).not.toContain('STALE');
    expect(d.state.liveness).toMatchObject({ via: 'enq' });
    d.at += ASK;
    d.fire('watchdog');
    expect(d.state.overlays).toContain('STALE');
    // Still owed an ack (at most one ENQ outstanding): the next window asks with a `stat` GET instead.
    d.at += W;
    const next = d.fire('watchdog');
    expect(enqs(next)).toBe(0);
    expect(d.state.queue.concat(d.state.writing === null ? [] : [{ token: d.state.writing.token, purpose: d.state.writing.purpose }])).toContainEqual(expect.objectContaining({ token: 'stat', purpose: 'liveness' }));
    d.line('{"ack":true}');
    expect(d.state.overlays).not.toContain('STALE');
  });

  it('a long G4 dwell (stat 5, vel 0) behaves the same: one ENQ per window, no STALE', () => {
    const d = connected();
    d.line('{"sr":{"stat":5,"vel":0,"line":12}}');
    expect(d.state.live.machineClass).toBe('running');
    const from = d.effects.length;
    const start = d.at;
    expect(silence(d, 10_000)).toEqual([start + W, start + 2 * W, start + 3 * W]);
    expect(d.state.overlays).not.toContain('STALE');
    expect(writes(d.effects.slice(from)).length).toBe(3);
  });

  it('moves queued but not stepping (planner buffers in use, vel 0) ask too', () => {
    const d = connected();
    d.line('{"qr":28}');
    const start = d.at;
    expect(silence(d, 4_000)).toEqual([start + W]);
    expect(d.state.overlays).not.toContain('STALE');
  });

  it('moving (vel not 0) sends nothing: silence for the window is STALE', () => {
    const d = connected();
    d.line('{"sr":{"stat":5,"vel":600}}');
    const from = d.effects.length;
    d.at += W;
    d.fire('watchdog');
    expect(d.state.overlays).toContain('STALE');
    expect(writes(d.effects.slice(from))).toEqual([]);
    d.at += W;
    d.fire('watchdog');
    expect(writes(d.effects.slice(from))).toEqual([]);
  });

  it('decelerating into a hold (hold 3, vel not 0) sends nothing; once the hold completes it asks', () => {
    const d = connected();
    d.line('{"sr":{"stat":5,"hold":3,"vel":220}}');
    const from = d.effects.length;
    d.at += W;
    d.fire('watchdog');
    expect(writes(d.effects.slice(from))).toEqual([]);
    expect(d.state.overlays).toContain('STALE');
    d.line('{"sr":{"stat":6,"hold":6,"vel":0}}');
    expect(d.state.overlays).not.toContain('STALE');
    d.at += W;
    expect(enqs(d.fire('watchdog'))).toBe(1);
  });

  it('idle and quiet: the heartbeat is the proof of life, so the window is STALE and nothing is sent (unchanged)', () => {
    const d = connected();
    const from = d.effects.length;
    d.at += W;
    d.fire('watchdog');
    expect(d.state.overlays).toContain('STALE');
    expect(writes(d.effects.slice(from))).toEqual([]);
  });
});
