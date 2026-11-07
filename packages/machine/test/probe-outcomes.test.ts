/**
 * T-S131 (Probe Z, SAFETY §4.5c, H90): outcomes from the edge-next model: contact, no contact, already tripped, soft
 * limit, limit, a refused reply, Pause, Stop job, a lost link, no report, a refused or unconfirmed zero; Start job
 * and Spindle on refused while the plate is out, Pause, Stop job and Spindle off never.
 */
import { describe, expect, it } from 'vitest';
import { PLATE_OUT_TEXT, type SessionIntent } from '../src/index.ts';
import { runUntil, writes } from './jobHarness.ts';
import { PLATE_Z, START, TOUCH, passTouch, probeHarness, probeWrites, startProbe, untilResult, type ProbeHarness } from './probeHarness.ts';

async function probed(h: ProbeHarness, plan: SessionIntent = TOUCH): Promise<number> {
  await passTouch(h, plan);
  const from = startProbe(h);
  await untilResult(h);
  return from;
}

const clearAlarm = async (h: ProbeHarness): Promise<void> => {
  expect(h.session.request({ intent: 'clearAlarm' })).toEqual({ allowed: true });
  await runUntil(h, () => h.session.snapshot.base === 'IDLE_UNHOMED');
};

describe('T-S131: outcomes', () => {
  it('contact: the zero is set and read back; the tool reads thickness less the stop distance', async () => {
    const h = await probeHarness();
    await probed(h);
    const outcome = h.session.snapshot.probeZ.outcome;
    expect(outcome).toMatchObject({ kind: 'contactZeroSet' });
    if (outcome?.kind !== 'contactZeroSet') throw new Error('no contact');
    expect(outcome.zeroZ).toBeCloseTo(12.6782, 4);
    expect(outcome.stopMm).toBeCloseTo(0.0218, 4);
    expect(outcome.travelMm).toBeGreaterThan(3);
    expect(h.session.snapshot.live.pos.z).toBeCloseTo(12.678, 3);
    // The model stopped a little below the plate after contact; the zero accounts for the calculated distance.
    expect(h.device.snapshot().position[2]).toBeLessThan(PLATE_Z);
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'result', plateOut: true, touch: { sawReleased: true } });
    expect(h.session.snapshot.fault).toBeNull();
  });

  it('no contact (no plate): ALARM 250, Z went the whole depth, no zero, no FAULT; the owner clears it', async () => {
    const h = await probeHarness({ plate: null });
    await probed(h);
    expect(h.session.snapshot.probeZ.outcome).toMatchObject({ kind: 'noContact', status: 250 });
    const outcome = h.session.snapshot.probeZ.outcome;
    expect(outcome?.kind === 'noContact' && outcome.travelMm).toBeCloseTo(5, 2);
    expect(h.session.snapshot.base).toBe('ALARM');
    expect(h.session.snapshot.fault).toBeNull();
    expect(h.session.snapshot.probeZ.block).toBe('alarm');
    expect(h.session.snapshot.motion).toBeNull();
    await clearAlarm(h);
    expect(h.session.snapshot.probeZ.block).toBeNull();
  });

  it('a lead that comes off on a normally open plate is not detected: the probe runs to the depth and alarms (W52)', async () => {
    const h = await probeHarness();
    await passTouch(h);
    h.model.setProbeLead(false);
    startProbe(h);
    await untilResult(h);
    expect(h.session.snapshot.probeZ.outcome).toMatchObject({ kind: 'noContact', status: 250 });
    expect(h.device.snapshot().position[2]).toBeCloseTo(-5, 2);
  });

  it('already tripped: no motion, ALARM 250 "Probe already tripped"', async () => {
    const h = await probeHarness();
    await passTouch(h);
    startProbe(h);
    h.model.setProbeTouch(true);
    await untilResult(h);
    expect(h.session.snapshot.probeZ.outcome).toMatchObject({ kind: 'alreadyTripped', status: 250 });
    expect(h.device.snapshot().position[2]).toBe(0);
  });

  it('soft limit: ALARM 220, nothing moves, no report', async () => {
    const h = await probeHarness({ eeprom: { sl: 1, ztn: -2, ztm: 10 } });
    h.model.setHomed(['x', 'y', 'z']);
    await h.run(200);
    await probed(h);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'softLimit', status: 220 });
    expect(h.device.snapshot().position[2]).toBe(0);
  });

  it('a limit input during the probe: ALARM 203', async () => {
    const h = await probeHarness({ plate: null });
    await passTouch(h);
    startProbe(h);
    await runUntil(h, () => h.session.snapshot.probeZ.step === 'probing');
    await h.run(500);
    h.model.injectLimitSwitch(6);
    await untilResult(h);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'limit', status: 203 });
  });

  it('a refused reply: the board says why, no alarm, nothing moved, and the modes are put back', async () => {
    const h = await probeHarness();
    h.model.injectRefusal(/G38\.2/, 251);
    const from = await probed(h);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'refused', status: 251, text: 'Probe travel is too small' });
    expect(probeWrites(h, from)).toEqual(['G21', 'G91 G38.2 Z-5 F25', 'G90']);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    const g = await probeHarness();
    g.model.injectRefusal(/^G21$/, 13);
    await probed(g);
    expect(g.session.snapshot.probeZ.outcome).toEqual({ kind: 'refused', status: 13, text: 'The controller refused it (status 13).' });
  });

  it('Pause during the probe ends it in ALARM 250; Resume is never offered, no hold timeout, no zero', async () => {
    const h = await probeHarness({ plate: null });
    await passTouch(h);
    const from = startProbe(h);
    await runUntil(h, () => h.session.snapshot.probeZ.step === 'probing');
    await h.run(500);
    expect(h.session.feedhold()).toEqual({ allowed: true });
    expect(h.session.snapshot.motion).toBeNull();
    await untilResult(h);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'paused' });
    expect(h.session.snapshot.base).toBe('ALARM');
    expect(h.session.snapshot.fault).toBeNull();
    expect(writes(h).slice(from)).toContain('!');
    expect(h.session.request({ intent: 'resume' })).toMatchObject({ allowed: false });
  });

  it('Stop job during the probe is ^D: ALARM 207, no report, no zero; Spindle off is the same', async () => {
    for (const stop of ['stopJob', 'spindleOffNow'] as const) {
      const h = await probeHarness({ plate: null });
      await passTouch(h);
      const from = startProbe(h);
      await runUntil(h, () => h.session.snapshot.probeZ.step === 'probing');
      await h.run(300);
      expect(h.session[stop]()).toEqual({ allowed: true });
      await untilResult(h);
      expect(h.session.snapshot.probeZ.outcome, stop).toEqual({ kind: 'stopJob', status: 207 });
      expect(writes(h).slice(from), stop).toContain('\\x04');
      await h.run(1000);
      expect(h.session.snapshot.base).toBe('ALARM');
      expect(h.session.snapshot.fault).toBeNull();
    }
  });

  it('Pause or Stop job before the probe move went out: nothing moves, and the stop is the result', async () => {
    const h = await probeHarness();
    await passTouch(h);
    const from = startProbe(h);
    h.session.feedhold();
    await h.run(2000);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'paused' });
    expect(probeWrites(h, from)).toEqual(['!']);
    const k = await probeHarness();
    await passTouch(k);
    startProbe(k);
    k.session.stopJob();
    await k.run(2000);
    expect(k.session.snapshot.probeZ.outcome).toEqual({ kind: 'stopJob', status: 207 });
    // Its alarm is the probe's: no FAULT.
    expect(k.session.snapshot.fault).toBeNull();
    expect(k.session.snapshot.base).toBe('ALARM');
  });

  it('a lost link mid-probe', async () => {
    const h = await probeHarness({ plate: null });
    await passTouch(h);
    startProbe(h);
    await runUntil(h, () => h.session.snapshot.probeZ.step === 'probing');
    h.endpoint.disconnect();
    await h.run(200);
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'result', outcome: { kind: 'lost', during: 'probe' }, plateOut: true });
    expect(h.session.acknowledgeLost()).toEqual({ allowed: true });
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'result', plateOut: true, block: 'notConnected' });
    expect(h.session.request({ intent: 'probeZClose', step: 'plateOff' })).toEqual({ allowed: true });
    expect(h.session.snapshot.probeZ.plateOut).toBe(false);
  });

  it('no report in time: Z slower than the feed (the axis maximum) runs past the time limit; the late alarm is still the probe\'s', async () => {
    const h = await probeHarness({ plate: null, eeprom: { zfr: 10 } });
    await passTouch(h, { intent: 'probeZ', step: 'touch', thicknessMm: 5, depthMm: 5, feed: 25 });
    startProbe(h);
    await untilResult(h, 40_000);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'noReport' });
    await h.run(30_000);
    expect(h.session.snapshot.base).toBe('ALARM');
    expect(h.session.snapshot.fault).toBeNull();
  });

  it('a refused zero, and an unconfirmed one', async () => {
    const h = await probeHarness();
    h.model.injectRefusal(/^G10 L20/, 130);
    const from = await probed(h);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'zeroRefused', status: 130, text: 'The controller refused it (status 130).' });
    expect(probeWrites(h, from).at(-1)).toBe('G90');
    // The machine is moved between the zero and its read-back (in the EEPROM wait): the read-back disagrees.
    const u = await probeHarness();
    await passTouch(u);
    startProbe(u);
    await runUntil(u, () => u.session.state.probeZ.run?.zero === 'settle', 30_000, 1);
    u.model.setMachinePosition({ z: -10 });
    await untilResult(u);
    expect(u.session.snapshot.probeZ.outcome).toEqual({ kind: 'zeroUnconfirmed' });
  });

  it('Stop job pressed while the G10 zero is in flight: ^D, and no zero is claimed', async () => {
    const h = await probeHarness();
    await passTouch(h);
    const from = startProbe(h);
    // The zero has left the queue: it is being written or owed its answer.
    await runUntil(h, () => h.session.state.probeZ.run?.zero === 'line' && !h.session.state.queue.some((q) => q.line?.startsWith('G10') === true), 30_000, 1);
    expect(h.session.state.probeZ.step).toBe('zeroing');
    expect(h.session.stopJob()).toEqual({ allowed: true });
    await untilResult(h);
    expect(writes(h).slice(from)).toContain('\\x04');
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'zeroUnconfirmed' });
    expect(h.session.snapshot.fault).toBeNull();
  });

  it('Pause is allowed in every step from the touch test to the result, and `~` is never written', async () => {
    const h = await probeHarness();
    const from = writes(h).length;
    h.session.request(TOUCH);
    await h.run(300);
    expect(h.session.feedhold()).toEqual({ allowed: true });
    await passTouch(h);
    expect(h.session.feedhold()).toEqual({ allowed: true });
    await h.run(300);
    startProbe(h);
    expect(h.session.feedhold()).toEqual({ allowed: true });
    await untilResult(h);
    expect(h.session.snapshot.probeZ.outcome).toEqual({ kind: 'paused' });
    for (const step of ['probing', 'zeroing'] as const) {
      const p = await probeHarness();
      await passTouch(p);
      startProbe(p);
      await runUntil(p, () => p.session.snapshot.probeZ.step === step, 30_000, 1);
      expect(p.session.feedhold(), step).toEqual({ allowed: true });
      await untilResult(p);
      expect(p.session.request({ intent: 'resume' }), step).toMatchObject({ allowed: false });
      await p.run(2000);
      expect(writes(p).includes('~'), step).toBe(false);
      expect(p.session.snapshot.probeZ.outcome, step).not.toMatchObject({ kind: 'contactZeroSet' });
    }
    expect(h.session.feedhold()).toEqual({ allowed: true });
    await h.run(1000);
    expect(writes(h).slice(from).includes('~')).toBe(false);
  });

  it('while the plate is out Start job and Spindle on are refused; Pause, Stop job and Spindle off never are', async () => {
    const h = await probeHarness();
    await probed(h);
    expect(h.session.loadJob({ name: 'a.nc', text: 'G21 G90\nG1 X1 F300\nM30' })).toEqual({ allowed: true });
    await h.run(500);
    expect(h.session.startJob([], { unhomed: true, workZero: true, spindle: true })).toMatchObject({ allowed: false, reason: PLATE_OUT_TEXT });
    expect(h.session.request({ intent: 'spindleOn', output: 'spindle', direction: 'cw', rpm: 8000 })).toMatchObject({ allowed: false, reason: PLATE_OUT_TEXT });
    expect(h.session.request({ intent: 'spindleOn', output: 'mist' })).toEqual({ allowed: true });
    await h.run(300);
    for (const stop of [() => h.session.feedhold(), () => h.session.spindleOffNow(), () => h.session.stopJob()]) {
      expect(stop()).toEqual({ allowed: true });
      await h.run(3000);
    }
    // Lift Z is the ordinary jog, on the owner's press only.
    expect(h.session.request({ intent: 'jog', axes: { z: 1 }, distanceMm: 5, feed: 600 })).toEqual({ allowed: true });
    await h.run(3000);
    expect(h.session.request({ intent: 'probeZClose', step: 'plateOff' })).toEqual({ allowed: true });
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'closed', plateOut: false, outcome: { kind: 'contactZeroSet' } });
    expect(h.session.startJob([], { unhomed: true, workZero: true, spindle: true })).toEqual({ allowed: true });
  });

  it('cancel, plate off and retest are refused where they do not apply', async () => {
    const h = await probeHarness({ plate: null });
    const close = (step: 'cancel' | 'plateOff'): unknown => h.session.request({ intent: 'probeZClose', step });
    expect(close('cancel')).toMatchObject({ allowed: false, reason: 'There is nothing to cancel.' });
    expect(close('plateOff')).toEqual({ allowed: true });
    h.session.request(TOUCH);
    expect(close('plateOff')).toMatchObject({ allowed: false, reason: 'The touch test is still open.' });
    await passTouch(h);
    startProbe(h);
    expect(close('cancel')).toMatchObject({ allowed: false, reason: 'The probe is running.' });
    expect(close('plateOff')).toMatchObject({ allowed: false, reason: 'The probe is running.' });
    expect(h.session.request(TOUCH)).toMatchObject({ allowed: false, reason: 'The probe is running.' });
    expect(h.session.request({ intent: 'probeZ', step: 'retest' })).toMatchObject({ allowed: false });
    expect(h.session.request(START)).toMatchObject({ allowed: false });
    expect(h.session.request({ intent: 'probeZ', step: 'start', confirm: false } as unknown as SessionIntent)).toMatchObject({ allowed: false, reason: 'Starting the probe needs its confirmation (C39).' });
    expect(h.session.request({ intent: 'probeZClose', step: 'other' } as unknown as SessionIntent)).toMatchObject({ allowed: false, reason: 'Unknown Probe Z command.' });
  });
});
