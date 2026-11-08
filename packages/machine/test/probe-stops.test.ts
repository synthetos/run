/**
 * T-S130, T-S131 (Probe Z, SAFETY §4.5c "Stops", H90): Pause and Stop job at every point of the probe move, from
 * queued to the board's probe cycle; nothing written after a stop; a STALE link and the start's time limit end the
 * run; the report only after our move; travel in mm; the alarm expectation ends with the run.
 */
import { describe, expect, it } from 'vitest';
import { checkWrite, type SessionState } from '../src/index.ts';
import { JOBS_RELEASE_NO_FI, runUntil, writes } from './jobHarness.ts';
import { CONFIG, R, probing, ready, zeroLine } from './probeDriver.ts';
import { START, passTouch, probeHarness, startProbe, untilResult } from './probeHarness.ts';

const PROBE_LINE = 'G91 G38.2 Z-5 F25';
const enc = (s: string): Uint8Array => new TextEncoder().encode(`${s}\n`);
const realtime = (r: R): string[] => r.fx.filter((e) => e.kind === 'writeRealtime').map((e) => (e as { name: string }).name);

/** G21 answered with a read ahead of the probe move, so the G38.2 waits in the queue. */
async function probeQueued(): Promise<R> {
  const r = (await ready()).intent(START);
  r.poll(1).modes();
  expect(r.writing).toBe('G21');
  r.s = { ...r.s, queue: [{ token: 'stat', purpose: 'request' }, ...r.s.queue] };
  r.answer();
  expect(r.s.queue.map((e) => e.line ?? e.token)).toEqual([PROBE_LINE]);
  return r;
}

/** The G38.2 handed to the transport, not yet written (it may sit behind XOFF). */
async function probeWriting(): Promise<R> {
  const r = (await ready()).intent(START);
  r.poll(1).modes().answer();
  expect(r.writing).toBe(PROBE_LINE);
  return r;
}

describe('Pause and Stop job at every point of the probe move', () => {
  it('queued: the move is dropped; Pause is the result at once, Stop job when its 207 comes', async () => {
    const p = await probeQueued();
    p.intent({ intent: 'feedhold' });
    expect(realtime(p)).toEqual(['feedhold']);
    expect(p.s.queue.some((e) => e.line === PROBE_LINE)).toBe(false);
    expect(p.s.probeZ.outcome).toEqual({ kind: 'paused' });
    const k = await probeQueued();
    k.intent({ intent: 'stopJob' });
    expect(realtime(k)).toEqual(['kill']);
    expect(k.s.queue.some((e) => e.line === PROBE_LINE)).toBe(false);
    expect(k.s.probeZ).toMatchObject({ step: 'starting', outcome: null, alarmExpected: true });
    k.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(k.s.probeZ.outcome).toEqual({ kind: 'stopJob', status: 207 });
    expect(k.s.fault).toBeNull();
  });

  it('being written: the write gate holds it back (never written, never a FAULT) and the drop ends a Pause', async () => {
    const p = await probeWriting();
    p.intent({ intent: 'feedhold' });
    expect(p.s.probeZ.outcome).toBeNull();
    expect(checkWrite(p.s, p.s, JOBS_RELEASE_NO_FI, enc(PROBE_LINE), 'motion', 'probeZ')).toEqual({ kind: 'denied', reason: 'not written: the probe was stopped or has ended' });
    p.ev({ type: 'lineDropped', epoch: p.s.epoch, seq: (p.s.writing as { seq: number }).seq });
    expect(p.s.probeZ.outcome).toEqual({ kind: 'paused' });
    expect(p.s.base).toBe('IDLE_UNHOMED');
    const k = await probeWriting();
    k.intent({ intent: 'stopJob' });
    expect(checkWrite(k.s, k.s, JOBS_RELEASE_NO_FI, enc(PROBE_LINE), 'motion', 'probeZ')).toMatchObject({ kind: 'denied' });
    k.ev({ type: 'lineDropped', epoch: k.s.epoch, seq: (k.s.writing as { seq: number }).seq });
    expect(k.s.probeZ.outcome).toBeNull();
    k.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(k.s.probeZ.outcome).toEqual({ kind: 'stopJob', status: 207 });
  });

  it('written before its answer, with the board in its probe cycle (stat 7) and no hold: `!` goes again', async () => {
    const p = await probeWriting();
    p.ev({ type: 'lineWritten', epoch: p.s.epoch, seq: (p.s.writing as { seq: number }).seq, at: p.at });
    p.intent({ intent: 'feedhold' });
    expect(realtime(p)).toEqual(['feedhold']);
    p.timer('probe');
    // The probe move's answer is owed first (data), then the poll.
    p.line(`{"r":{},"f":[${p.s.footerRev ?? 2},0,8]}`);
    p.poll(7);
    expect(realtime(p)).toEqual(['feedhold']);
    expect(p.s.probeZ.step).toBe('probing');
  });

  it('answered (probing): Pause sends `!` again while the cycle shows no hold, not once it holds; its end is the result', async () => {
    const p = await probing();
    p.intent({ intent: 'feedhold' });
    p.timer('probe');
    p.poll(7);
    expect(realtime(p)).toEqual(['feedhold']);
    p.timer('probe');
    p.inputs();
    // Held (hold 4): nothing more.
    for (const [token, value] of [['stat', 7], ['hold', 4], ['vel', 10], ['qr', 31]] as const) {
      expect(p.s.writing?.token).toBe(token);
      p.answer(value);
    }
    expect(realtime(p)).toEqual([]);
    p.line('{"prb":{"e":0,"x":0,"y":0,"z":-2,"a":0,"b":0,"c":0}}');
    p.line('{"er":{"fb":450.02,"st":250,"msg":"Probe did not trip"}}');
    expect(p.s.probeZ.outcome).toEqual({ kind: 'paused' });
    expect(p.s.fault).toBeNull();
    const k = await probing();
    k.intent({ intent: 'stopJob' });
    k.timer('probe');
    expect(k.s.queue.some((e) => e.token === 'stat')).toBe(false);
    k.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(k.s.probeZ.outcome).toEqual({ kind: 'stopJob', status: 207 });
  });

  it('on the model: Pause right at Start, and Stop job right after it, stop the probe with nothing moved and no FAULT', async () => {
    const h = await probeHarness({ plate: null });
    await passTouch(h);
    startProbe(h);
    await h.run(5);
    h.session.feedhold();
    await untilResult(h);
    await h.run(2000);
    expect(h.session.snapshot.probeZ.outcome?.kind).toBe('paused');
    expect(h.device.snapshot().position[2]).toBeGreaterThan(-1);
    expect(h.session.snapshot.fault).toBeNull();
    const k = await probeHarness({ plate: null });
    await passTouch(k);
    startProbe(k);
    await k.run(5);
    k.session.stopJob();
    await untilResult(k);
    expect(k.session.snapshot.probeZ.outcome).toEqual({ kind: 'stopJob', status: 207 });
    expect(k.session.snapshot.fault).toBeNull();
    expect(writes(k).filter((w) => w.startsWith('G91 G38.2'))).toEqual([]);
  });
});

describe('after a stop, an alarm, a STALE link', () => {
  it('Stop job with the zero in flight: no restore is queued, the queue is free, the alarm clears and the plate can be confirmed off', async () => {
    const h = await probeHarness();
    await passTouch(h);
    startProbe(h);
    await runUntil(h, () => h.session.state.probeZ.run?.zero === 'line' && !h.session.state.queue.some((q) => q.line?.startsWith('G10') === true), 30_000, 1);
    h.session.stopJob();
    await untilResult(h);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'zeroUnconfirmed' });
    await h.run(500);
    expect(h.session.state.queue.some((q) => q.purpose === 'probeZ')).toBe(false);
    expect(h.session.request({ intent: 'clearAlarm' })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.base === 'IDLE_UNHOMED');
    expect(h.session.request({ intent: 'probeZClose', step: 'plateOff' })).toEqual({ allowed: true });
  });

  it('Stop job before the zero went out: the zero line is dropped and never queued again; the 207 is the result', async () => {
    const r = await zeroLine();
    r.s = { ...r.s, queue: [r.s.writing as SessionState['queue'][number]], writing: null };
    r.intent({ intent: 'stopJob' });
    expect(r.s.probeZ.run?.zero).toBeNull();
    r.timer('probe');
    r.poll().timer('probe').poll();
    expect(r.s.queue.some((e) => e.line !== undefined)).toBe(false);
    r.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(r.s.probeZ.outcome).toEqual({ kind: 'stopJob', status: 207 });
  });

  it('a refused probe move in ALARM puts nothing back: the outcome at once', async () => {
    const r = await probeWriting();
    r.s = { ...r.s, base: 'ALARM' };
    r.answer(0, 204);
    expect(r.s.probeZ.outcome).toEqual({ kind: 'refused', status: 204, text: 'The controller refused it (status 204).' });
    expect(r.s.queue.some((e) => e.line !== undefined)).toBe(false);
  });

  it('STALE while starting (the check unanswered) ends the run: lost during the probe; Disconnect is allowed again', async () => {
    const r = (await ready()).intent(START);
    expect(r.writing).toBe('stat');
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at });
    r.timer('answer');
    expect(r.s.probeZ.outcome).toEqual({ kind: 'lost', during: 'probe' });
    expect(r.s.base).toBe('IDLE_UNHOMED');
    expect(r.intent({ intent: 'disconnect' }).fx.find((e) => e.kind === 'decision')).toMatchObject({ decision: { allowed: true } });
  });

  it('the start has a time limit: a failing check, a stopped start, and a move out with no answer', async () => {
    const a = (await ready()).intent(START);
    a.answer(1).answer(0).answer(0).answer(32, 100);
    a.at += 6000;
    a.timer('probe');
    expect(a.s.probeZ.outcome).toEqual({ kind: 'refused', status: 0, text: 'The board did not answer in time, so the probe move was not sent.' });
    const k = await probeQueued();
    k.intent({ intent: 'stopJob' });
    k.at += 6000;
    k.timer('probe');
    expect(k.s.probeZ).toMatchObject({ outcome: { kind: 'stopJob', status: 207 }, alarmExpected: false });
    const w = await probeWriting();
    w.ev({ type: 'lineWritten', epoch: w.s.epoch, seq: (w.s.writing as { seq: number }).seq, at: w.at });
    w.at += 6000;
    w.timer('probe');
    expect(w.s.probeZ).toMatchObject({ outcome: { kind: 'noReport' }, alarmExpected: false });
  });

  it('a report before our move went out is ignored and logged', async () => {
    const r = await probeQueued();
    r.line('{"prb":{"e":1,"x":0,"y":0,"z":-1,"a":0,"b":0,"c":0}}');
    expect(r.s.probeZ.run?.report).toBeNull();
    expect(r.fx.find((e) => e.kind === 'log')).toMatchObject({ text: expect.stringContaining('no probe move of ours out') });
  });

  it('travel is in mm on both sides: a start in inches is converted; unknown units leave it unknown', async () => {
    const r = await ready();
    r.s = { ...r.s, live: { ...r.s.live, unit: 0, pos: { ...r.s.live.pos, z: 0.5 } } };
    r.intent(START);
    expect(r.s.probeZ.run?.fromPos).toBeCloseTo(12.7, 6);
    const u = await ready();
    u.s = { ...u.s, live: { ...u.s.live, unit: 5 } };
    u.intent(START);
    expect(u.s.probeZ.run?.fromPos).toBeNull();
  });

  it('odd answers: a refused read-back, a line answered after its run ended, a hold-free check before the cycle, a dropped restore', async () => {
    const z = await zeroLine();
    z.answer();
    z.at += 300;
    z.timer('probe');
    z.ev({ type: 'lineWritten', epoch: z.s.epoch, seq: (z.s.writing as { seq: number }).seq, at: z.at }).line(`{"r":{},"f":[${z.s.footerRev ?? 2},100,8]}`);
    expect(z.s.values['g54']).toMatchObject({ value: null, status: 100 });
    z.answer({ z: 12.678 }).answer({ z: -15.7 }).answer(1);
    expect(z.s.probeZ.run?.zero).toBe('restore');
    z.s = { ...z.s, queue: [z.s.writing as SessionState['queue'][number]], writing: null, overlays: ['NEEDS_REVIEW'] };
    z.ev({ type: 'intent', at: z.at, request: { intent: 'read', tokens: ['vel'] } });
    expect(z.s.probeZ.outcome).toMatchObject({ kind: 'contactZeroSet' });
    // Pause with the G21 out: the result at once; the G21's late answer belongs to no run.
    const g = (await ready()).intent(START);
    g.poll(1).modes();
    g.ev({ type: 'lineWritten', epoch: g.s.epoch, seq: (g.s.writing as { seq: number }).seq, at: g.at });
    g.intent({ intent: 'feedhold' });
    expect(g.s.probeZ.outcome).toEqual({ kind: 'paused' });
    g.line(`{"r":{},"f":[${g.s.footerRev ?? 2},0,8]}`);
    expect(g.s.queue.some((e) => e.line !== undefined)).toBe(false);
    // Paused while the move is out but the board not yet in its cycle (stat 1): no `!` yet.
    const w = await probeWriting();
    w.ev({ type: 'lineWritten', epoch: w.s.epoch, seq: (w.s.writing as { seq: number }).seq, at: w.at });
    w.intent({ intent: 'feedhold' });
    w.timer('probe');
    w.s = { ...w.s, expected: [] };
    w.ev({ type: 'intent', at: w.at, request: { intent: 'read', tokens: ['vel'] } });
    w.poll(1);
    expect(realtime(w)).toEqual([]);
  });

  it('the alarm expectation ends with the run: a later 250 after a FAULT ended the probe is a FAULT as any other', async () => {
    const r = await probing();
    r.s = { ...r.s, queue: [{ token: 'gc', purpose: 'probeZ', line: 'G21', intent: 'probeZ' }] };
    r.ev({ type: 'intent', at: r.at, request: { intent: 'read', tokens: ['stat'] } });
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at }).line('{"r":{},"f":[2,0');
    expect(r.s.probeZ).toMatchObject({ outcome: { kind: 'noReport' }, alarmExpected: false });
    expect(CONFIG.release).toBe(JOBS_RELEASE_NO_FI);
  });

  it('A: Stop job with the zero or the restore line being written: held back, the run ends, its 207 is no FAULT', async () => {
    const z = await zeroLine();
    z.intent({ intent: 'stopJob' });
    expect(realtime(z)).toEqual(['kill']);
    expect(checkWrite(z.s, z.s, JOBS_RELEASE_NO_FI, enc('G10 L20 P1 Z12.6782'), 'motion', 'probeZ')).toMatchObject({ kind: 'denied' });
    z.ev({ type: 'lineDropped', epoch: z.s.epoch, seq: (z.s.writing as { seq: number }).seq });
    expect(z.s.probeZ.outcome).toEqual({ kind: 'zeroUnconfirmed' });
    z.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(z.s.fault).toBeNull();
    const r = await restoreWriting();
    r.intent({ intent: 'stopJob' });
    r.ev({ type: 'lineDropped', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq });
    expect(r.s.probeZ.outcome).toMatchObject({ kind: 'contactZeroSet' });
  });

  it('A: every phase of the zero has a time limit, so nothing waits forever', async () => {
    const z = await zeroLine();
    z.ev({ type: 'lineWritten', epoch: z.s.epoch, seq: (z.s.writing as { seq: number }).seq, at: z.at });
    z.at += 6000;
    z.timer('probe');
    expect(z.s.probeZ.outcome).toEqual({ kind: 'zeroUnconfirmed' });
    const r = await restoreWriting();
    r.at += 6000;
    r.timer('probe');
    expect(r.s.probeZ.outcome).toMatchObject({ kind: 'contactZeroSet' });
  });

  it('B: Pause with the restore line being written after an agreeing read-back: the zero that was set is said', async () => {
    const r = await restoreWriting();
    r.intent({ intent: 'feedhold' });
    expect(r.s.probeZ.outcome).toBeNull();
    r.ev({ type: 'lineDropped', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq });
    expect(r.s.probeZ.outcome).toMatchObject({ kind: 'contactZeroSet' });
  });

  it('C: Stop job just before the start limit: the run ends on the limit and the 207 that follows is still no FAULT', async () => {
    const k = await probeQueued();
    k.s = { ...k.s, probeZ: { ...k.s.probeZ, run: { ...(k.s.probeZ.run as NonNullable<SessionState['probeZ']['run']>), deadline: k.at + 100 } } };
    k.intent({ intent: 'stopJob' });
    k.at += 200;
    k.timer('probe');
    expect(k.s.probeZ).toMatchObject({ outcome: { kind: 'stopJob', status: 207 }, alarmExpected: false });
    k.at += 100;
    k.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(k.s.fault).toBeNull();
    expect(k.s.probeZ.killUntil).toBeNull();
    // Past the grace period a 207 is a FAULT as any other.
    const g = await probeQueued();
    g.intent({ intent: 'stopJob' });
    g.at += 6000;
    g.timer('probe');
    g.at += 1;
    g.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(g.s.fault?.cause).toBe('exceptionReport');
  });

  it('D: STALE while the probe may be moving writes `!`; STALE while zeroing (at rest) writes nothing', async () => {
    const r = await probing();
    r.timer('probe');
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at });
    r.timer('answer');
    expect(r.s.probeZ.outcome).toEqual({ kind: 'lost', during: 'probe' });
    expect(realtime(r)).toEqual(['feedhold']);
    const z = await zeroLine();
    z.ev({ type: 'lineWritten', epoch: z.s.epoch, seq: (z.s.writing as { seq: number }).seq, at: z.at });
    z.timer('answer');
    expect(z.s.probeZ.outcome).toEqual({ kind: 'lost', during: 'zero' });
    expect(realtime(z)).toEqual([]);
  });
});

/** The zero answered, its read-back agreeing, and the restore line being written. */
async function restoreWriting(): Promise<R> {
  const r = await zeroLine();
  r.answer();
  r.at += 300;
  r.timer('probe');
  r.inputs();
  r.answer({ x: 0, y: 0, z: -15.7 }).answer({ x: 0, y: 0, z: 12.678 }).answer({ x: 0, y: 0, z: -15.7 }).answer(1);
  expect(r.writing).toBe('G90');
  return r;
}
