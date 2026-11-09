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
import { checkTravel, positionKnown } from '../src/session/travelCheck.ts';
import { DEFAULT_TIMINGS, type JobReportSummary, type SessionState } from '../src/session/types.ts';
import { CONFIRM, EN_APPROVED, JOBS_RELEASE, jobHarness, load, runUntil } from './jobHarness.ts';

const CONFIG = { release: JOBS_RELEASE, manifest: EN_APPROVED, timings: DEFAULT_TIMINGS };

async function loaded(text: string): Promise<SessionState> {
  const h = await jobHarness({ rxm: 1 });
  await load(h, text);
  return h.session.state;
}

/** As if this connection saw a homing cycle complete (the session's position note, OD-23). */
function homed(s: SessionState): SessionState {
  return { ...s, live: { ...s.live, home: 1 }, notices: { ...s.notices, position: { by: 'homing', at: 1 } } };
}

function check(s: SessionState, text: string): ReturnType<typeof checkTravel> {
  return travelOf(s, sanitizeLive(s, text, false));
}

const PAST_X = 'G21 G90\nG1 X200 F600\nM30';

describe('the travel check at Start', () => {
  it('homed by a cycle, a file past +X travel: blocked, the line, the axis, the machine coordinate and the limit named', async () => {
    const s = homed(await loaded(PAST_X));
    expect(positionKnown(s)).toBe(true);
    const travel = check(s, PAST_X);
    expect(travel).toEqual({ block: { kind: 'outside', line: 2, text: 'line 2: X would reach machine 200 mm, beyond its travel limit of 150 mm' }, confirm: null });
    const report = withTravel({ blocked: false, counts: { block: 0, warn: 0, change: 0, info: 0 }, blocks: [] } as unknown as JobReportSummary, travel);
    expect(report).toMatchObject({ blocked: true, counts: { block: 1 }, blocks: [{ line: 2, message: 'X would reach machine 200 mm, beyond its travel limit of 150 mm' }] });
  });

  it('the same file on a board whose position was set by hand (or before this connection): C40, not a block', async () => {
    const s = await loaded(PAST_X);
    const hand = { ...s, live: { ...s.live, home: 1 }, notices: { ...s.notices, position: { by: 'hand' as const, at: 1 } } };
    for (const state of [hand, { ...hand, notices: { ...hand.notices, position: undefined } } as unknown as SessionState]) {
      expect(check(state, PAST_X)).toEqual({ block: null, confirm: { kind: 'outside', line: 2, text: 'line 2: X would reach machine 200 mm, beyond its travel limit of 150 mm, and the machine position was not set by a homing cycle in this connection' } });
    }
  });

  it('on the session: Start is refused until C40 is confirmed, then goes', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, PAST_X);
    expect(h.session.snapshot.job?.report?.travel?.confirm?.line).toBe(2);
    expect(h.session.startJob([], { ...CONFIRM, travel: false })).toMatchObject({ allowed: false, reason: expect.stringContaining('Confirm C40 to start') });
    expect(h.session.startJob([], CONFIRM)).toEqual({ allowed: true });
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
    const { x: _x, ...rest } = s.values;
    expect(check({ ...s, values: rest }, 'G21 G90\nG1 Y10 F600\nM30').confirm).toEqual({ kind: 'unchecked', line: null, text: 'the travel limits of X were not read' });
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

describe('the edges of the check', () => {
  it('no dialect: nothing to check; units not read: the linear limits are not known; past and unknown both found', async () => {
    const s = homed(await loaded(PAST_X));
    const ext = (x: { min: number; max: number } | null) => [{ line: 2, extent: { X: x, Y: { min: 0, max: 0 }, Z: { min: 0, max: 0 }, A: null, B: null, C: null } }];
    expect(checkTravel({ ...s, dialect: null }, ext({ min: 0, max: 999 }))).toEqual({ block: null, confirm: null });
    expect(checkTravel({ ...s, values: { ...s.values, unit: { value: null, status: 100, at: 0 } } }, ext({ min: 0, max: 1 })).confirm).toEqual({ kind: 'unchecked', line: null, text: 'the travel limits of X, Y, Z were not read' });
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
    expect(checkTravel(rotary, turn).block?.text).toBe('line 5: A would reach machine 120 °, beyond its travel limit of 90 °');
  });

  it('Start checks the travel again with the board as read then: a finding that appears only then ends the start (no C40 given)', async () => {
    const h = await jobHarness({ rxm: 1 });
    const text = 'G21 G91\nG1 X100 F600\nM30';
    await load(h, text);
    expect(h.session.snapshot.job?.report?.travel).toEqual({ block: null, confirm: null });
    // The machine moves 60 mm in X before Start: the incremental file now reaches X 160.
    h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 60, feed: 3000 });
    await runUntil(h, () => h.session.state.motion === null, 20_000);
    expect(h.session.startJob([], { ...CONFIRM, travel: false })).toEqual({ allowed: true });
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
    h.session.startJob([], CONFIRM);
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
    hand.s = { ...hand.s, notices: { ...hand.s.notices, position: { by: 'hand', at: 1 } } };
    expect(onJobResume(hand, { intent: 'resume' }, 99_999)).toEqual({ allowed: true });
    expect(hand.s.job?.events.at(-2)?.text ?? hand.s.job?.events.at(-1)?.text).toBeDefined();
    expect(hand.s.job?.events.some((e) => e.text.startsWith('With the new Z zero, line 4: Z would reach machine -4 mm'))).toBe(true);
  });

  it('refused when the units changed since the job was checked, or a value is not read', async () => {
    const s = await atToolChange();
    const units = rezeroed(s, -5);
    units.s = { ...units.s, values: { ...units.s.values, unit: { value: 0, status: 0, at: 0 } } };
    expect(onJobResume(units, { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: expect.stringContaining('other units') });
    const unread = rezeroed(s, 2);
    const { z: _z, ...rest } = unread.s.values;
    unread.s = { ...unread.s, values: rest };
    expect(onJobResume(unread, { intent: 'resume' }, 99_999)).toMatchObject({ allowed: false, reason: expect.stringContaining('the travel limits of Z were not read') });
  });
});

export type { SanitizeResult };
