/**
 * The edge-next feed-limit push lines (`fs`, `fl`; EN runtime.c:295-489) at every session state (T-S108): they
 * are not responses, not acknowledgements and not motion, so they never consume an owed answer, never stand in
 * for the ENQ ack, never raise ORPHANED_MOTION or an unexpected-response FAULT. run never turns the push on,
 * but it is a RAM session setting another host may have left on until the next reset.
 */
import { type ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMINGS, HEARTBEAT_INTERVAL_MS, RUN_SR_FIELDS, type SessionEffect, type SessionState } from '../src/index.ts';
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

/** A configured motion session on a board whose heartbeat is on. */
function connected(): Driver {
  const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
  d.open();
  d.answer(HB_ANSWERS);
  expect(d.state.reports).toMatchObject({ phase: 'done', heartbeatMs: HEARTBEAT_INTERVAL_MS });
  expect(d.state.link.silenceMs).toBe(W);
  return d;
}

function writes(effects: readonly SessionEffect[]): SessionEffect[] {
  return effects.filter((e) => e.kind === 'writeLine' || e.kind === 'writeRealtime');
}

/** What a pushed fs or fl line must never change. */
function invariants(s: SessionState) {
  return {
    base: s.base,
    overlays: s.overlays.filter((o) => o !== 'STALE'),
    fault: s.fault,
    expected: s.expected,
    writing: s.writing,
    enqOutstanding: s.enqOutstanding,
    probe: s.probe,
    classification: s.classification,
    motion: s.motion,
    reports: s.reports,
  };
}

const FEED_LIMIT_LINES = [
  '{"fl":{"k":1,"m":10,"p":62,"n":118}}',
  '{"fs":{"v":1,"e":1,"q":3,"c":[120,40,0,15,0,0],"ct":900,"cd":12.345}}',
  '{"fl":{"k":0,"m":0,"p":null,"n":null}}',
  '{"fs":{"v":1,"e":1,"q":4,"c":[4294967295,0,0,0,0,0],"ct":4294967295,"cd":0.001,"x":1}}',
];

/** Feeds every feed-limit line and checks that nothing but liveness moved and nothing was written. */
function pushFeedLimit(d: Driver, where: string): void {
  const before = invariants(d.state);
  const from = d.effects.length;
  for (const line of FEED_LIMIT_LINES) d.line(line);
  expect(invariants(d.state), where).toEqual(before);
  expect(writes(d.effects.slice(from)), where).toEqual([]);
  expect(d.state.overlays, where).not.toContain('ORPHANED_MOTION');
}

describe('T-S108: pushed fs and fl lines are not responses, acks or motion, in every state', () => {
  it('connecting: while the first line and the probe are owed, during READING and the report configuration', () => {
    const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    d.open();
    pushFeedLimit(d, 'IDENTIFYING, {sr:null} handed to the transport');
    d.written();
    pushFeedLimit(d, 'IDENTIFYING, {sr:null} owed');
    d.line(HB_ANSWERS['sr'] as string);
    d.written();
    pushFeedLimit(d, 'IDENTIFYING, a probe GET owed');
    d.line(HB_ANSWERS[d.state.expected[0]?.token as string] as string);
    d.answer(HB_ANSWERS, () => d.state.base === 'READING');
    expect(d.state.base).toBe('READING');
    pushFeedLimit(d, 'READING');
    d.answer(HB_ANSWERS, () => d.state.reports.phase === 'seeding');
    expect(d.state.reports.phase).toBe('seeding');
    pushFeedLimit(d, 'seeding');
    d.answer(HB_ANSWERS, () => d.state.reports.phase === 'configuring');
    expect(d.state.reports.phase).toBe('configuring');
    pushFeedLimit(d, 'configuring');
    d.answer(HB_ANSWERS);
    expect(d.state.reports.phase).toBe('done');
    expect(d.state.overlays).toEqual([]);
    pushFeedLimit(d, 'idle, configured');
  });

  it('moving, held, with a motion line owed, an ENQ outstanding, STALE and FAULT', () => {
    const d = connected();
    expect(d.intent({ intent: 'jog', axes: { x: 1 }, distanceMm: 10, feed: 600 })).toEqual({ allowed: true });
    d.written();
    pushFeedLimit(d, 'a motion line owed');
    d.line(OK);
    expect(d.state.fault).toBeNull();
    d.line('{"sr":{"stat":8,"vel":600}}');
    pushFeedLimit(d, 'jogging');
    d.intent({ intent: 'feedhold' });
    d.answer(HELD);
    expect(d.state.base).toBe('HELD');
    pushFeedLimit(d, 'held');
    expect(d.intent({ intent: 'enq' })).toEqual({ allowed: true });
    expect(d.state.enqOutstanding).toBe(true);
    pushFeedLimit(d, 'held, ENQ outstanding');
    // A feed-limit line is proof of life, but never the ack: the ENQ is still owed.
    expect(d.state.enqOutstanding).toBe(true);
    d.line('{"ack":true}');
    expect(d.state.enqOutstanding).toBe(false);
    d.line('{"er":{"fb":450.01,"st":13,"msg":"x"}}');
    expect(d.state.overlays).toContain('FAULT');
    pushFeedLimit(d, 'FAULT');
  });

  it('STALE: a feed-limit line is proof of life (it clears STALE) and changes nothing else', () => {
    const d = connected();
    d.at += W;
    d.fire('watchdog');
    expect(d.state.overlays).toContain('STALE');
    pushFeedLimit(d, 'STALE');
    expect(d.state.overlays).not.toContain('STALE');
  });

  it('ORPHANED_MOTION and an unapproved (READ_ONLY) board', () => {
    const o = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    o.open();
    o.written();
    o.fire('answer');
    expect(o.state.overlays).toContain('ORPHANED_MOTION');
    const before = o.state.overlays;
    for (const line of FEED_LIMIT_LINES) o.line(line);
    expect(o.state.overlays).toEqual(before);
    const r = new Driver({ release: PHASE_2_RELEASE });
    r.open();
    r.answer(HB_ANSWERS);
    expect(r.state.overlays).toContain('READ_ONLY');
    pushFeedLimit(r, 'READ_ONLY');
  });
});
