/**
 * T-S129 (Probe Z, SAFETY §4.5c "Touch test", H90 mitigation 2): only inactive → active → inactive passes; it lapses
 * after 2 minutes and on a position, state or input change; jog is refused from the touch test to the result; the
 * input is polled only in the touch, ready and probing steps.
 */
import { classifyLine } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { PROBE_LIMITS, TOUCH_IDLE_MS, reduce, touchPassed, touchStep, type ProbeTouch, type SessionIntent } from '../src/index.ts';
import { DEFAULT_TIMINGS } from '../src/index.ts';
import { JOBS_RELEASE_NO_FI, writes } from './jobHarness.ts';
import { EN_450_02_APPROVED, START, TOUCH, passTouch, probeHarness, startProbe, untilResult, type ProbeHarness } from './probeHarness.ts';

const NONE: ProbeTouch = { sawClear: false, sawTouching: false, sawReleased: false, problem: null };
const inputReads = (h: ProbeHarness, from = 0): number => writes(h).slice(from).filter((w) => w === '{"in5":null}').length;

describe('T-S129 (U): the marks fill in from readings only, in order', () => {
  it('inactive, active, inactive passes; nothing else does', () => {
    let t = NONE;
    for (const r of ['clear', 'clear', 'touching', 'touching', 'clear'] as const) t = touchStep(t, r);
    expect(t).toEqual({ sawClear: true, sawTouching: true, sawReleased: true, problem: null });
    expect(touchPassed(t)).toBe(true);
    expect(touchStep(t, 'touching')).toBe(t);
    expect(touchStep(NONE, 'touching')).toEqual({ ...NONE, problem: 'startedTouching' });
    expect(touchStep({ ...NONE, problem: 'noChange' }, 'clear')).toEqual({ ...NONE, problem: 'noChange' });
    for (const r of [null, 'disabled'] as const) expect(touchStep(NONE, r)).toBe(NONE);
    const clear = touchStep(NONE, 'clear');
    expect(touchStep(clear, 'clear')).toBe(clear);
    const touching = touchStep(clear, 'touching');
    expect(touchStep(touching, 'touching')).toBe(touching);
    expect(touchPassed(touching)).toBe(false);
  });
});

describe('T-S129 (M): the touch test on the model', () => {
  it('passes from the live input, with nothing moved, and polls the input only from the touch test on', async () => {
    const h = await probeHarness();
    expect(inputReads(h)).toBe(0);
    const from = writes(h).length;
    expect(h.session.request(TOUCH)).toEqual({ allowed: true });
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'touch', plateOut: true, plan: { depthMm: 5, feed: 25 } });
    await h.run(600);
    // The probe settings are read again first; then the input every 150 ms.
    // `unit` just before `zjh`, which the board prints in it (OD-19).
    expect(writes(h).slice(from, from + 11)).toEqual(['{"xsn":null}', '{"xsx":null}', '{"ysn":null}', '{"ysx":null}', '{"zsn":null}', '{"zsx":null}', '{"asn":null}', '{"asx":null}', '{"prbp":null}', '{"unit":null}', '{"zjh":null}']);
    expect(h.session.snapshot.probeZ.touch).toEqual({ ...NONE, sawClear: true });
    expect(h.session.snapshot.probeZ.input?.reading).toBe('clear');
    const polled = inputReads(h, from);
    await h.run(1500);
    expect(inputReads(h, from) - polled).toBeGreaterThanOrEqual(8);
    h.model.setProbeTouch(true);
    await h.run(300);
    expect(h.session.snapshot.probeZ.touch).toEqual({ ...NONE, sawClear: true, sawTouching: true });
    expect(h.session.snapshot.probeZ.input?.reading).toBe('touching');
    h.model.setProbeTouch(false);
    await h.run(300);
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'ready', touch: { sawClear: true, sawTouching: true, sawReleased: true, problem: null } });
    expect(writes(h).slice(from).filter((w) => !w.startsWith('{"'))).toEqual([]);
    expect(h.device.snapshot().position[2]).toBe(0);
    // Cancelled: the poll stops; the plate is still out.
    expect(h.session.request({ intent: 'probeZClose', step: 'cancel' })).toEqual({ allowed: true });
    const after = inputReads(h);
    await h.run(2000);
    expect(inputReads(h)).toBe(after);
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'result', outcome: { kind: 'cancelled' }, plateOut: true });
  });

  it('touching before anything is touched is a problem, and the poll stops until the test is repeated', async () => {
    const h = await probeHarness();
    h.model.setProbeTouch(true);
    h.session.request(TOUCH);
    await h.run(800);
    expect(h.session.snapshot.probeZ.touch.problem).toBe('startedTouching');
    const n = inputReads(h);
    await h.run(1000);
    expect(inputReads(h)).toBe(n);
    h.model.setProbeTouch(false);
    expect(h.session.request({ intent: 'probeZ', step: 'retest' })).toEqual({ allowed: true });
    await h.run(400);
    expect(h.session.snapshot.probeZ.touch).toEqual({ ...NONE, sawClear: true });
  });

  it('a lead that is off on a normally closed plate reads touching from the start (the broken lead the test catches)', async () => {
    const h = await probeHarness({ eeprom: { prbp: 1 } });
    h.model.setProbeLead(false);
    h.session.request(TOUCH);
    await h.run(800);
    expect(h.session.snapshot.probeZ).toMatchObject({ input: { activeLow: false, reading: 'touching' }, touch: { problem: 'startedTouching' } });
  });

  it('no change for a minute is a problem; a pass lapses after 2 minutes back to the touch test', async () => {
    const h = await probeHarness();
    h.session.request(TOUCH);
    await h.run(TOUCH_IDLE_MS + 1000);
    expect(h.session.snapshot.probeZ.touch.problem).toBe('noChange');
    h.session.request({ intent: 'probeZ', step: 'retest' });
    await h.run(400);
    h.model.setProbeTouch(true);
    await h.run(400);
    h.model.setProbeTouch(false);
    await h.run(400);
    expect(h.session.snapshot.probeZ.step).toBe('ready');
    await h.run(PROBE_LIMITS.touchValidMs + 500);
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'touch', touch: { problem: 'timedOut' } });
    expect(h.session.request(START)).toMatchObject({ allowed: false, reason: 'The touch test has not passed.' });
  });

  it('a position change, a state change or an input configuration change lapses it', async () => {
    const h = await probeHarness();
    await passTouch(h);
    h.model.setMachinePosition({ z: -0.5 });
    await h.run(600);
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'touch', touch: { sawTouching: false } });
    // A state change: the reducer, given a report that the board's state changed.
    await passTouch(h);
    const s = h.session.state;
    const config = { release: JOBS_RELEASE_NO_FI, manifest: EN_450_02_APPROVED, timings: DEFAULT_TIMINGS };
    const held = reduce(config, s, { type: 'inbound', epoch: s.epoch, at: 0, event: classifyLine('{"sr":{"stat":6,"hold":6}}') });
    expect(held.state.probeZ).toMatchObject({ step: 'touch', touch: { sawClear: false, sawTouching: false } });
    // An input configuration change (the probe settings read again with another polarity).
    const other = reduce(config, s, { type: 'intent', at: 0, request: { intent: 'probeZ', step: 'retest' } });
    const changed = { ...other.state, probeZ: { ...other.state.probeZ, step: 'ready' as const, settings: { ...other.state.probeZ.settings, prbp: 1 } } };
    const lapsed = reduce(config, changed, { type: 'intent', at: 0, request: { intent: 'read', tokens: ['stat'] } });
    expect(lapsed.state.probeZ.step).toBe('touch');
  });

  it('jog, and every other move or change, is refused from the touch test until the result; jog is back at the result', async () => {
    const h = await probeHarness();
    const jog: SessionIntent = { intent: 'jog', axes: { z: 1 }, distanceMm: 5, feed: 600 };
    h.session.request(TOUCH);
    expect(h.session.request(jog)).toMatchObject({ allowed: false, reason: 'Jog is off during the touch test and the probe: a hand may be at the tool.' });
    for (const r of [{ intent: 'goToZero', axes: ['z'], safeZ: 0 }, { intent: 'setWorkZero', axes: ['z'] }, { intent: 'tempOffset', axes: ['z'] }] as SessionIntent[]) {
      expect(h.session.request(r), r.intent).toMatchObject({ allowed: false, reason: 'Probe Z is in progress.' });
    }
    await passTouch(h);
    expect(h.session.request(jog)).toMatchObject({ allowed: false });
    startProbe(h);
    expect(h.session.request(jog)).toMatchObject({ allowed: false });
    await untilResult(h);
    const n = inputReads(h);
    await h.run(2000);
    expect(inputReads(h)).toBe(n);
    expect(h.session.request(jog)).toEqual({ allowed: true });
  });

  it('a block that arrives during the test drops the pass; the test starts again once it clears', async () => {
    const h = await probeHarness();
    await passTouch(h);
    const s = h.session.state;
    const config = { release: JOBS_RELEASE_NO_FI, manifest: EN_450_02_APPROVED, timings: DEFAULT_TIMINGS };
    const stale = reduce(config, { ...s, overlays: ['STALE'] }, { type: 'intent', at: 0, request: { intent: 'read', tokens: ['stat'] } });
    expect(stale.state.probeZ).toMatchObject({ block: 'stale', step: 'touch', anchor: null });
    const back = reduce(config, { ...stale.state, overlays: [], timers: {} }, { type: 'intent', at: 0, request: { intent: 'read', tokens: ['stat'] } });
    expect(back.state.probeZ.block).toBeNull();
    expect(back.state.probeZ.anchor).not.toBeNull();
    expect(back.effects.some((e) => e.kind === 'armTimer' && e.id === 'probe')).toBe(true);
  });
});
