/**
 * T-S137. The travel check (OD-24, owner 2026-11-08: "Block when homed, warn when not"; SAFETY H3): every modelled
 * machine-coordinate end point and arc extent against each axis's soft limits (the model board: X and Y 0..150 mm,
 * Z 0..75 mm, A, B and C off). Homed by a cycle this connection saw: a move past travel blocks. Otherwise, or with a
 * limit not read: C40 before Start. Resume after a Z re-zero at a tool change checks the rest of the job again.
 */
import type { SanitizeResult } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { onJobResume, sanitizeLive, type JobLayerTx } from '../src/session/job.ts';
import { travelOf, withTravel } from '../src/session/jobTravel.ts';
import { checkTravel } from '../src/session/travelCheck.ts';
import { axisHomedHere, noteHomed, noteSetByHand } from '../src/session/homedAxes.ts';
import { DEFAULT_TIMINGS, type JobReportSummary, type SessionState } from '../src/session/types.ts';
import { CONFIRM, confirmFor, EN_APPROVED, JOBS_RELEASE, jobHarness, load, runUntil } from './jobHarness.ts';
import { harness } from './sessionHarness.ts';
import { PORT } from './simTransport.ts';

const CONFIG = { release: JOBS_RELEASE, manifest: EN_APPROVED, timings: DEFAULT_TIMINGS };

async function loaded(text: string): Promise<SessionState> {
  const h = await jobHarness({ rxm: 1 });
  await load(h, text);
  return h.session.state;
}

/** As if this connection saw a homing cycle home X, Y and Z (`hom` read back; homedAxes.ts, review S2). */
function homed(s: SessionState, axes: readonly ('x' | 'y' | 'z')[] = ['x', 'y', 'z']): SessionState {
  const hom = { value: { x: axes.includes('x') ? 1 : 0, y: axes.includes('y') ? 1 : 0, z: axes.includes('z') ? 1 : 0, a: 0, b: 0, c: 0 }, status: 0, at: 1 };
  return { ...s, live: { ...s.live, home: 1 }, values: { ...s.values, hom }, notices: { ...s.notices, position: { by: 'homing', at: 1 }, homedAxes: [...axes] } };
}

function check(s: SessionState, text: string): ReturnType<typeof checkTravel> {
  return travelOf(s, sanitizeLive(s, text, false));
}

const PAST_X = 'G21 G90\nG1 X200 F600\nM30';

describe('the travel check at Start', () => {
  it('homed by a cycle, a file past +X travel: blocked, the line, the axis, the machine coordinate and the limit named', async () => {
    const s = homed(await loaded(PAST_X));
    expect(axisHomedHere(s, 'X')).toBe(true);
    const travel = check(s, PAST_X);
    expect(travel).toEqual({ block: { kind: 'outside', line: 2, text: 'line 2: X would reach machine 200 mm, beyond its travel limit of 150 mm' }, confirm: null });
    const report = withTravel({ blocked: false, counts: { block: 0, warn: 0, change: 0, info: 0 }, blocks: [] } as unknown as JobReportSummary, travel);
    expect(report).toMatchObject({ blocked: true, counts: { block: 1 }, blocks: [{ line: 2, message: 'X would reach machine 200 mm, beyond its travel limit of 150 mm' }] });
  });

  it('the same file on a board whose position was set by hand (or before this connection): C40, not a block', async () => {
    const s = await loaded(PAST_X);
    const hand = { ...s, live: { ...s.live, home: 1 }, notices: { ...s.notices, position: { by: 'hand' as const, at: 1 } } };
    for (const state of [hand, { ...hand, notices: { ...hand.notices, position: undefined } } as unknown as SessionState]) {
      expect(check(state, PAST_X)).toEqual({ block: null, confirm: { kind: 'outside', line: 2, text: 'line 2: X would reach machine 200 mm, beyond its travel limit of 150 mm, and the X position was not set by a homing cycle in this connection', past: { axis: 'X', reach: 200, limit: 150, unit: 'mm', more: 0 } } });
    }
  });

  it('C41 (owner, 2026-11-09): the first move past travel is named and the moves past travel after it are counted, on any axis', async () => {
    const text = 'G21 G90\nG1 X200 F600\nG1 Y-3.3333\nG1 X210 Y160\nM30';
    const s = await loaded(text);
    const hand = { ...s, live: { ...s.live, home: 1 }, notices: { ...s.notices, position: { by: 'hand' as const, at: 1 } } };
    // Line 3 still sits at X 200 and goes below Y 0; line 4 passes X and Y: four more.
    expect(check(hand, text).confirm).toMatchObject({ line: 2, past: { axis: 'X', reach: 200, limit: 150, unit: 'mm', more: 4 } });
  });

  it('on the session: Start is refused until C40 is confirmed, then goes', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, PAST_X);
    expect(h.session.snapshot.job?.report?.travel?.confirm?.line).toBe(2);
    expect(h.session.startJob([], { ...CONFIRM, travel: null })).toMatchObject({ allowed: false, reason: expect.stringContaining('Confirm C40 to start') });
    // S3: a tick given for another finding does not count.
    expect(h.session.startJob([], { ...CONFIRM, travel: 'line 9: Y would reach machine 999 mm' })).toMatchObject({ allowed: false, reason: expect.stringContaining('Confirm C40 to start') });
    expect(h.session.startJob([], confirmFor(h))).toEqual({ allowed: true });
  });

  it('inside travel passes with nothing to confirm', async () => {
    const text = 'G21 G90\nG0 X10 Y10 Z5\nG1 X140 Y140 F600\nM30';
    expect(check(homed(await loaded(text)), text)).toEqual({ block: null, confirm: null });
  });

  it('an arc whose ends are inside but whose circle bulges past +X travel', async () => {
    const text = 'G21 G90 G17\nG0 X140 Y60\nG3 X140 Y84 I0 J12 F600\nM30';
    expect(check(homed(await loaded(text)), text).block).toMatchObject({ line: 3, text: 'line 3: X would reach machine 152 mm, beyond its travel limit of 150 mm' });
    // The same circle the other way round stays inside (it bulges to X 128).
    const cw = 'G21 G90 G17\nG0 X140 Y60\nG2 X140 Y84 I0 J12 F600\nM30';
    expect(check(homed(await loaded(cw)), cw)).toEqual({ block: null, confirm: null });
  });

  it('a G53 move above Z travel, and a G92 offset that puts a later move past X travel', async () => {
    const g53 = 'G21 G90\nG53 G0 Z80\nM30';
    expect(check(homed(await loaded(g53)), g53).block).toMatchObject({ line: 2, text: 'line 2: Z would reach machine 80 mm, beyond its travel limit of 75 mm' });
    const g92 = 'G21 G90\nG0 X100\nG92 X0\nG1 X60 F600\nM30';
    expect(check(homed(await loaded(g92)), g92).block).toMatchObject({ line: 4, text: 'line 4: X would reach machine 160 mm, beyond its travel limit of 150 mm' });
  });

  it('a limit or a position not read is never passed: C40 says what could not be checked', async () => {
    const s = homed(await loaded(PAST_X));
    const { tm: _tm, tn: _tn, ...x } = s.values['x']?.value as Record<string, number>;
    const rest = { ...s.values, x: { value: x, status: 0, at: 0 } };
    expect(check({ ...s, values: rest }, 'G21 G90\nG1 X10 F600\nM30').confirm).toEqual({ kind: 'unchecked', line: null, text: 'the travel limits of X were not read' });
    // N4: limits not read on an axis the file never moves are not asked about.
    expect(check({ ...s, values: rest }, 'G21 G90\nG1 Y10 F600\nM30').confirm).toBeNull();
    // A line whose model lost an axis's machine position (the sanitiser itself blocks a move it cannot model).
    const lost = [{ line: 7, extent: { X: null, Y: { min: 0, max: 10 }, Z: { min: 0, max: 0 }, A: null, B: null, C: null } }];
    expect(checkTravel(s, lost).confirm).toEqual({ kind: 'unchecked', line: 7, text: 'line 7: the machine position of X is not known' });
    const noMpo = { ...s, values: { ...s.values, mpo: { value: null, status: 100, at: 0 } } };
    const r = sanitizeLive(noMpo, 'G21 G90\nG1 Y10 F600\nM30', false);
    expect(r.report.blocked || checkTravel(noMpo, r.extents ?? []).confirm !== null).toBe(true);
    // Limits printed in inches (G20) are converted.
    const inches = { ...s, values: { ...s.values, unit: { value: 0, status: 0, at: 0 }, x: { value: { ...(s.values['x']?.value as object), tm: 4, tn: 0 }, status: 0, at: 0 } } };
    const at = (max: number) => [{ line: 9, extent: { X: { min: 0, max }, Y: { min: 0, max: 0 }, Z: { min: 0, max: 0 }, A: null, B: null, C: null } }];
    expect(checkTravel(inches, at(100)).block).toBeNull(); // 4 in is 101.6 mm
    expect(checkTravel(inches, at(110)).block?.text).toBe('line 9: X would reach machine 110 mm, beyond its travel limit of 101.6 mm');
  });
});

describe('S2: known per axis, from the homing cycles this connection saw', () => {
  it('a Z-only homing does not make X known: X past travel asks C40; a G28.3 makes an axis unknown again', async () => {
    const s = await loaded(PAST_X);
    const zOnly = homed(s, ['z']);
    expect(axisHomedHere(zOnly, 'X')).toBe(false);
    expect(check(zOnly, PAST_X)).toMatchObject({ block: null, confirm: { kind: 'outside', line: 2 } });
    // The cycles and the hand-set position through the session's own notes.
    const start: SessionState = { ...s, live: { ...s.live, home: 1 }, values: { ...s.values, hom: { value: { x: 1, y: 0, z: 1, a: 0, b: 0, c: 0 }, status: 0, at: 1 } } };
    const t: { s: SessionState; set(patch: Partial<SessionState>): void } = { s: start, set(patch) { t.s = { ...t.s, ...patch }; } };
    noteHomed(t, ['x', 'y', 'z']);
    expect(t.s.notices.homedAxes).toEqual(['x', 'z']); // Y did not read back homed
    noteSetByHand(t, ['x']);
    expect(t.s.notices.homedAxes).toEqual(['z']);
    expect(axisHomedHere({ ...t.s, overlays: ['UNKNOWN'] }, 'Z')).toBe(false);
    expect(axisHomedHere({ ...t.s, values: { ...t.s.values, hom: { value: null, status: 100, at: 2 } } }, 'Z')).toBe(false);
    expect(axisHomedHere(t.s, 'Z')).toBe(true);
  });
});

describe('the edges of the check', () => {
  it('no dialect: nothing to check; units not read: the linear limits are not known; past and unknown both found', async () => {
    const s = homed(await loaded(PAST_X));
    const ext = (x: { min: number; max: number } | null) => [{ line: 2, extent: { X: x, Y: { min: 0, max: 0 }, Z: { min: 0, max: 0 }, A: null, B: null, C: null } }];
    expect(checkTravel({ ...s, dialect: null }, ext({ min: 0, max: 999 }))).toEqual({ block: null, confirm: null });
    expect(checkTravel({ ...s, values: { ...s.values, unit: { value: null, status: 100, at: 0 } } }, ext({ min: 0, max: 1 })).confirm).toEqual({ kind: 'unchecked', line: null, text: 'the travel limits of X were not read' });
    // A move past X travel with another axis lost on a later line: the block wins with the position known.
    const both = [...ext({ min: 0, max: 200 }), { line: 3, extent: { X: { min: 0, max: 1 }, Y: null, Z: { min: 0, max: 0 }, A: null, B: null, C: null } }, ...ext({ min: 0, max: 1 })];
    expect(checkTravel(s, both).block?.line).toBe(2);
    // A side at or below -1 000 000 is off; tn = tm turns the axis off.
    const open = { ...s, values: { ...s.values, x: { value: { ...(s.values['x']?.value as object), tn: -1000000, tm: 150 }, status: 0, at: 0 } } };
    expect(checkTravel(open, ext({ min: -500, max: 10 }))).toEqual({ block: null, confirm: null });
    const openTop = { ...s, values: { ...s.values, x: { value: { ...(s.values['x']?.value as object), tn: 0, tm: -1000000 }, status: 0, at: 0 } } };
    expect(checkTravel(openTop, ext({ min: 0, max: 900 }))).toEqual({ block: null, confirm: null });
    // A rotary axis with limits is checked in degrees.
    const rotary = { ...s, values: { ...s.values, a: { value: { ...(s.values['a']?.value as object), tn: -90, tm: 90 }, status: 0, at: 0 } } };
    const turn = [{ line: 5, extent: { X: { min: 0, max: 0 }, Y: { min: 0, max: 0 }, Z: { min: 0, max: 0 }, A: { min: 0, max: 120 }, B: null, C: null } }];
    // A is never homed by a cycle here, so its finding asks C40.
    expect(checkTravel(rotary, turn).confirm?.text).toBe('line 5: A would reach machine 120 °, beyond its travel limit of 90 °, and the A position was not set by a homing cycle in this connection');
  });

  it('Start checks the travel again with the board as read then: a finding that appears only then ends the start (no C40 given)', async () => {
    const h = await jobHarness({ rxm: 1 });
    const text = 'G21 G91\nG1 X100 F600\nM30';
    await load(h, text);
    expect(h.session.snapshot.job?.report?.travel).toEqual({ block: null, confirm: null });
    // The machine moves 60 mm in X before Start: the incremental file now reaches X 160.
    h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 60, feed: 3000 });
    await runUntil(h, () => h.session.state.motion === null, 20_000);
    expect(h.session.startJob([], { ...CONFIRM, travel: null })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'failed', 10_000);
    expect(h.session.snapshot.job?.message).toContain('Confirm C40 to start');
    expect(h.session.snapshot.job?.message).toContain('X would reach machine 160 mm');
  });
});

describe('Resume after a Z re-zero at a tool change', () => {
  const TC = 'G21 G90\nG1 Z10 F600\nT1 M6\nG1 Z1\nM30';

  async function atToolChange(): Promise<SessionState> {
    const h = await jobHarness({ rxm: 1 });
    await load(h, TC);
    h.session.startJob([], confirmFor(h));
    expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange', 20_000)).toBe(true);
    return h.session.state;
  }

  function rezeroed(s: SessionState, z: number): JobLayerTx {
    const at = (s.job?.toolChange?.stoppedAt ?? 0) + 1;
    const g54 = { value: { ...(s.values['g54']?.value as object), z }, status: 0, at };
    const state = homed({ ...s, values: { ...s.values, g54, ofs: { ...g54 } } });
    const t: JobLayerTx = { s: state, config: CONFIG, set: (patch) => (t.s = { ...t.s, ...patch }), emit: () => {}, arm: () => {}, cancel: () => {} };
    return t;
  }

  it('refused when the new Z offset takes a later line below Z travel; Stop job is the way out', async () => {
    const t = rezeroed(await atToolChange(), -5);
    expect(onJobResume(t, { intent: 'resume' }, 99_999)).toEqual({
      allowed: false,
      reason: 'With the new Z zero, line 4: Z would reach machine -4 mm, beyond its travel limit of 0 mm. Re-zero Z again, or stop the job.',
      remedy: 'Use Stop job to end the job.',
      citation: expect.any(String),
    });
    expect(t.s.job?.phase).toBe('toolChange');
  });

  it('allowed when the rest of the job stays inside the travel', async () => {
    const t = rezeroed(await atToolChange(), 2);
    expect(onJobResume(t, { intent: 'resume' }, 99_999)).toEqual({ allowed: true });
  });

  it('not re-zeroed: nothing to check again; position not known: allowed with the finding said', async () => {
    const s0 = await atToolChange();
    const { g59: _g59, ...values } = s0.values; // an offset never read counts as unchanged
    const s = { ...s0, values };
    const t: JobLayerTx = { s, config: CONFIG, set: (patch) => (t.s = { ...t.s, ...patch }), emit: () => {}, arm: () => {}, cancel: () => {} };
    expect(onJobResume(t, { intent: 'resume' }, 99_999)).toEqual({ allowed: true });
    const hand = rezeroed(s, -5);
    // C40 was confirmed at Start (for whatever it showed then).
    hand.s = { ...hand.s, notices: { ...hand.s.notices, position: { by: 'hand', at: 1 }, homedAxes: [] }, job: { ...(hand.s.job as NonNullable<SessionState['job']>), travelConfirmed: 'line 9: …' } };
    expect(onJobResume(hand, { intent: 'resume' }, 99_999)).toEqual({ allowed: true });
    expect(hand.s.job?.events.at(-2)?.text ?? hand.s.job?.events.at(-1)?.text).toBeDefined();
    expect(hand.s.job?.events.some((e) => e.text.startsWith('With the new Z zero, line 4: Z would reach machine -4 mm'))).toBe(true);
  });

  /** The job's Start values with `patch` applied (the Resume re-check replays from them, review M1). */
  function startValues(t: JobLayerTx, patch: (v: SessionState['values']) => SessionState['values']): void {
    const job = t.s.job as NonNullable<SessionState['job']>;
    t.s = { ...t.s, job: { ...job, startValues: patch(job.startValues as SessionState['values']) } };
  }

  it('refused when the units changed since the job was checked, or a value it uses is not read', async () => {
    const s = await atToolChange();
    const units = rezeroed(s, -5);
    startValues(units, (v) => ({ ...v, unit: { value: 0, status: 0, at: 0 } }));
    expect(onJobResume(units, { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: expect.stringContaining('other units') });
    // The Z group's limits not read (its axis mode still known): the travel cannot be checked.
    const unread = rezeroed(s, 2);
    startValues(unread, (v) => {
      const { tm: _tm, tn: _tn, ...z } = v['z']?.value as Record<string, number>;
      return { ...v, z: { value: z, status: 0, at: 0 } };
    });
    expect(onJobResume(unread, { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: 'With the new Z zero the rest of the job cannot be checked against the travel: the travel limits of Z were not read.' });
  });

  it('M2: a refused offset read-back after the re-zero refuses Resume (the re-check cannot run), never passes it', async () => {
    const s = await atToolChange();
    const at = (s.job?.toolChange?.stoppedAt ?? 0) + 1;
    const t = rezeroed(s, 2);
    t.s = { ...t.s, values: { ...t.s.values, g54: { value: null, status: 100, at }, ofs: { value: null, status: 100, at } } };
    expect(onJobResume(t, { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: expect.stringContaining('the G54 Z offset was not read') });
    // A re-check that blocks a line (here: the Z group was not read, so Z cannot be modelled) refuses too.
    const blocked = rezeroed(s, 2);
    startValues(blocked, ({ z: _z, ...rest }) => rest);
    const composed = onJobResume(blocked, { intent: 'resume' }, 99_999) as { reason: string };
    expect(composed.reason).not.toMatch(/\.\.|: [A-Z]|Fix:/);
    expect(onJobResume(blocked, { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: 'With the new Z zero the rest of the job cannot be checked again: line 2: the axis mode (zam) of Z is not known, so a move on Z cannot be modelled.' });
  });

  it('the replay refuses whatever it cannot do exactly', async () => {
    const s = await atToolChange();
    const base = rezeroed(s, 2);
    const variant = (patch: (t: JobLayerTx) => void): string => {
      const t: JobLayerTx = { ...base, s: base.s };
      t.set = (p) => (t.s = { ...t.s, ...p });
      patch(t);
      const d = onJobResume(t, { intent: 'resume' }, 99_999);
      return d.allowed ? 'allowed' : (d as { reason: string }).reason;
    };
    const job = (t: JobLayerTx) => t.s.job as NonNullable<SessionState['job']>;
    expect(variant((t) => (t.s = { ...t.s, live: { ...t.s.live, coor: undefined } as never }))).toContain('the active coordinate system is not known');
    expect(variant((t) => (t.s = { ...t.s, job: { ...job(t), startValues: undefined } as never }))).toContain('the active coordinate system is not known');
    // Only G92 read again (not the active system's offset): not exact, refused.
    expect(variant((t) => (t.s = { ...t.s, values: { ...t.s.values, g54: { ...(s.values['g54'] as NonNullable<SessionState['values'][string]>) } } }))).toContain('the G54 offset was not read again after the change');
    expect(variant((t) => (t.s = { ...t.s, values: { ...t.s.values, g54: { value: { x: 0 }, status: 0, at: 1e12 } } }))).toContain('the G54 Z offset was not read');
    expect(variant((t) => (t.s = { ...t.s, job: { ...job(t), startValues: { ...job(t).startValues, ofs: { value: 7, status: 0, at: 0 } } } }))).toContain('the total offset was not read at Start');
    const { hom: _hom, ...noHom } = base.s.values;
    expect(variant((t) => (t.s = { ...t.s, values: noHom }))).toBe('allowed');
  });

  it('S1: position not known, no C40 at Start, a re-zero that puts a later line past travel: refused', async () => {
    const s = await atToolChange();
    const t = rezeroed(s, -5);
    const { travelConfirmed: _c, ...job } = t.s.job as NonNullable<SessionState['job']>;
    t.s = { ...t.s, notices: { ...t.s.notices, position: { by: 'hand', at: 1 }, homedAxes: [] }, job };
    expect(onJobResume(t, { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: expect.stringContaining('C40 was not confirmed at Start') });
  });
});

describe('M1: the Resume re-check replays from the values read at Start', () => {
  async function leftIn(lines: readonly string[], text: string): Promise<SessionState> {
    const h = harness('en', { device: { start: 'ready', rxm: 1 }, session: { manifest: EN_APPROVED, release: JOBS_RELEASE } });
    for (const line of lines) for (const b of new TextEncoder().encode(`${line}\n`)) h.device.receive(b, false);
    await h.run(500);
    void h.session.connect(PORT);
    await h.run(3000);
    await load(h, text);
    h.session.startJob([], confirmFor(h));
    expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange', 20_000)).toBe(true);
    return h.session.state;
  }

  function rezeroOn(s: SessionState, token: string, z: number): JobLayerTx {
    const at = (s.job?.toolChange?.stoppedAt ?? 0) + 1;
    const g = { value: { ...(s.values[token]?.value as object), z }, status: 0, at };
    const state = homed({ ...s, values: { ...s.values, [token]: g, ofs: { value: { ...(s.values['ofs']?.value as object), z }, status: 0, at } } });
    const t: JobLayerTx = { s: state, config: CONFIG, set: (patch) => (t.s = { ...t.s, ...patch }), emit: () => {}, arm: () => {}, cancel: () => {} };
    return t;
  }

  it('a file that switches to G55 before the change, re-zeroed on G55 below Z travel: refused (no false tool offset)', async () => {
    const s = await leftIn(['G10 L2 P1 Z-20', 'G10 L2 P2 Z0'], 'G21 G90\nG55\nG1 Z10 F600\nT1 M6\nG1 Z1\nM30');
    expect(s.live.coor).toBe(2);
    const t = rezeroOn(s, 'g55', -5);
    expect(onJobResume(t, { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: 'With the new Z zero, line 5: Z would reach machine -4 mm, beyond its travel limit of 0 mm. Re-zero Z again, or stop the job.' });
    expect(onJobResume(rezeroOn(s, 'g55', 2), { intent: 'resume' }, 99_999)).toEqual({ allowed: true });
  });

  it('a file that sets the re-zeroed system\'s offset before the change: the re-check cannot replay it, refused', async () => {
    for (const set of ['G10 L2 P1 Z5', 'G10 L20 P1 Z5']) {
      const s = await leftIn([], `G21 G90\n${set}\nG1 Z10 F600\nT1 M6\nG1 Z1\nM30`);
      expect(onJobResume(rezeroOn(s, 'g54', -5), { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: 'The work offsets changed at the tool change and the rest of the job cannot be checked again: line 2 of the file sets the G54 offset before the tool change.' });
    }
    // Another system's offset does not touch G54.
    const other = await leftIn([], 'G21 G90\nG10 L2 P2 Z5\nG1 Z10 F600\nT1 M6\nG1 Z1\nM30');
    expect(onJobResume(rezeroOn(other, 'g54', 2), { intent: 'resume' }, 99_999)).toEqual({ allowed: true });
    // P0 (the active system) is refused by the sanitiser before a job runs; the replay still reads it as the active
    // system, tracked through G54..G59, if it ever got there.
    const t = rezeroOn(other, 'g54', 2);
    const job = t.s.job as NonNullable<SessionState['job']>;
    const withBody = (bodies: readonly string[]) => ({ ...t.s, job: { ...job, lines: [...bodies.map((body, i) => ({ ...(job.lines[0] as (typeof job.lines)[number]), body, sourceLine: i + 2 })), ...job.lines.slice(job.toolChange?.index ?? 0)], toolChange: { ...(job.toolChange as NonNullable<typeof job.toolChange>), index: bodies.length } } });
    const p0 = { ...t, s: withBody(['G10 L2 P0 Z5']) };
    expect(onJobResume(p0, { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: expect.stringContaining('line 2 of the file sets the G54 offset') });
    const p0g55 = { ...t, s: withBody(['G55', 'G10 L2 P0 Z5', 'G54']) };
    expect(onJobResume(p0g55, { intent: 'resume' }, 99_999)).toEqual({ allowed: true });
  });

  it('a file with a G92 before the change keeps its G92 in the re-check', async () => {
    const s = await leftIn([], 'G21 G90\nG0 Z20\nG92 Z0\nG1 Z5 F600\nT1 M6\nG1 Z-30\nM30');
    // G92 makes Z read 0 at machine 20: Z-30 after the change is machine -10 with G54 Z 0, and -10 + 15 = 5 with G54 Z 15.
    expect(onJobResume(rezeroOn(s, 'g54', 0), { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: expect.stringContaining('line 6: Z would reach machine -10 mm') });
    expect(onJobResume(rezeroOn(s, 'g54', 15), { intent: 'resume' }, 99_999)).toEqual({ allowed: true });
  });
});

export type { SanitizeResult };
