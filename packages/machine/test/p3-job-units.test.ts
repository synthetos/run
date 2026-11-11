/**
 * Phase 3 job layer, unit by unit (SAFETY §4.4a): the live start state and motion model the sanitiser gets, the
 * plain words of a refused line, the line-mode decisions (H77), and the guards of every job decision, driven on
 * a copy of a real connected session's state through a recording transition.
 */
import { TINYG_EN } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import {
  JOB_LIMITS,
  feedLimitLine,
  jobFlagLine,
  liveMotion,
  liveStart,
  rxmLine,
  rxmTarget,
  slotRoom,
  statusMeaning,
  textHash,
  type JobState,
  type SessionEffect,
  type SessionState,
} from '../src/index.ts';
import {
  abandonLoad,
  feedLimitWindow,
  maybeRestoreLineMode,
  onFeedLimit,
  onJobAnswer,
  onJobBreakpoints,
  onJobFault,
  onJobLinkLost,
  onJobMotionAnswer,
  onJobPause,
  onJobPoll,
  onJobPrepAnswer,
  onJobReset,
  onJobResume,
  onJobRuntimeAnswer,
  onJobStop,
  onJobTimer,
  onLineModeAnswer,
  onLineModeMemory,
  onLoadJob,
  onStartJob,
  pumpJob,
  queuedLine,
  type JobLayerTx,
} from '../src/session/job.ts';
import { failJob, jobStopped, lastFileLine } from '../src/session/jobState.ts';
import { DEFAULT_TIMINGS } from '../src/session/types.ts';
import { CONFIRM, EN_APPROVED, JOBS_RELEASE, jobHarness, load, runUntil, start } from './jobHarness.ts';

const value = (v: unknown, status = 0) => ({ value: v as never, status, at: 0 });

/** The refusal's reason, or null when allowed. */
const why = (d: { readonly allowed: boolean; readonly reason?: string }): string | null => (d.allowed ? null : (d.reason as string));

interface Recorder {
  readonly t: JobLayerTx;
  readonly fx: SessionEffect[];
  readonly faults: string[];
}

function tx(s: SessionState, release = JOBS_RELEASE): Recorder {
  const fx: SessionEffect[] = [];
  const faults: string[] = [];
  const t: JobLayerTx = {
    s,
    config: { release, manifest: EN_APPROVED, timings: DEFAULT_TIMINGS },
    set(patch) {
      t.s = { ...t.s, ...patch };
    },
    emit(e) {
      fx.push(e);
    },
    arm(id, ms) {
      fx.push({ kind: 'armTimer', id, seq: 0, ms });
    },
    cancel(id) {
      fx.push({ kind: 'cancelTimer', id });
    },
  };
  return { t, fx, faults };
}

const deps = (r: Recorder) => ({ fault: (_t: JobLayerTx, cause: string) => void r.faults.push(cause) });

/** A connected jobs session with SMALL loaded and checked: its state is the base of every unit here. */
async function ready(text = 'G21 G90\nG1 X5 F600\nG1 X0\nM30'): Promise<SessionState> {
  const h = await jobHarness();
  await load(h, text);
  return h.session.state;
}

function withJob(s: SessionState, patch: Partial<JobState>): SessionState {
  return { ...s, job: { ...(s.job as JobState), ...patch } };
}

describe('the live start state and motion model for the sanitiser', () => {
  it('maps every read it has and leaves the rest unknown', async () => {
    const base = await ready();
    const s: SessionState = {
      ...base,
      values: {
        unit: value(0),
        dist: value(1),
        admo: value(0),
        plan: value(2),
        coor: value(2),
        // In G20 the board prints g55 and g92 in inches and ofs in mm (EN json_parser.c:828; config_app.c:858-871).
        g55: value({ x: 1, y: 2, z: 3, q: 9, a: 'n' }),
        g57: value({ x: 1, a: 90 }),
        g92: value({ x: 0.5, y: 0, z: 0 }),
        ofs: value({ x: 38.1, y: 50.8, z: 78.2 }),
        mpo: value([1, 2]),
        g28: value({ x: 0 }, 100),
        gun: value(0),
        gdi: value(1),
        gpl: value(1),
        gco: value(3),
      },
    };
    const st = liveStart(s);
    expect(st).toMatchObject({ units: 'G20', distance: 'G91', arcDistance: 'G90.1', plane: 'G19', wcs: 'G55', g92: { active: true } });
    expect(st.wcsOffsets?.G55).toEqual({ X: 25.4, Y: 50.8, Z: expect.closeTo(76.2, 9) });
    // A, B and C are degrees, never converted.
    expect(st.wcsOffsets?.G57).toEqual({ X: 25.4, A: 90 });
    expect(st.g92?.offsets).toEqual({ X: 12.7, Y: 0, Z: 0 });
    expect(st.toolOffset).toEqual({ X: 0, Y: 0, Z: 2 });
    expect(st.machine).toBeUndefined();
    expect(st.g28).toBeUndefined();
    expect(st.defaults).toEqual({ units: 'G20', distance: 'G91', plane: 'G18', wcs: 'G56' });
    const other = liveStart({ ...base, values: { unit: value(7), dist: value(3), admo: value(1), plan: value(9), coor: value(0), gun: value(1), gdi: value(0), gpl: value(0), gco: value(9) } });
    expect(other).toMatchObject({ arcDistance: 'G91.1', defaults: { units: 'G21', distance: 'G90', plane: 'G17' } });
    expect(other.units).toBeUndefined();
    expect(other.wcs).toBeUndefined();
    expect(liveStart({ ...base, values: { unit: value(1), coor: value(1), g54: value({ x: 0 }), g92: value({ x: 0 }), ofs: value({ y: 1 }) } }).toolOffset).toEqual({});
    // Without the units read, offsets printed in them are unknown: never guessed as mm.
    const unitless = liveStart({ ...base, values: { coor: value(1), g54: value({ x: 1, y: 0, z: 0 }), g92: value({ x: 0, y: 0, z: 0 }), ofs: value({ x: 1, y: 0, z: 0 }), g28: value({ x: 1 }) } });
    expect(unitless.wcsOffsets).toEqual({});
    expect(unitless.g92).toBeUndefined();
    expect(unitless.g28).toBeUndefined();
    expect(unitless.toolOffset).toBeUndefined();
  });

  it('a board an inch job left in G20 prints its offsets in inches: the next check takes them back to mm (EN json_parser.c:828)', async () => {
    const h = await jobHarness();
    // The job sets G54 in mm, then works in inches; its M30 keeps G20 (the edge-next program end leaves the units).
    await start(h, 'G21 G90\nG10 L2 P1 X50.8 Y25.4 Z-12.7\nG20\nG0 X0.5 Y0.25\nM30');
    expect(await runUntil(h, () => h.session.snapshot.job?.phase === 'done')).toBe(true);
    // A temporary offset on X at machine X 63.5 (G54 50.8 + 0.5 in).
    expect(h.session.request({ intent: 'tempOffset', axes: ['x'] })).toEqual({ allowed: true });
    await h.run(1500);
    await load(h, 'G21 G90\nG0 X1\nM30', 'second.nc');
    const s = h.session.state;
    expect(s.values['unit']?.value).toBe(0);
    expect(s.values['g54']?.value).toMatchObject({ x: 2, y: 1, z: -0.5 });
    expect(s.values['g92']?.value).toMatchObject({ x: 0.5 });
    const st = liveStart(s);
    expect(st.units).toBe('G20');
    const mm = (v: Readonly<Record<string, number>> | undefined): Record<string, number> => Object.fromEntries(Object.entries(v ?? {}).filter(([k]) => 'XYZ'.includes(k)).map(([k, x]) => [k, Math.round(x * 1000) / 1000 + 0]));
    expect(mm(st.wcsOffsets?.G54)).toEqual({ X: 50.8, Y: 25.4, Z: -12.7 });
    expect(mm(st.g92?.offsets)).toEqual({ X: 12.7, Y: 0, Z: 0 });
    expect(mm(st.toolOffset)).toEqual({ X: 0, Y: 0, Z: 0 });
  });

  it('takes vm, fr, am and ra per axis, skipping what is missing or not valid', async () => {
    const base = await ready();
    const m = liveMotion({ ...base, values: { x: value({ vm: 900, fr: 0, am: 1 }), y: value({ am: 7 }), a: value({ am: 3, ra: 0 }), b: value({ am: 3, ra: 2 }) } });
    expect(m.maxVelocity).toEqual({ X: 900 });
    expect(m.feedrateMax).toEqual({});
    expect(m.linear).toEqual({ X: 1 });
    expect(m.rotary).toEqual({ A: { mode: 3 }, B: { mode: 3, radiusMm: 2 } });
  });
});

describe('plain words and lines', () => {
  it('names each refusal class (W38), and says "an error" for an unknown code', () => {
    expect(statusMeaning(TINYG_EN, 221)).toBe('outside the soft limits');
    expect(statusMeaning(TINYG_EN, 132)).toBe('an M code this firmware does not support');
    expect(statusMeaning(TINYG_EN, 106)).toBe('not accepted now');
    expect(statusMeaning(TINYG_EN, 107)).toBe('the line is too long');
    for (const c of [204, 205, 206]) expect(statusMeaning(TINYG_EN, c)).toBe('the controller is in alarm');
    expect(statusMeaning(TINYG_EN, 13)).toBe('the line or its answer was damaged');
    expect(statusMeaning(TINYG_EN, 240)).toBe('homing cycle failed');
    expect(statusMeaning(TINYG_EN, 9999)).toBe('an error');
  });

  it('the exact lines and the text hash', () => {
    expect(rxmLine(1)).toBe('{"rxm":1}');
    expect(jobFlagLine(0)).toBe('{"rt":{"job":0}}');
    expect(feedLimitLine(2.4)).toBe('{"rt":{"fi":2}}');
    expect(textHash('a')).toBe(textHash('a'));
    expect(textHash('a')).not.toBe(textHash('b'));
  });
});

describe('line mode (H77)', () => {
  it('the target outside a job: only a value Run changed and has not put back (pending), else nothing', async () => {
    const s = await ready();
    const rxm = (restore: number | null, pending: boolean): SessionState => ({ ...s, rxm: { ...s.rxm, restore, pending, memoryKnown: true } });
    expect(rxmTarget(rxm(0, true))).toBe(0);
    expect(rxmTarget(rxm(1, true))).toBe(1);
    expect(rxmTarget(rxm(0, false))).toBeNull();
    expect(rxmTarget(rxm(null, true))).toBeNull();
    const r = tx(s);
    expect(onLineModeMemory(r.t, 3).allowed).toBe(false);
    expect(onLineModeMemory(r.t, null).allowed).toBe(true);
    expect(r.t.s.rxm).toMatchObject({ restore: null, pending: false, memoryKnown: true });
    expect(onLineModeMemory(r.t, 0).allowed).toBe(true);
    expect(r.t.s.rxm).toMatchObject({ restore: 0, pending: true, memoryKnown: true });
    // A value this session already found wins over the record.
    const known = tx({ ...s, rxm: { ...s.rxm, restore: 1 } });
    onLineModeMemory(known.t, 0);
    expect(known.t.s.rxm).toMatchObject({ restore: 1, pending: false, memoryKnown: true });
  });

  it('nothing is put back unless the board is quiet, idle, in line mode and the target is 0', async () => {
    const s0 = await ready();
    const s: SessionState = { ...s0, footerRev: 3, rxm: { ...s0.rxm, restore: 0, memoryKnown: true, pending: true } };
    const blocked: SessionState[] = [
      { ...s, footerRev: 2 },
      { ...s, footerRev: undefined },
      { ...s, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } },
      withJob(s, { phase: 'running' }),
      { ...s, motion: {} as never },
      { ...s, reports: { ...s.reports, phase: 'seeding' } },
      { ...s, queue: [{ token: 'stat', purpose: 'poll' }] },
      { ...s, writing: { token: 'stat', purpose: 'poll', seq: 1 } },
      { ...s, expected: [{ token: 'stat', purpose: 'poll', late: false }] },
      { ...s, settingWrite: { phase: 'writing' } as never },
      withJob(s, { phase: 'loading' }),
      { ...s, rxm: { ...s.rxm, restore: 1 } },
      { ...s, rxm: { ...s.rxm, restore: null, memoryKnown: false } },
      { ...s, rxm: { ...s.rxm, pending: false } },
    ];
    for (const b of blocked) {
      const r = tx(b);
      maybeRestoreLineMode(r.t, true);
      expect(r.t.s.queue).toEqual(b.queue);
    }
    const no = tx(s);
    maybeRestoreLineMode(no.t, false);
    expect(no.t.s.queue).toEqual([]);
    const notCapable = tx(s, { ...JOBS_RELEASE, jobs: false });
    maybeRestoreLineMode(notCapable.t, true);
    expect(notCapable.t.s.queue).toEqual([]);
    const yes = tx(s);
    maybeRestoreLineMode(yes.t, true);
    expect(yes.t.s.queue).toEqual([{ token: 'rxm', purpose: 'lineMode', value: 0 }]);
    expect(yes.t.s.rxm.footerExpect).toBe(2);
  });

  it('with no pending record a board in line mode is logged once and left as found; a record on a board in character mode is cleared', async () => {
    const s0 = await ready();
    const found = tx({ ...s0, footerRev: 3, rxm: { ...s0.rxm, memoryKnown: true } });
    maybeRestoreLineMode(found.t, true);
    maybeRestoreLineMode(found.t, true);
    expect(found.t.s.queue).toEqual([]);
    expect(found.t.s.rxm.leftAsFound).toBe(true);
    expect(found.fx.filter((e) => e.kind === 'log' && e.text.includes('left as found'))).toHaveLength(1);
    const early = tx({ ...s0, footerRev: 3, rxm: { ...s0.rxm, memoryKnown: false } });
    maybeRestoreLineMode(early.t, true);
    expect(early.t.s.rxm.leftAsFound).toBe(false);
    const settled = tx({ ...s0, footerRev: 2, rxm: { ...s0.rxm, memoryKnown: true, restore: 0, pending: true } });
    maybeRestoreLineMode(settled.t, true);
    expect(settled.t.s.queue).toEqual([]);
    expect(settled.t.s.rxm.pending).toBe(false);
    expect(settled.fx.some((e) => e.kind === 'log' && e.text.includes('record that Run changed it is cleared'))).toBe(true);
    const nothing = tx({ ...s0, footerRev: 2 });
    maybeRestoreLineMode(nothing.t, true);
    expect(nothing.t.s.rxm).toEqual(s0.rxm);
  });

  it('a refused write, a failed read and a read-back that differs end the step; a job that was preparing fails', async () => {
    const s = withJob({ ...(await ready()), base: 'PREAMBLE' }, { phase: 'preparing' });
    const answer = (r: Record<string, unknown>, status = 0) => ({ kind: 'Response', line: '', r, footer: { rev: 3, status, field3: 10, raw: [] }, tid: undefined }) as never;
    for (const [step, reply] of [
      [{ kind: 'write', purpose: 'job', value: 1 }, answer({ rxm: 1 }, 100)],
      [{ kind: 'read', purpose: 'job', value: 1 }, null],
      [{ kind: 'readback', purpose: 'job', value: 1 }, answer({ rxm: 0 })],
    ] as const) {
      const r = tx({ ...s, rxm: { ...s.rxm, step: step as never } });
      onLineModeAnswer(r.t, reply, 1);
      expect(r.t.s.rxm.step).toBeNull();
      expect(r.t.s.job?.phase).toBe('failed');
      expect(r.t.s.base).toBe('IDLE_UNHOMED');
    }
    const restore = tx({ ...s, job: null, rxm: { ...s.rxm, step: { kind: 'write', purpose: 'restore', value: 0 } } });
    onLineModeAnswer(restore.t, answer({}, 100), 1);
    expect(restore.t.s.rxm.detail).toMatch(/refused rxm 0/);
    const quietRestore = tx({ ...s, job: null, rxm: { ...s.rxm, step: { kind: 'readback', purpose: 'restore', value: 0 } } });
    onLineModeAnswer(quietRestore.t, answer({ rxm: 0 }), 1);
    expect(quietRestore.t.s.rxm.changed).toEqual({ kind: 'restore', from: 1, to: 0 });
    // Line mode read as 1, but the footer is revision 2: never streamed.
    const rev2 = tx({ ...s, footerRev: 2, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } });
    onLineModeAnswer(rev2.t, answer({ rxm: 1 }), 1);
    expect(rev2.t.s.job?.message).toMatch(/footer is revision 2, not 3/);
    // A pending record (Run changed this board earlier and never put it back) keeps its value over the job's read.
    const pending = tx({ ...s, rxm: { ...s.rxm, restore: 0, pending: true, step: { kind: 'read', purpose: 'job', value: 1 } } });
    onLineModeAnswer(pending.t, answer({ rxm: 1 }), 1);
    expect(pending.t.s.rxm).toMatchObject({ restore: 0, pending: true, current: 1 });
  });
});

describe('the guards of the job decisions', () => {
  it('load and start refuse what they must', async () => {
    const s = await ready();
    expect(why(onLoadJob(tx(withJob(s, { phase: 'running' })).t, { intent: 'loadJob', job: null }, 0))).toBe('A job is running.');
    expect(onLoadJob(tx({ ...s, base: 'ALARM' }).t, { intent: 'loadJob', job: null }, 0).allowed).toBe(false);
    expect(onLoadJob(tx(s).t, { intent: 'loadJob', job: { name: 'x'.repeat(201), text: 'G0', c22: false } }, 0).allowed).toBe(false);
    const start = (st: SessionState, confirm: object = CONFIRM, breakpoints: unknown = []) => onStartJob(tx(st).t, { intent: 'startJob', breakpoints: breakpoints as number[], confirm: confirm as typeof CONFIRM }, 0);
    expect(why(start(s, CONFIRM, [1.5]))).toBe('The breakpoints are not valid.');
    expect(why(start({ ...s, job: null }))).toBe('No job is loaded and checked.');
    expect(why(start(withJob(s, { phase: 'running' })))).toBe('This job is already running.');
    expect(why(start({ ...s, queue: [{ token: 'stat', purpose: 'poll' }] }))).toBe('The machine is busy.');
    expect(why(start({ ...s, reports: { ...s.reports, phase: 'configuring' } }))).toBe('The connection is still being set up.');
    expect(why(start(s, null as never))).toBe('The start needs its confirmations.');
    expect(why(start(s, { ...CONFIRM, unhomed: false }))).toBe('The machine is not homed.');
    expect(start({ ...s, live: { ...s.live, home: 1 } }, { ...CONFIRM, unhomed: false }).allowed).toBe(true);
    expect(why(start(s, { ...CONFIRM, workZero: false }))).toBe("The job's work zero is not confirmed.");
    const spin = await ready('G21 G90\nM3 S1000\nG1 X1 F600\nM5\nM30');
    expect(why(start(spin, { ...CONFIRM, spindle: false }))).toBe('This job starts the spindle.');
    expect(onStartJob(tx(s, { ...JOBS_RELEASE, jobs: false }).t, { intent: 'startJob', breakpoints: [], confirm: CONFIRM }, 0).allowed).toBe(false);
  });

  it('breakpoints, pause, resume and stop refuse what they must', async () => {
    const s = await ready();
    expect(onJobBreakpoints(tx({ ...s, job: null }).t, [1], 0).allowed).toBe(false);
    expect(onJobBreakpoints(tx(s).t, 'nope', 0).allowed).toBe(false);
    expect(onJobBreakpoints(tx(s).t, new Array(JOB_LIMITS.maxBreakpoints + 1).fill(1), 0).allowed).toBe(false);
    expect(onJobBreakpoints(tx(withJob(s, { phase: 'running', next: 0 })).t, [2], 0).allowed).toBe(true);
    expect(queuedLine(s.job as JobState, 2)).toBe(false);
    expect(onJobPause(tx({ ...s, job: null }).t, 0)).toBe(false);
    expect(onJobPause(tx(withJob(s, { phase: 'paused' })).t, 0)).toBe(false);
    expect(onJobPause(tx({ ...withJob(s, { phase: 'running' }), motion: {} as never }).t, 0)).toBe(false);
    const resume = (st: SessionState, extra: object = {}) => onJobResume(tx(st).t, { intent: 'resume', ...extra }, 0);
    expect(why(resume({ ...withJob(s, { phase: 'paused' }), rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } }))).toBe('The controller is still answering.');
    expect(why(resume(withJob(s, { phase: 'running' })))).toBe('The job is not paused.');
    expect(why(resume(withJob(s, { phase: 'refused', confirmed: 0, pauseAt: 1 }), { skip: true }))).toBe('The hold is not confirmed yet.');
    const held = resume({ ...withJob(s, { phase: 'programStop' }), live: { ...s.live, hold: 6 } });
    expect(held.allowed).toBe(true);
    expect(onJobStop(tx({ ...s, job: null }).t, 0)).toBe(false);
    expect(onJobStop(tx(withJob(s, { phase: 'running' }), { ...JOBS_RELEASE, jobs: false }).t, 0)).toBe(false);
    const stopping = tx({ ...withJob(s, { phase: 'running' }), motion: { reason: 'stopJob' } as never });
    expect(onJobStop(stopping.t, 0)).toBe(false);
    expect(stopping.t.s.job?.stopping).toBe(true);
    const preparingWrite = tx({ ...withJob(s, { phase: 'preparing' }), base: 'PREAMBLE', rxm: { ...s.rxm, step: { kind: 'write', purpose: 'job', value: 1 } } });
    expect(onJobStop(preparingWrite.t, 0)).toBe(true);
    expect(preparingWrite.t.s.job?.phase).toBe('stopped');
  });

  it('resume after a tool change: the position must be known, the speed must be known, the way back in range', async () => {
    const s = await ready();
    const tcState = (at: object, live: object, tc: object = {}) =>
      withJob({ ...s, live: { ...s.live, mpo: live as never } }, { phase: 'toolChange', toolChange: { index: 1, tool: 1, spindle: 'off', speed: null, mist: false, flood: false, restartsSpindle: true, at: at as never, units: 1, dist: 0, ...tc } });
    expect(why(onJobResume(tx(tcState({ x: 0, y: 0, z: 0 }, { x: 5 })).t, { intent: 'resume' }, 0))).toBe('The machine position is not known.');
    expect(why(onJobResume(tx(tcState({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { spindle: 'ccw', restartsSpindle: false })).t, { intent: 'resume', spindleRestart: true }, 0))).toBe('The spindle was on, but its speed is not known.');
    expect(why(onJobResume(tx(tcState({ x: 9999, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).t, { intent: 'resume' }, 0))).toBe('The way back is out of range.');
    const ok = tx(tcState({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { spindle: 'ccw', speed: 800, restartsSpindle: false, mist: true, flood: true }));
    expect(onJobResume(ok.t, { intent: 'resume', spindleRestart: true }, 0).allowed).toBe(true);
    expect(ok.t.s.queue.map((q) => q.line)).toEqual(['M4 S800', undefined, undefined, undefined, undefined]);
    expect(ok.t.s.job?.resumeSteps.map((x) => x.line)).toEqual(['M7', 'M8']);
    expect(onJobMotionAnswer(ok.t, 'M4 S800', 0, 1)).toBe(true);
    expect(onJobMotionAnswer(ok.t, 'M7', 132, 1)).toBe(true);
    expect(ok.t.s.job?.phase).toBe('toolChange');
    expect(onJobMotionAnswer(tx(s).t, 'M5', 0, 1)).toBe(false);
  });

  it('polls: a pause at rest, a pause with no answer, a resume step at rest', async () => {
    const s = await ready();
    const rest = { stat: 4, hold: 0, vel: 0, qr: 32 } as const;
    // Every decision reads the completed poll cycle, never the live view (independent review 2026-11-03, R5).
    const polled = { ...rest, failed: false };
    const atRest = tx({ ...withJob(s, { phase: 'pausing', confirmed: 1, acked: 2, next: 2, pauseAt: 0 }), live: { ...s.live, ...rest, spe: 1 }, polled });
    onJobPoll(atRest.t, 10);
    expect(atRest.t.s.job?.phase).toBe('paused');
    expect(atRest.t.s.job?.message).toBe('Paused · spindle still on');
    const moving = tx({ ...withJob(s, { phase: 'pausing', confirmed: 0, pauseAt: 0 }), live: { ...s.live, stat: 5, hold: 0, vel: 300, qr: 20 }, polled: { stat: 5, hold: 0, vel: 300, qr: 20, failed: false } });
    onJobPoll(moving.t, 5000);
    expect(moving.fx.some((e) => e.kind === 'writeRealtime' && e.name === 'feedhold')).toBe(true);
    expect(moving.t.s.notices.motion?.text).toMatch(/^No answer from the board yet/);
    // A dwell after a lost `!` (stat 5, vel 0, hold 0) is not a pause: `!` goes again, and the job is not called paused.
    const dwell = { stat: 5, hold: 0, vel: 0, qr: 31 } as const;
    const dwelling = tx({ ...withJob(s, { phase: 'pausing', confirmed: 1, acked: 2, next: 2, pauseAt: 0 }), live: { ...s.live, ...dwell }, polled: { ...dwell, failed: false } });
    onJobPoll(dwelling.t, 10);
    expect(dwelling.t.s.job?.phase).toBe('pausing');
    expect(dwelling.fx.some((e) => e.kind === 'writeRealtime' && e.name === 'feedhold')).toBe(true);
    // A hold in a dwell can report a stale vel: the hold decides.
    const hold = { stat: 6, hold: 6, vel: 12.5, qr: 31 } as const;
    const inDwell = tx({ ...withJob(s, { phase: 'pausing', confirmed: 1, acked: 2, next: 2, pauseAt: 0 }), live: { ...s.live, ...hold }, polled: { ...hold, failed: false } });
    onJobPoll(inDwell.t, 10);
    expect(inDwell.t.s.job?.phase).toBe('paused');
    const resuming = tx({ ...withJob(s, { phase: 'resuming', confirmed: 1, resumeSteps: [] }), live: { ...s.live, ...rest }, polled });
    onJobPoll(resuming.t, 10);
    expect(resuming.t.s.job?.phase).toBe('running');
    const running = tx(withJob(s, { phase: 'running' }));
    onJobPoll(running.t, 10);
    expect(running.t.s.job?.phase).toBe('running');
    onJobPoll(tx({ ...withJob(s, { phase: 'running' }), motion: {} as never }).t, 0);
    const done = tx(withJob(s, { phase: 'ending', stop: { kind: 'end', index: 3 }, confirmed: 1, acked: 4, next: 4, report: { ...(s.job as JobState).report, endState: { spindle: 'cw', mist: false, flood: true } } as never }));
    done.t.s = { ...done.t.s, live: { ...s.live, ...rest }, polled };
    onJobPoll(done.t, 10);
    expect(done.t.s.job?.message).toBe('Job finished: 4 lines, spindle ON, coolant ON (commanded).');
    const coolant = tx({ ...withJob(s, { phase: 'ending', stop: { kind: 'end', index: 3 }, confirmed: 1, acked: 4, next: 4, report: { ...(s.job as JobState).report, endState: { spindle: 'off', mist: true, flood: false } } as never }), live: { ...s.live, ...rest }, polled });
    onJobPoll(coolant.t, 10);
    expect(coolant.t.s.job?.message).toBe('Job finished: 4 lines, spindle off, coolant ON (commanded).');
    const flood = tx({ ...withJob(s, { phase: 'ending', stop: { kind: 'end', index: 3 }, confirmed: 1, acked: 4, next: 4, report: { ...(s.job as JobState).report, endState: { spindle: 'off', mist: false, flood: true } } as never }), live: { ...s.live, ...rest }, polled });
    onJobPoll(flood.t, 10);
    expect(flood.t.s.job?.message).toBe('Job finished: 4 lines, spindle off, coolant ON (commanded).');
    const spindle = tx({ ...withJob(s, { phase: 'ending', stop: { kind: 'end', index: 3 }, confirmed: 1, acked: 4, next: 4, report: { ...(s.job as JobState).report, endState: { spindle: 'ccw', mist: false, flood: false } } as never }), live: { ...s.live, ...rest }, polled });
    onJobPoll(spindle.t, 10);
    expect(spindle.t.s.job?.message).toBe('Job finished: 4 lines, spindle ON, coolant off (commanded).');
  });

  it('the timer: the liveness grace period, the STALE limit, and quiet stops', async () => {
    const s = await ready();
    const grace = tx(withJob(s, { phase: 'failed', faultStopAt: 100 }));
    onJobTimer(grace.t, deps(grace), 50);
    expect(grace.fx.at(-1)).toMatchObject({ kind: 'armTimer', id: 'job', ms: 50 });
    onJobTimer(grace.t, deps(grace), 100);
    expect(grace.t.s.job?.stopping).toBe(true);
    const stale = tx({ ...withJob(s, { phase: 'running' }), overlays: ['STALE'], stale: { at: 0, silentForMs: 3000 } });
    onJobTimer(stale.t, deps(stale), JOB_LIMITS.staleFaultMs);
    expect(stale.faults).toEqual(['staleWhileRunning']);
    for (const phase of ['toolChange', 'paused', 'preparing', 'done'] as const) {
      const r = tx(withJob(s, { phase }));
      onJobTimer(r.t, deps(r), 0);
      expect(r.t.s.queue).toEqual([]);
    }
    onJobTimer(tx({ ...s, job: null }).t, { fault: () => undefined }, 0);
  });

  it('faults, resets and a lost link end only an active job; a liveness fault waits out the grace period', async () => {
    const s = await ready();
    const idle = tx(s);
    onJobFault(idle.t, 'integrity', 'x', 0, true);
    onJobReset(idle.t, 0);
    onJobLinkLost(idle.t, 0);
    expect(idle.t.s.job?.phase).toBe('ready');
    const live = tx(withJob(s, { phase: 'running' }));
    onJobFault(live.t, 'liveness', 'no reports', 0, true);
    expect(live.t.s.job).toMatchObject({ phase: 'failed', faultStopAt: JOB_LIMITS.faultGraceMs });
    const noLink = tx(withJob(s, { phase: 'running' }));
    onJobFault(noLink.t, 'integrity', 'gone', 0, false);
    expect(noLink.t.s.job?.stopping).toBe(false);
  });

  it('runtime answers, feed-limit lines, abandoned loads and slot room', async () => {
    const s = await ready();
    const r = tx(withJob(s, { feedLimit: feedLimitWindow(2) }));
    onJobRuntimeAnswer(r.t, { token: 'rt', purpose: 'jobRuntime', line: feedLimitLine(2) }, null, 0);
    expect(r.t.s.job?.feedLimit).toBeNull();
    onJobRuntimeAnswer(r.t, { token: 'rt', purpose: 'jobRuntime', line: jobFlagLine(1) }, null, 0);
    expect(r.t.s.job?.events.at(-1)?.text).toMatch(/did not take the job flag/);
    onJobRuntimeAnswer(r.t, { token: 'rt', purpose: 'jobRuntime', line: '{"rt":{"fg":1}}' }, null, 0);
    expect(r.t.s.job?.events.at(-1)?.text).toMatch(/did not take the supply-gap report/);
    onJobRuntimeAnswer(tx({ ...s, job: null }).t, { token: 'rt', purpose: 'jobRuntime' }, null, 0);
    const f = tx(withJob(s, { feedLimit: feedLimitWindow(2) }));
    onFeedLimit(f.t, 'fl', { k: 1, m: 9, p: 37, n: 12 }, false);
    expect(f.t.s.job?.feedLimit?.move).toEqual({ k: 1, m: 9, p: 37, n: 12 });
    onFeedLimit(f.t, 'fl', { k: 'x' }, false); // malformed: ignored
    onFeedLimit(f.t, 'fl', { k: 0 }, false); // missing m, p, n read as 0, null, null
    expect(f.t.s.job?.feedLimit?.move).toEqual({ k: 0, m: 0, p: null, n: null });
    onFeedLimit(f.t, 'fs', { v: 1 }, true); // malformed: no counters
    onFeedLimit(f.t, 'fs', { v: 'x', e: 1, q: 1, c: [0, 0, 0, 0, 0, 0], ct: 1, cd: 0 }, false); // no version number: malformed, not unsupported
    onFeedLimit(f.t, 'fs', { v: 1, e: 1, q: 1, c: [0, 0, 0], ct: 1, cd: 0 }, false); // too few counters
    onFeedLimit(f.t, 'fs', { v: 1, e: 1, q: 1, c: [0, 0, 0, 0, 0, 'x'], ct: 1, cd: 0 }, false); // a counter that is not a number
    expect(f.t.s.job?.feedLimit).toMatchObject({ last: null, unsupported: false });
    const fs1 = { v: 1, e: 2, q: 1, c: [950, 0, 0, 0, 0, 0], ct: 950, cd: 7.998 };
    const fs3 = { v: 1, e: 2, q: 3, c: [2967, 252, 0, 1190, 0, 0], ct: 2967, cd: 16.698 };
    onFeedLimit(f.t, 'fs', fs1, false);
    onFeedLimit(f.t, 'fs', fs3, true);
    onFeedLimit(f.t, 'fs', { ...fs3, q: 2 }, false); // late or repeated: ignored
    expect(f.t.s.job?.feedLimit).toMatchObject({ first: { e: 2, q: 1 }, prev: { e: 2, q: 1 }, last: { e: 2, q: 3, c: [2967, 252, 0, 1190, 0, 0] }, short: true, unsupported: false });
    onFeedLimit(f.t, 'fs', { v: 3, e: 2, q: 4, c: [0, 0, 0, 0, 0, 0, 0], ct: 1, cd: 0 }, false); // a format run does not read: said, not folded
    expect(f.t.s.job?.feedLimit).toMatchObject({ last: { q: 3 }, unsupported: true });
    const said = f.t.s.job?.feedLimit;
    onFeedLimit(f.t, 'fs', { v: 3, e: 2, q: 5, c: [], ct: 1, cd: 0 }, false); // said once: the state does not change again
    expect(f.t.s.job?.feedLimit).toBe(said);
    onFeedLimit(f.t, 'fs', { v: 1, e: 3, q: 1, c: [1, 0, 0, 0, 0, 0], ct: 10, cd: 0.1 }, false); // a new window starts over
    expect(f.t.s.job?.feedLimit).toMatchObject({ first: { e: 3, q: 1 }, prev: null, last: { e: 3, q: 1 } });
    onFeedLimit(tx(s).t, 'fs', {}, false);
    const loading = tx({ ...withJob(s, { phase: 'loading' }), queue: [{ token: 'x', purpose: 'jobPrep' }] });
    abandonLoad(loading.t, 0, 'gone');
    expect(loading.t.s.job?.phase).toBe('blocked');
    expect(loading.t.s.queue).toEqual([]);
    expect(slotRoom({ ...s, job: null })).toBe(0);
    pumpJob(tx(withJob({ ...s, base: 'RUNNING', footerRev: 3 }, { phase: 'running', free: 10 })).t, false);
  });

  it('job state helpers: the last file line, a stop of an idle job, a failed job that was being stopped', async () => {
    const s = await ready();
    const j = s.job as JobState;
    expect(lastFileLine(j, undefined)).toBe(1);
    expect(lastFileLine({ ...j, acked: 2 }, 99)).toBe(2);
    expect(lastFileLine({ ...j, lines: [] }, undefined)).toBe(0);
    const idle = tx(s);
    jobStopped(idle.t, 0);
    failJob(idle.t, 0, 'x');
    expect(idle.t.s.job?.phase).toBe('ready');
    const failed = tx(withJob(s, { phase: 'failed', stopping: true, message: null, endedAt: null }));
    jobStopped(failed.t, 5);
    expect(failed.t.s.job?.message).toMatch(/^The job ended\. Stopped at line/);
    expect(failed.t.s.job?.endedAt).toBe(5);
  });
});

describe('more of the job layer, through its edges', () => {
  it('prep answers that are damaged or empty, scalars read as null, a spindle line without S', async () => {
    const s = await ready();
    const loading = withJob({ ...s, queue: [{ token: 'unit', purpose: 'jobPrep' }] }, { phase: 'loading', source: { text: 'G21\nM3\nG1 X1 F600\nM5\nM30', c22: false } });
    const r = tx(loading);
    onJobPrepAnswer(r.t, { token: 'x', purpose: 'jobPrep' }, null, 0);
    expect(r.t.s.values['x']).toMatchObject({ value: null, status: -1 });
    r.t.s = { ...r.t.s, queue: [] };
    onJobPrepAnswer(r.t, { token: 'coor', purpose: 'jobPrep' }, { kind: 'Response', line: '', r: {}, footer: { rev: 3, status: 0, field3: 10, raw: [] } } as never, 0);
    expect(r.t.s.job?.report?.startsSpindle).toBe(true);
    expect(r.t.s.job?.report?.speeds).toEqual([]);
    expect(liveStart({ ...s, values: { unit: value(null) } }).units).toBeUndefined();
  });

  it('the check summary counts blocks and tool changes in plain words', async () => {
    const blocked = await ready('G21\nG38.2 Z-1 F10\nG38.3 Z-1 F10\nM30');
    expect(blocked.job?.events.at(-1)?.text).toMatch(/^Checked with this board.s values: \d+ findings stop this file\.$/);
    const two = await ready('G21 G90\nG1 X1 F600\nT1 M6\nG1 X2\nT2 M6\nG1 X3\nM30');
    expect(two.job?.events.at(-1)?.text).toMatch(/, 2 tool changes\.$/);
    expect((await ready('G21\n$H\nM30')).job?.events.at(-1)?.text).toBe("Checked with this board's values: 1 finding stops this file.");
  });

  it('every busy condition refuses a start; breakpoints are sorted and kept for a job that is not running', async () => {
    const s = await ready();
    const busy: SessionState[] = [
      { ...s, motion: {} as never },
      { ...s, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } },
      { ...s, expected: [{ token: 'stat', purpose: 'poll', late: false }] },
      { ...s, writing: { token: 'stat', purpose: 'poll', seq: 1 } },
    ];
    for (const b of busy) expect(why(onStartJob(tx(b).t, { intent: 'startJob', breakpoints: [], confirm: CONFIRM }, 0))).toBe('The machine is busy.');
    const r = tx(s);
    expect(onJobBreakpoints(r.t, [3, 1, 3], 0)).toEqual({ allowed: true });
    expect(r.t.s.job?.breakpoints).toEqual([1, 3]);
    expect(r.t.s.job?.events.at(-1)?.text).not.toMatch(/already queued/);
  });

  it('line mode: a read of 0 after the job was stopped writes nothing; a read-back with no value; an unknown footer', async () => {
    const s = withJob({ ...(await ready()), base: 'PREAMBLE' }, { phase: 'preparing', stopping: true });
    const answer = (r: Record<string, unknown>) => ({ kind: 'Response', line: '', r, footer: { rev: 2, status: 0, field3: 10, raw: [] } }) as never;
    const read0 = tx({ ...s, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } });
    onLineModeAnswer(read0.t, answer({ rxm: 0 }), 0);
    expect(read0.t.s.queue).toEqual([]);
    const noValue = tx({ ...s, rxm: { ...s.rxm, step: { kind: 'readback', purpose: 'job', value: 1 } } });
    onLineModeAnswer(noValue.t, answer({}), 0);
    expect(noValue.t.s.rxm.detail).toBe('rxm reads back nothing (status 0), not 1');
    const fresh = withJob(s, { stopping: false });
    const unknown = tx({ ...fresh, footerRev: undefined, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } });
    onLineModeAnswer(unknown.t, answer({ rxm: 1 }), 0);
    expect(unknown.t.s.job?.message).toMatch(/revision unknown, not 3/);
  });

  it('streaming guards: a line being written or a motion line waiting holds the job lines back', async () => {
    const s = withJob({ ...(await ready()), base: 'RUNNING', footerRev: 3 }, { phase: 'running', free: 12 });
    for (const b of [{ ...s, writing: { token: 'stat', purpose: 'poll' as const, seq: 1 } }, { ...s, queue: [{ token: 'gc', purpose: 'motion' as const, line: 'M5' }] }]) {
      const r = tx(b);
      pumpJob(r.t, true);
      expect(r.fx.filter((e) => e.kind === 'writeLine')).toEqual([]);
    }
    const r = tx(s);
    pumpJob(r.t, true);
    expect(r.fx.filter((e) => e.kind === 'writeLine').length).toBeGreaterThan(0);
  });

  it('a second refused line is recorded only; a refusal while pausing, paused or stopping does not pause again', async () => {
    const s = withJob(await ready(), { phase: 'running', next: 3 });
    const refuse = (st: SessionState, index: number) => {
      const r = tx(st);
      onJobAnswer(r.t, { token: 'job', purpose: 'job', index }, { kind: 'Response', line: '', r: {}, footer: { rev: 3, status: 220, field3: 10, raw: [] } } as never, 0);
      return r;
    };
    const first = refuse(s, 1);
    expect(first.t.s.job?.phase).toBe('refused');
    const second = refuse(first.t.s, 2);
    expect(second.t.s.job?.refused?.index).toBe(1);
    for (const st of [withJob(s, { phase: 'pausing' }), withJob(s, { phase: 'paused' }), withJob(s, { stopping: true })]) {
      const r = refuse(st, 1);
      expect(r.fx.some((e) => e.kind === 'writeRealtime')).toBe(false);
      expect(r.t.s.job?.refused?.index).toBe(1);
    }
    const ended = refuse(withJob(s, { phase: 'stopped' }), 1);
    expect(ended.t.s.job?.refused).toBeNull();
  });

  it('resume: a control line still owed waits; no hold means no ~; a tool change with nothing to put back goes on at once', async () => {
    const s = await ready();
    expect(why(onJobResume(tx({ ...withJob(s, { phase: 'paused' }), expected: [{ token: 'stat', purpose: 'poll', late: false }] }).t, { intent: 'resume' }, 0))).toBe('The controller is still answering.');
    for (const phase of ['programStop', 'refused'] as const) {
      const r = tx({ ...withJob(s, { phase, confirmed: 2 }), live: { ...s.live, hold: 0 } });
      expect(onJobResume(r.t, { intent: 'resume', skip: true }, 0).allowed).toBe(true);
      expect(r.fx.some((e) => e.kind === 'writeRealtime')).toBe(false);
    }
    const tcState = withJob({ ...s, live: { ...s.live, mpo: {} } }, { phase: 'toolChange', toolChange: { index: 1, tool: null, spindle: 'off', speed: null, mist: false, flood: false, restartsSpindle: false, at: {}, units: 1, dist: 0 } });
    const r = tx(tcState);
    expect(onJobResume(r.t, { intent: 'resume' }, 0).allowed).toBe(true);
    expect(r.t.s.job?.phase).toBe('running');
    expect(r.t.s.job?.events.at(-2)?.text).toBe('Resuming after the tool change.');
    const ccw = tx(withJob({ ...s, live: { ...s.live, mpo: {} } }, { phase: 'toolChange', toolChange: { index: 1, tool: 1, spindle: 'ccw', speed: 500, mist: false, flood: false, restartsSpindle: false, at: {}, units: 1, dist: 0 } }));
    expect(why(onJobResume(ccw.t, { intent: 'resume' }, 0))).toMatch(/Run starts it \(M4 S500\)/);
  });

  it('polls at a barrier with no state, with motion lines still owed; a stop with no tool and a breakpoint with the spindle on', async () => {
    const s = await ready();
    const barrier = tx({ ...withJob(s, { phase: 'draining', stop: { kind: 'barrier', index: 1 }, confirmed: 0, acked: 2, next: 2 }), live: { ...s.live, stat: undefined } as never });
    onJobPoll(barrier.t, 0);
    expect(barrier.t.s.job?.confirmed).toBe(0);
    const rest = { stat: 4, hold: 0, vel: 0, qr: 32 } as const;
    const polled = { ...rest, failed: false };
    const owed = tx({ ...withJob(s, { phase: 'resuming', confirmed: 0 }), live: { ...s.live, ...rest }, polled, queue: [{ token: 'stat', purpose: 'poll' }], expected: [{ token: 'gc', purpose: 'motion', late: false }] });
    onJobPoll(owed.t, 0);
    expect(owed.t.s.job?.confirmed).toBe(0);
    const writingMotion = tx({ ...withJob(s, { phase: 'resuming', confirmed: 0 }), live: { ...s.live, ...rest }, polled, writing: { token: 'gc', purpose: 'motion', seq: 1 } });
    onJobPoll(writingMotion.t, 0);
    expect(writingMotion.t.s.job?.confirmed).toBe(0);
    const tcJob = await ready('G21 G90\nG1 X1 F600\nM6\nG1 X0\nM30');
    const tc = tx({ ...withJob(tcJob, { phase: 'draining', stop: { kind: 'toolChange', index: 2 }, confirmed: 1, acked: 2, next: 2 }), live: { ...tcJob.live, ...rest }, polled });
    onJobPoll(tc.t, 0);
    // The outputs are not announced off until M5 and M9 are answered (independent review 2026-11-03, R6).
    expect(tc.t.s.job?.phase).toBe('outputsOff');
    expect(tc.t.s.job?.events.at(-1)?.text).toBe('Tool change at line 3: sending M5 and M9.');
    const bp = tx({ ...withJob(s, { phase: 'draining', stop: { kind: 'breakpoint', index: 1 }, confirmed: 1, acked: 1, next: 1 }), live: { ...s.live, ...rest, spe: 1 }, polled });
    onJobPoll(bp.t, 0);
    expect(bp.t.s.job?.message).toBe('Stopped at breakpoint · line 2 · spindle still on');
  });

  it('the STALE limit applies only while lines go out; a paused job is left to its own pause', async () => {
    const s = await ready();
    for (const st of [{ ...withJob(s, { phase: 'paused' }), overlays: ['STALE' as const], stale: { at: 0, silentForMs: 0 } }, { ...withJob(s, { phase: 'running' }), overlays: ['STALE' as const], stale: null }]) {
      const r = tx(st);
      onJobTimer(r.t, deps(r), 100_000);
      expect(r.faults).toEqual([]);
    }
    const integrity = tx(withJob(s, { phase: 'running' }));
    onJobFault(integrity.t, 'integrity', 'x', 0, true);
    expect(integrity.t.s.job?.stopping).toBe(true);
    expect(integrity.t.s.motion?.reason).toBe('stopJob');
  });
});
