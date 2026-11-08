/**
 * T-S130, T-S131 (U): Probe Z through the pure reducer, from a real session's state, for the cases the model does not
 * reach on its own: answers that time out or arrive damaged, a FAULT or a lost link at each step, a stop after the
 * zero went out, the start's own refusals, and the report frame of later builds.
 */
import { describe, expect, it } from 'vitest';
import { snapshotOf, type SessionState } from '../src/index.ts';
import { START, TOUCH } from './probeHarness.ts';
import { R, probing, ready, zeroLine } from './probeDriver.ts';

describe('Probe Z through the reducer', () => {
  it('the start refuses a stale reading, a block and changed settings; a moving machine at the check is refused, a damaged check asks again', async () => {
    const r = await ready();
    r.at += 5000;
    expect(r.intent(START).fx.find((e) => e.kind === 'decision')).toMatchObject({ decision: { allowed: false, reason: 'The probe input does not read Not touching right now.' } });
    const b = await ready();
    b.s = { ...b.s, live: { ...b.s.live, spe: 1 } };
    expect(b.intent(START).fx.find((e) => e.kind === 'decision')).toMatchObject({ decision: { allowed: false, reason: 'The spindle is on.' } });
    const c = await ready();
    c.s = { ...c.s, probeZ: { ...c.s.probeZ, settings: { ...c.s.probeZ.settings, zjh: 41 } } };
    expect(c.intent(START).fx.find((e) => e.kind === 'decision')).toMatchObject({ decision: { allowed: false, reason: "The board's probe settings changed." } });
    const d = (await ready()).intent(START);
    d.poll(5);
    expect(d.s.probeZ).toMatchObject({ step: 'result', outcome: { kind: 'refused', status: 0, text: 'The machine was not at rest, so nothing was sent.' } });
    expect(d.s.base).toBe('IDLE_UNHOMED');
    const e = (await ready()).intent(START);
    e.answer(1).answer(0).answer(0).answer(32, 100);
    expect(e.writing).toBe('stat');
    expect(e.s.probeZ.step).toBe('starting');
  });

  it('retest while blocked or while the settings are being read; a touch test with no input reading', async () => {
    const r = await ready();
    r.s = { ...r.s, live: { ...r.s.live, spc: 1 } };
    expect(r.intent({ intent: 'probeZ', step: 'retest' }).fx.find((e) => e.kind === 'decision')).toMatchObject({ decision: { allowed: false, reason: 'The spindle is on.' } });
    const t = await ready();
    t.intent(TOUCH);
    expect(t.s.probeZ.refreshing).toBe(true);
    t.intent({ intent: 'probeZ', step: 'retest' });
    expect(t.s.probeZ).toMatchObject({ step: 'touch', anchor: null, refreshing: true });
    // A timer while the settings are read only ticks again; a settings read that times out ends the refresh.
    t.timer('probe');
    expect(t.s.timers.probe).toBeDefined();
    t.ev({ type: 'lineWritten', epoch: t.s.epoch, seq: (t.s.writing as { seq: number }).seq, at: t.at });
    t.timer('answer');
    expect(t.s.probeZ.refreshing).toBe(false);
    expect(t.s.overlays).toContain('STALE');
  });

  it('settings answers: zjh read in inches is converted back to mm with the units read with it (never the live view), unknown units leave it unread, a refused read is unread', async () => {
    const r = await ready();
    // The live view says mm (a late report); the board reads inches: the read wins (OD-19).
    r.s = { ...r.s, live: { ...r.s.live, unit: 1 } };
    r.intent(TOUCH);
    for (let i = 0; i < 9; i++) r.answer(r.s.writing?.token === 'zsn' ? 4 : 0);
    expect(r.writing).toBe('unit');
    r.answer(0);
    expect(r.writing).toBe('zjh');
    r.answer(1.5748);
    expect(r.s.probeZ.settings).toMatchObject({ unit: 0 });
    expect(r.s.probeZ.settings.zjh).toBeCloseTo(40, 3);
    r.intent(TOUCH);
    for (let i = 0; i < 9; i++) r.answer(r.s.writing?.token === 'zsn' ? 4 : 0);
    r.answer(null, 100); // the units read refused
    r.answer(40);
    expect(r.s.probeZ.settings.zjh).toBeNull();
    r.intent({ intent: 'probeZClose', step: 'cancel' });
    const q = await ready();
    q.intent(TOUCH);
    q.answer('x');
    expect(q.s.probeZ.settings.modes[0]).toBeNull();
    // A damaged settings answer counts as unread.
    q.ev({ type: 'lineWritten', epoch: q.s.epoch, seq: (q.s.writing as { seq: number }).seq, at: q.at }).line('{"r":{"xsx":');
    expect(q.s.probeZ.settings.modes[1]).toBeNull();
  });

  it('input readings: disabled, no reading; an input read that times out or arrives damaged changes nothing', async () => {
    const r = await ready();
    r.intent({ intent: 'probeZ', step: 'retest' });
    r.timer('probe');
    expect(r.writing).toBe('in5');
    r.answer(-1);
    expect(snapshotOf(r.s).probeZ.input?.reading).toBe('disabled');
    r.timer('probe');
    r.answer(7);
    expect(snapshotOf(r.s).probeZ.input?.reading).toBeNull();
    r.timer('probe');
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at }).line('{"r":{"in5":');
    expect(snapshotOf(r.s).probeZ.input?.reading).toBeNull();
    r.timer('probe');
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at });
    r.timer('answer');
    expect(r.s.probeZ.step).toBe('touch');
  });

  it('a contact after Pause or Stop job ends the probe with the stop, never a zero', async () => {
    const r = await probing();
    r.intent({ intent: 'feedhold' });
    expect(r.fx.some((e) => e.kind === 'writeRealtime' && e.name === 'feedhold')).toBe(true);
    r.line('{"prb":{"e":1,"x":0,"y":0,"z":-1,"a":0,"b":0,"c":0}}');
    expect(r.s.probeZ).toMatchObject({ step: 'result', outcome: { kind: 'paused' }, alarmExpected: false });
    const k = await probing();
    k.intent({ intent: 'stopJob' });
    expect(k.fx.find((e) => e.kind === 'writeRealtime')).toMatchObject({ name: 'kill', byte: 4, intent: 'stopJob' });
    // A Pause after the Stop job keeps the Stop job.
    k.intent({ intent: 'feedhold' });
    k.line('{"prb":{"e":1,"x":0,"y":0,"z":-1,"a":0,"b":0,"c":0}}');
    // No zero, and no result yet: the ^D's ALARM 207 is the result.
    expect(k.s.probeZ).toMatchObject({ step: 'probing', outcome: null, alarmExpected: true });
    k.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(k.s.fault).toBeNull();
    expect(k.s.probeZ).toMatchObject({ outcome: { kind: 'stopJob', status: 207 }, alarmExpected: false });
  });

  it('a ^D from another stop: an alarm 207 with no stop pressed is still a Stop job; 250 says already tripped or not', async () => {
    const r = await probing();
    r.s = { ...r.s, live: { ...r.s.live, stat: 7 } };
    r.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(r.s.probeZ.outcome).toEqual({ kind: 'stopJob', status: 207 });
    expect(r.s.base).toBe('ALARM');
    // OD-19: its G21 and G91 went out, so Clear alarm will put G90 back (with the units it read, mm here).
    expect(r.s.alarmRestore).toEqual({ units: 1 });
    const n = await probing();
    n.line('{"prb":{"e":0,"x":0,"y":0,"z":"x","a":0,"b":0,"c":0}}');
    n.line('{"er":{"fb":450.02,"st":250,"msg":"Probe did not trip"}}');
    expect(n.s.probeZ.outcome).toEqual({ kind: 'noContact', travelMm: null, status: 250 });
    // An alarm the probe does not expect is a FAULT as ever.
    n.line('{"er":{"fb":450.02,"st":250,"msg":"Probe did not trip"}}');
    expect(n.s.fault?.cause).toBe('exceptionReport');
  });

  it('the report frame: machine mm from 450.03; a report with no probe running is only logged', async () => {
    const r = await probing();
    r.s = { ...r.s, identity: { ...r.s.identity, fb: 450.03 }, probeZ: { ...r.s.probeZ, run: { ...(r.s.probeZ.run as NonNullable<SessionState['probeZ']['run']>), fromMpo: 10, fromPos: 0 } } };
    r.line('{"prb":{"e":0,"x":0,"y":0,"z":6,"a":0,"b":0,"c":0}}');
    r.line('{"er":{"fb":450.03,"st":250,"msg":"Probe did not trip"}}');
    expect(r.s.probeZ.outcome).toEqual({ kind: 'noContact', travelMm: 4, status: 250 });
    r.line('{"prb":{"e":1,"x":0,"y":0,"z":6,"a":0,"b":0,"c":0}}');
    expect(r.fx.find((e) => e.kind === 'log')).toMatchObject({ text: expect.stringContaining('a probe report arrived with no probe move of ours out') });
    const u = await probing();
    u.s = { ...u.s, probeZ: { ...u.s.probeZ, run: { ...(u.s.probeZ.run as NonNullable<SessionState['probeZ']['run']>), fromPos: null } } };
    u.line('{"er":{"fb":450.02,"st":250,"msg":"Probe did not trip"}}');
    expect(u.s.probeZ.outcome).toEqual({ kind: 'noContact', travelMm: null, status: 250 });
  });

  it('after the zero went out a stop does not decide it: the read-back does; the stop\'s alarm is the probe\'s', async () => {
    const r = await zeroLine();
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at });
    r.intent({ intent: 'stopJob' });
    expect(r.s.probeZ.step).toBe('zeroing');
    r.line('{"er":{"fb":450.02,"st":207,"msg":"job kill"}}');
    expect(r.s.fault).toBeNull();
    expect(r.s.probeZ.step).toBe('zeroing');
    r.line(`{"r":{},"f":[${r.s.footerRev ?? 2},0,8]}`);
    expect(r.s.probeZ.run?.zero).toBe('settle');
    r.at += 300;
    r.timer('probe');
    r.answer({ x: 0, y: 0, z: -15.7 }).answer({ x: 0, y: 0, z: 12.678 }).answer({ x: 0, y: 0, z: -15.7 }).answer(1);
    // The read-back agrees, but Stop job was pressed while the zero was in flight: no zero is claimed, and nothing
    // more is sent after the stop (no restore line).
    expect(r.s.probeZ.outcome).toEqual({ kind: 'zeroUnconfirmed' });
    expect(r.s.queue.some((e) => e.line !== undefined)).toBe(false);
  });

  it('Stop job is allowed in every step of a running probe and writes ^D; Pause is allowed and writes `!`, never `~`', async () => {
    const steps: readonly [string, () => Promise<R>][] = [
      ['starting, before G21', async () => (await ready()).intent(START)],
      ['starting, G21 out', async () => {
        const r = (await ready()).intent(START);
        r.poll(1).modes();
        return r;
      }],
      ['probing', probing],
      ['zeroing, before the zero', async () => {
        const r = await probing();
        return r.line('{"prb":{"e":1,"x":0,"y":0,"z":-1,"a":0,"b":0,"c":0}}');
      }],
      ['zeroing, the zero in flight', zeroLine],
    ];
    for (const [name, make] of steps) {
      const k = await make();
      k.intent({ intent: 'stopJob' });
      expect(k.fx.find((e) => e.kind === 'decision'), name).toMatchObject({ decision: { allowed: true } });
      expect(k.fx.find((e) => e.kind === 'writeRealtime'), name).toMatchObject({ name: 'kill', byte: 4 });
      const p = await make();
      p.intent({ intent: 'feedhold' });
      expect(p.fx.find((e) => e.kind === 'decision'), name).toMatchObject({ decision: { allowed: true } });
      expect(p.fx.filter((e) => e.kind === 'writeRealtime').map((e) => (e as { name: string }).name), name).toEqual(['feedhold']);
      // Resume is refused (no hold of this session's motion), so `~` is never written.
      p.intent({ intent: 'resume' });
      expect(p.fx.some((e) => e.kind === 'writeRealtime' && e.name === 'resume'), name).toBe(false);
    }
  });

  it('a stop before the zero went out (machine at rest): the stop is the result', async () => {
    const r = await probing();
    r.line('{"prb":{"e":1,"x":0,"y":0,"z":-1,"a":0,"b":0,"c":0}}');
    r.intent({ intent: 'feedhold' });
    expect(r.s.probeZ.outcome).toEqual({ kind: 'paused' });
    const q = await zeroLine();
    q.s = { ...q.s, queue: [q.s.writing as SessionState['queue'][number], ...q.s.queue], writing: null };
    q.intent({ intent: 'feedhold' });
    expect(q.s.probeZ.outcome).toEqual({ kind: 'paused' });
    expect(q.s.queue.some((e) => e.line !== undefined)).toBe(false);
  });

  it('read-backs that cannot confirm: no offset, a wrong system, a value of the wrong shape', async () => {
    for (const [pos, ofs, coor] of [[{ x: 0, z: 12.678 }, 'x', 1], [[1], { z: 1 }, 2], [{ z: 'a' }, { z: 1 }, 'x']] as const) {
      const r = await zeroLine();
      r.answer();
      r.at += 300;
      r.timer('probe');
      r.answer({ x: 0, y: 0, z: -15.7 }).answer(pos).answer(ofs).answer(coor);
      r.answer();
      expect(r.s.probeZ.outcome, JSON.stringify([pos, ofs, coor])).toEqual({ kind: 'zeroUnconfirmed' });
    }
    // A read-back arriving when none is wanted is ignored.
    const x = await probing();
    x.s = { ...x.s, queue: [{ token: 'pos', purpose: 'probeZ' }] };
    x.ev({ type: 'intent', at: x.at, request: { intent: 'read', tokens: ['stat'] } });
    x.answer({ z: 1 });
    expect(x.s.probeZ.step).toBe('probing');
  });

  it('answers that time out: the probe move, the zero, its read-back and the restore each end the probe honestly', async () => {
    const a = await probing();
    a.s = { ...a.s, probeZ: { ...a.s.probeZ, step: 'starting' } };
    a.s = { ...a.s, queue: [{ token: 'gc', purpose: 'probeZ', line: 'G91 G38.2 Z-5 F25', intent: 'probeZ' }] };
    a.ev({ type: 'intent', at: a.at, request: { intent: 'read', tokens: ['stat'] } });
    a.ev({ type: 'lineWritten', epoch: a.s.epoch, seq: (a.s.writing as { seq: number }).seq, at: a.at });
    a.timer('answer');
    // STALE ends the run: the link is lost during the probe.
    expect(a.s.probeZ.outcome).toEqual({ kind: 'lost', during: 'probe' });
    expect(a.s.overlays).toContain('STALE');
    const z = await zeroLine();
    z.ev({ type: 'lineWritten', epoch: z.s.epoch, seq: (z.s.writing as { seq: number }).seq, at: z.at });
    z.timer('answer');
    expect(z.s.probeZ.outcome).toEqual({ kind: 'lost', during: 'zero' });
    const rb = await zeroLine();
    rb.answer();
    rb.at += 300;
    rb.timer('probe');
    rb.ev({ type: 'lineWritten', epoch: rb.s.epoch, seq: (rb.s.writing as { seq: number }).seq, at: rb.at });
    rb.timer('answer');
    expect(rb.s.probeZ.outcome).toEqual({ kind: 'lost', during: 'zero' });
    const re = await zeroLine();
    re.answer();
    re.at += 300;
    re.timer('probe');
    re.answer({ x: 0, y: 0, z: -15.7 }).answer({ z: 12.678 }).answer({ z: -15.7 }).answer(1);
    re.ev({ type: 'lineWritten', epoch: re.s.epoch, seq: (re.s.writing as { seq: number }).seq, at: re.at });
    re.timer('answer');
    expect(re.s.probeZ.outcome).toMatchObject({ kind: 'contactZeroSet' });
  });

  it('a damaged answer to a probe line is a FAULT, and the probe says what is known', async () => {
    const r = await probing();
    r.s = { ...r.s, queue: [{ token: 'gc', purpose: 'probeZ', line: 'G21', intent: 'probeZ' }] };
    r.ev({ type: 'intent', at: r.at, request: { intent: 'read', tokens: ['stat'] } });
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at }).line('{"r":{},"f":[2,0');
    expect(r.s.fault?.cause).toBe('unexpectedResponse');
    expect(r.s.probeZ.outcome).toEqual({ kind: 'noReport' });
    const z = await zeroLine();
    z.ev({ type: 'lineWritten', epoch: z.s.epoch, seq: (z.s.writing as { seq: number }).seq, at: z.at }).line('{"r":{},"f":[2,0');
    expect(z.s.probeZ.outcome).toEqual({ kind: 'zeroUnconfirmed' });
  });

  it('a lost link while zeroing; the time limit also covers the wait for rest after a contact', async () => {
    const r = await zeroLine();
    r.ev({ type: 'linkLost', epoch: r.s.epoch, at: r.at });
    expect(r.s.probeZ.outcome).toEqual({ kind: 'lost', during: 'zero' });
    const w = await probing();
    w.line('{"prb":{"e":1,"x":0,"y":0,"z":-1,"a":0,"b":0,"c":0}}');
    w.poll(7);
    w.at += 60_000;
    w.timer('probe');
    expect(w.s.probeZ.outcome).toEqual({ kind: 'noReport' });
    const n = await probing();
    n.line('{"prb":{"e":1,"x":0,"y":0,"z":-1,"a":0,"b":0,"c":0}}');
    n.s = { ...n.s, live: { ...n.s.live, coor: 0 } };
    n.poll().timer('probe').poll();
    expect(n.s.probeZ.run?.zero).toBeNull();
  });

  it('the input poll asks once at a time: a read waiting, being written or owed is not asked again; a refused one is no reading', async () => {
    const r = await ready();
    r.intent({ intent: 'probeZ', step: 'retest' });
    r.timer('probe');
    expect(r.writing).toBe('in5');
    r.timer('probe');
    expect(r.s.queue.filter((e) => e.token === 'in5')).toHaveLength(0);
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at });
    r.timer('probe');
    expect(r.s.queue.filter((e) => e.token === 'in5')).toHaveLength(0);
    r.line(`{"r":{},"f":[${r.s.footerRev ?? 2},100,8]}`);
    expect(snapshotOf(r.s).probeZ.input?.reading).toBeNull();
    // Waiting behind another read.
    r.s = { ...r.s, queue: [{ token: 'stat', purpose: 'request' }] };
    r.ev({ type: 'intent', at: r.at, request: { intent: 'read', tokens: ['vel'] } });
    r.timer('probe');
    r.timer('probe');
    expect(r.s.queue.filter((e) => e.token === 'in5')).toHaveLength(1);
  });

  it('a probe input read that times out while the probe runs: the link goes STALE, which ends the run', async () => {
    const r = await probing();
    r.timer('probe');
    expect(r.writing).toBe('in5');
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at });
    r.timer('answer');
    expect(r.s.probeZ.outcome).toEqual({ kind: 'lost', during: 'probe' });
    expect(r.s.overlays).toContain('STALE');
    expect(r.s.base).toBe('IDLE_UNHOMED');
  });

  it('a start with no position known, and a touch test anchored with no state or position known', async () => {
    const r = await ready();
    r.s = { ...r.s, live: { ...r.s.live, pos: {}, mpo: {} } };
    r.intent(START);
    expect(r.s.probeZ.run).toMatchObject({ fromPos: null, fromMpo: null });
    const a = await ready();
    a.s = { ...a.s, live: { ...a.s.live, mpo: {} } as SessionState['live'] };
    delete (a.s.live as { stat?: number }).stat;
    a.intent({ intent: 'probeZ', step: 'retest' });
    expect(a.s.probeZ.anchor).toContain('[null,null,null]');
  });

  it('timers and polls that come when the probe has nothing to do with them change nothing', async () => {
    const r = await probing();
    r.s = { ...r.s, queue: [{ token: 'stat', purpose: 'poll' }, { token: 'hold', purpose: 'poll' }, { token: 'vel', purpose: 'poll' }, { token: 'qr', purpose: 'poll' }] };
    r.ev({ type: 'intent', at: r.at, request: { intent: 'read', tokens: ['vel'] } });
    r.poll(7);
    expect(r.s.probeZ.step).toBe('probing');
    const b = await ready();
    b.s = { ...b.s, live: { ...b.s.live, spe: 1 } };
    b.ev({ type: 'intent', at: b.at, request: { intent: 'read', tokens: ['vel'] } });
    expect(b.s.probeZ.block).toBe('spindleOn');
    b.s = { ...b.s, timers: { ...b.s.timers, probe: 99 } };
    b.timer('probe');
    expect(b.s.timers.probe).toBeUndefined();
    // While the zero's steps run the timer keeps ticking: their time limit is checked on it.
    const z = await zeroLine();
    z.s = { ...z.s, timers: { ...z.s.timers, probe: 99 } };
    z.timer('probe');
    expect(z.s.timers.probe).toBeDefined();
    // A contact with no start position known still sets the zero (the travel is not known: 0).
    const n = await zeroLine();
    n.s = { ...n.s, probeZ: { ...n.s.probeZ, run: { ...(n.s.probeZ.run as NonNullable<SessionState['probeZ']['run']>), fromPos: null } } };
    n.answer();
    n.at += 300;
    n.timer('probe');
    n.answer({ x: 0, y: 0, z: -15.7 }).answer({ z: 12.678 }).answer({ z: -15.7 }).answer(1).answer();
    expect(n.s.probeZ.outcome).toMatchObject({ kind: 'contactZeroSet', travelMm: 0 });
  });

  it('a probe line the matrix no longer allows is dropped, never held, and the probe says it was not sent', async () => {
    const z = await zeroLine();
    z.s = { ...z.s, queue: [z.s.writing as SessionState['queue'][number]], writing: null, overlays: ['STALE'] };
    z.ev({ type: 'intent', at: z.at, request: { intent: 'read', tokens: ['vel'] } });
    expect(z.s.probeZ.outcome).toEqual({ kind: 'zeroUnconfirmed' });
    const g = (await ready()).intent(START);
    g.poll(1).modes();
    g.s = { ...g.s, queue: [g.s.writing as SessionState['queue'][number]], writing: null, base: 'ALARM' };
    g.ev({ type: 'intent', at: g.at, request: { intent: 'read', tokens: ['vel'] } });
    expect(g.s.probeZ.outcome).toEqual({ kind: 'refused', status: 0, text: 'Not sent: the machine left the state that allows it.' });
    // A leftover probe line with no run is only dropped.
    const n = await ready();
    n.s = { ...n.s, queue: [{ token: 'gc', purpose: 'probeZ', line: 'G21', intent: 'probeZ' }], base: 'ALARM' };
    n.ev({ type: 'intent', at: n.at, request: { intent: 'read', tokens: ['vel'] } });
    expect(n.s.queue.some((e) => e.line === 'G21')).toBe(false);
  });

  it('the G21 answer after a stop queues nothing more; a refused G21 is the result', async () => {
    const r = (await ready()).intent(START);
    r.poll(1).modes();
    r.ev({ type: 'lineWritten', epoch: r.s.epoch, seq: (r.s.writing as { seq: number }).seq, at: r.at });
    r.s = { ...r.s, probeZ: { ...r.s.probeZ, run: { ...(r.s.probeZ.run as NonNullable<SessionState['probeZ']['run']>), stopped: 'pause' } } };
    r.line(`{"r":{},"f":[${r.s.footerRev ?? 2},0,8]}`);
    expect(r.s.queue.some((e) => e.line !== undefined)).toBe(false);
  });
});
