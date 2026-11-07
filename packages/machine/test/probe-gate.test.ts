/**
 * T-S128 (Probe Z, SAFETY §4.5c, H90): the gate. Refused on TG, stock 449, READ_ONLY, an EN build below 450.02,
 * production, a job, a tool change, ALARM, spindle on, no single Z probe input, `zjh` unread, a G92 offset, no
 * G54-G59, and a stop distance over 0.25 mm; each with its reason. U: the pure gate over a real connected state;
 * M: the same refusals from sessions on the edge-next model.
 */
import { PHASE_1_RELEASE, PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMINGS, PROBE_LIMITS, findProbeInput, makePlan, probeBlock, probeCapable, probeInput, type SessionConfig, type SessionIntent, type SessionState } from '../src/index.ts';
import { JOBS_RELEASE_NO_FI, runUntil } from './jobHarness.ts';
import { EN_450_02_APPROVED, TOUCH, passTouch, probeHarness } from './probeHarness.ts';
import { harness } from './sessionHarness.ts';
import { PORT } from './simTransport.ts';

const CONFIG: SessionConfig = { release: JOBS_RELEASE_NO_FI, manifest: EN_450_02_APPROVED, timings: DEFAULT_TIMINGS };

function withSettings(s: SessionState, patch: Partial<SessionState['probeZ']['settings']>): SessionState {
  return { ...s, probeZ: { ...s.probeZ, settings: { ...s.probeZ.settings, ...patch } } };
}

const modes = (m: Readonly<Record<number, number>>): readonly number[] => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => m[i] ?? 0);

describe('T-S128 (U): the gate, first reason wins', () => {
  it('a connected, idle, approved 450.02 board with one Z min probe input may probe', async () => {
    const h = await probeHarness();
    const s = h.session.state;
    expect(probeBlock(s, CONFIG)).toBeNull();
    expect(probeCapable(s, CONFIG)).toBe(true);
    expect(probeInput(s.probeZ.settings)).toEqual({ index: 4, token: 'in5', label: 'Z min' });
    expect(h.session.snapshot.probeZ).toMatchObject({ block: null, step: 'closed', zjh: 40, system: 'G54', input: { token: 'in5', label: 'Z min', reading: null, activeLow: true }, plateOut: false });
  });

  it('refuses every connection, release, firmware and overlay case with its own block', async () => {
    const s = (await probeHarness()).session.state;
    const cases: readonly [Partial<SessionState>, SessionConfig, string][] = [
      [{ base: 'NOT_CONNECTED' }, CONFIG, 'notConnected'],
      [{ base: 'IDENTIFYING' }, CONFIG, 'notConnected'],
      [{ overlays: ['LOST'] }, CONFIG, 'lost'],
      [{}, { ...CONFIG, release: PHASE_1_RELEASE }, 'motionOff'],
      [{ dialect: { ...(s.dialect as NonNullable<SessionState['dialect']>), id: 'tinyg-440' } }, CONFIG, 'firmware'],
      [{ dialect: { ...(s.dialect as NonNullable<SessionState['dialect']>), id: 'tinyg-449-stock' } }, CONFIG, 'firmware'],
      [{ overlays: ['READ_ONLY'] }, CONFIG, 'firmware'],
      [{ classification: { ...(s.classification as NonNullable<SessionState['classification']>), mode: 'readOnly' } }, CONFIG, 'firmware'],
      [{ identity: { ...s.identity, fb: 450.01 } }, CONFIG, 'firmware'],
      [{ identity: {} }, CONFIG, 'firmware'],
      [{ overlays: ['FAULT'] }, CONFIG, 'stale'],
      [{ overlays: ['STALE'] }, CONFIG, 'stale'],
      [{ overlays: ['ORPHANED_MOTION'] }, CONFIG, 'moving'],
      [{ overlays: ['UNKNOWN'] }, CONFIG, 'unknown'],
      [{ base: 'CONNECTED_UNKNOWN' }, CONFIG, 'unknown'],
      [{ overlays: ['NEEDS_REVIEW'] }, CONFIG, 'needsReview'],
    ];
    for (const [patch, config, block] of cases) expect(probeBlock({ ...s, ...patch }, config), `${JSON.stringify(patch).slice(0, 60)} ${block}`).toBe(block);
  });

  it('refuses unread settings, no single Z input, an unread or too soft Z jerk', async () => {
    const s = (await probeHarness()).session.state;
    expect(probeBlock(withSettings(s, { modes: [null, 0, 0, 0, 4, 0, 0, 0] }), CONFIG)).toBe('settingsUnread');
    expect(probeBlock(withSettings(s, { prbp: null }), CONFIG)).toBe('settingsUnread');
    expect(probeBlock({ ...s, values: { ...s.values, g92: { value: null, status: 100, at: 0 } } }, CONFIG)).toBe('settingsUnread');
    expect(probeBlock({ ...s, values: { ...s.values, g92: { value: { x: 'a' }, status: 0, at: 0 } } }, CONFIG)).toBe('settingsUnread');
    expect(probeBlock(withSettings(s, { modes: modes({}) }), CONFIG)).toBe('noInput');
    expect(probeBlock(withSettings(s, { modes: modes({ 4: 4, 5: 4 }) }), CONFIG)).toBe('manyInputs');
    expect(probeBlock(withSettings(s, { modes: modes({ 4: 4, 6: 4 }) }), CONFIG)).toBe('manyInputs');
    expect(probeBlock(withSettings(s, { modes: modes({ 0: 4 }) }), CONFIG)).toBe('inputNotZ');
    expect(probeBlock(withSettings(s, { modes: modes({ 7: 4 }) }), CONFIG)).toBe('inputNotZ');
    expect(probeBlock(withSettings(s, { modes: modes({ 5: 4 }) }), CONFIG)).toBeNull();
    expect(findProbeInput(withSettings(s, { modes: modes({ 5: 4 }) }).probeZ.settings)).toEqual({ kind: 'one', index: 5 });
    expect(probeInput(withSettings(s, { modes: modes({}) }).probeZ.settings)).toBeNull();
    expect(probeBlock(withSettings(s, { zjh: null }), CONFIG)).toBe('jerkUnread');
    expect(probeBlock(withSettings(s, { zjh: 0 }), CONFIG)).toBe('jerkUnread');
    // At the slowest feed (10 mm/min) a Z jerk of 0.01 stops in about 0.32 mm: over the 0.25 mm limit.
    expect(probeBlock(withSettings(s, { zjh: 0.01 }), CONFIG)).toBe('stopOverLimit');
  });

  it('refuses alarm, a tool change, a job, homing, a hold, any other move, spindle on, G92 and no work system', async () => {
    const s = (await probeHarness()).session.state;
    const job = { phase: 'running' } as NonNullable<SessionState['job']>;
    const cases: readonly [Partial<SessionState>, string][] = [
      [{ base: 'ALARM' }, 'alarm'],
      [{ base: 'PROGRAM_PAUSED', job: { ...job, phase: 'toolChange' } }, 'toolChange'],
      [{ base: 'RUNNING', job }, 'job'],
      [{ base: 'HOMING' }, 'homing'],
      [{ base: 'HELD' }, 'held'],
      [{ base: 'JOGGING' }, 'moving'],
      [{ base: 'STOPPING_JOB' }, 'moving'],
      [{ motion: { op: 'change' } as NonNullable<SessionState['motion']> }, 'moving'],
      [{ live: { ...s.live, spe: 1 } }, 'spindleOn'],
      [{ live: { ...s.live, spc: 2 } }, 'spindleOn'],
      [{ values: { ...s.values, g92: { value: { x: 0, y: 0, z: 1.5 }, status: 0, at: 0 } } }, 'tempOffset'],
      [{ live: { ...s.live, coor: 0 } }, 'noWcs'],
    ];
    for (const [patch, block] of cases) expect(probeBlock({ ...s, ...patch }, CONFIG), block).toBe(block);
    // While its own probe runs, the probe's JOGGING base is not a reason.
    expect(probeBlock({ ...s, base: 'JOGGING', probeZ: { ...s.probeZ, step: 'probing' } }, CONFIG)).toBeNull();
  });

  it('the plan: presets plus a custom value up to the hard maximum, whole feeds, and the stop distance under its limit', () => {
    expect(makePlan(12.7, 5, 25, 40)).toMatchObject({ thicknessMm: 12.7, depthMm: 5, feed: 25, maxSeconds: 17 });
    const plan = makePlan(12.7, 5, 25, 40);
    expect(typeof plan !== 'string' && plan.stopMm).toBeCloseTo(0.0218, 4);
    expect(typeof plan !== 'string' && plan.zeroZ).toBeCloseTo(12.6782, 4);
    expect(makePlan(0.05, 5, 25, 40)).toBe('Plate thickness can be 0.1 to 50 mm.');
    expect(makePlan(50.1, 5, 25, 40)).toBe('Plate thickness can be 0.1 to 50 mm.');
    expect(makePlan(Number.NaN, 5, 25, 40)).toBe('Plate thickness can be 0.1 to 50 mm.');
    expect(makePlan('12', 5, 25, 40)).toBe('Plate thickness can be 0.1 to 50 mm.');
    expect(makePlan(12, 0.5, 25, 40)).toBe('Depth limit can be 1 to 15 mm.');
    expect(makePlan(12, 15.01, 25, 40)).toBe('Depth limit can be 1 to 15 mm.');
    expect(makePlan(12, 5, 9, 40)).toBe('Probe feed can be 10 to 100 mm/min, in whole numbers.');
    expect(makePlan(12, 5, 101, 40)).toBe('Probe feed can be 10 to 100 mm/min, in whole numbers.');
    expect(makePlan(12, 5, 25.5, 40)).toBe('Probe feed can be 10 to 100 mm/min, in whole numbers.');
    expect(makePlan(12, 5, 25, null)).toBe("Run can't work out how far Z will travel after contact: the board's Z jerk is not known.");
    expect(makePlan(12, 5, 100, 5)).toMatch(/^Z would travel about 0\.4\d mm after contact at this feed, more than the 0\.25 mm limit\. Choose a slower feed\.$/);
    for (const depth of PROBE_LIMITS.depthMm.presets) expect(typeof makePlan(1, depth, PROBE_LIMITS.feed.default, 40)).toBe('object');
    for (const feed of PROBE_LIMITS.feed.presets) expect(typeof makePlan(1, PROBE_LIMITS.depthMm.default, feed, 40)).toBe('object');
  });
});

describe('T-S128 (M): the session refuses Probe Z with its reason', () => {
  const touch = (h: { session: { request(r: SessionIntent): unknown } }): unknown => h.session.request(TOUCH);

  it('on TG, an unapproved (READ_ONLY) build, an EN build below 450.02 and production', async () => {
    const tg = harness('440', { device: { start: 'ready' }, session: { release: PHASE_2_RELEASE } });
    void tg.session.connect(PORT);
    await tg.run(3000);
    expect(touch(tg)).toMatchObject({ allowed: false });
    expect(tg.session.snapshot.probeZ.block).toBe('firmware');
    const ro = await probeHarness({ session: { manifest: { environment: 'staging', builds: [] } } });
    expect(ro.session.snapshot.overlays).toContain('READ_ONLY');
    expect(ro.session.snapshot.probeZ.block).toBe('firmware');
    const old = await probeHarness({ device: { build: { fb: 450.01, fv: 0.97, hv: 8, layout: 10002 } }, session: { manifest: { environment: 'staging', builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }] } } });
    expect(old.session.snapshot.classification?.mode).toBe('full');
    expect(touch(old)).toMatchObject({ allowed: false, reason: "This firmware can't probe. Probe Z needs an approved edge-next build (450.02 or later)." });
    // Production keeps Phase 1: the matrix refuses the motion kind before the session looks.
    const prod = await probeHarness({ session: { release: PHASE_1_RELEASE } });
    expect(touch(prod)).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
    expect(prod.session.snapshot.probeZ.block).toBe('motionOff');
  });

  it('with no single Z input, a soft Z jerk, or a feed whose stop distance is over the limit', async () => {
    expect(touch(await probeHarness({ eeprom: { zsn: 0 } }))).toMatchObject({ allowed: false, reason: 'This board has no probe input set.' });
    expect(touch(await probeHarness({ eeprom: { zsx: 4 } }))).toMatchObject({ allowed: false, reason: "This board has more than one probe input set, so Run won't guess." });
    expect(touch(await probeHarness({ eeprom: { zsn: 0, xsn: 4 } }))).toMatchObject({ allowed: false, reason: 'The probe input is not a Z input.' });
    expect(touch(await probeHarness({ eeprom: { zjh: 0 } }))).toMatchObject({ allowed: false, reason: "Run can't work out how far Z will travel after contact." });
    // zjh reads as a whole number (precision 0), so on a board the stop distance is refused per feed, at the plan.
    const h = await probeHarness({ eeprom: { zjh: 5 } });
    expect(h.session.request({ intent: 'probeZ', step: 'touch', thicknessMm: 10, depthMm: 5, feed: 100 })).toMatchObject({ allowed: false, reason: expect.stringMatching(/^Z would travel about 0\.\d\d mm after contact/) });
    expect(h.session.request({ intent: 'probeZ', step: 'touch', thicknessMm: 10, depthMm: 5, feed: 25 })).toEqual({ allowed: true });
  });

  it('with the spindle on, a G92 offset, in ALARM and during a job', async () => {
    const h = await probeHarness();
    expect(h.session.request({ intent: 'spindleOn', output: 'spindle', direction: 'cw', rpm: 8000 })).toEqual({ allowed: true });
    await h.run(500);
    expect(touch(h)).toMatchObject({ allowed: false, reason: 'The spindle is on.' });
    h.session.request({ intent: 'spindleOffNow', outputs: 'spindle' });
    await h.run(500);
    expect(h.session.snapshot.probeZ.block).toBeNull();
    // G92 Z0 two millimetres away from the work zero: an offset of 2 mm is in force.
    h.model.setMachinePosition({ z: 2 });
    await h.run(500);
    expect(h.session.request({ intent: 'tempOffset', axes: ['z'] })).toEqual({ allowed: true });
    await h.run(1000);
    expect(touch(h)).toMatchObject({ allowed: false, reason: 'A temporary offset (G92) is in force.' });
    h.session.request({ intent: 'tempOffset', clear: true });
    await h.run(1000);
    expect(h.session.snapshot.probeZ.block).toBeNull();
    h.model.injectLimitSwitch(5);
    await runUntil(h, () => h.session.snapshot.base === 'ALARM');
    // Outside a probe the alarm's `er` latches a FAULT as it always has (the matrix refuses motion first); the gate reads it as no trusted status.
    expect(touch(h)).toMatchObject({ allowed: false });
    expect(h.session.snapshot.probeZ.block).toBe('stale');

    const j = await probeHarness();
    expect(j.session.loadJob({ name: 'a.nc', text: 'G21 G90\nG1 X20 F300\nM30' })).toEqual({ allowed: true });
    await j.run(500);
    expect(j.session.startJob([], { unhomed: true, workZero: true, spindle: true })).toEqual({ allowed: true });
    await runUntil(j, () => j.session.snapshot.base === 'RUNNING');
    expect(touch(j)).toMatchObject({ allowed: false });
    expect(j.session.snapshot.probeZ.block).toBe('job');
  });

  it('a second touch test may replace the first, but never while the probe runs', async () => {
    const h = await probeHarness();
    await passTouch(h);
    expect(h.session.request({ ...TOUCH, depthMm: 3 } as SessionIntent)).toEqual({ allowed: true });
    expect(h.session.snapshot.probeZ).toMatchObject({ step: 'touch', plan: { depthMm: 3 } });
  });
});
