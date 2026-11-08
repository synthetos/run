/**
 * The independent review of 2026-11-03 (findings R1-R8, reviewed at 4f75f95): the reviewer's ten probes, inverted
 * so that each asserts the fixed behaviour, plus the edges of the fixes. Every case was reproduced against run's
 * own firmware model before the fix; a case here fails again if the fix is undone.
 *
 * - R1: safe-Z and the tool-change return run in explicit absolute millimetres (`G90 G21` on its own answered
 *   line before any `G53 G0`), and the modes are put back after (motion.ts, job.ts, motionLines.ts).
 * - R2: `G21` on its own answered line before the first jog piece (the firmware reads F before G20/G21).
 * - R3: Start reads the board again and sanitises the file again before anything is sent (`checking`).
 * - R4: a line refused while pausing or paused makes the job `refused`: no plain Resume, only Skip (C33) or Stop.
 * - R5: a poll cycle confirms a hold, flush or drain only when every one of its reads was answered with status 0.
 * - R6: the tool-change card and its change-ready state come only after `M5` and `M9` are each answered; a
 *   refusal or a missing answer ends the job closed.
 * - R7: a job answer carrying the firmware's `gc` echo is that job line's answer, not an unexpected response.
 * - R8: the write gate's GET cap does not refuse a longer motion line.
 */
import { createSim, TinyGEdgeNextModel } from '@synthetos/testkit';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { phase1WriteVerdict, reduce, type JobState, type SessionEffect, type SessionState } from '../src/index.ts';
import { onJobAnswer, onJobMotionAnswer, onJobMotionTimeout, onJobPoll, onJobPrepAnswer, onJobResume, type JobLayerTx } from '../src/session/job.ts';
import { ABSOLUTE_MM_LINE, UNITS_LINE, jogLine, safeZLine } from '../src/session/motionLines.ts';
import { completedPoll, onPollDone, type MotionTx } from '../src/session/motion.ts';
import { DEFAULT_TIMINGS } from '../src/session/types.ts';
import { CONFIRM, EN_APPROVED, JOBS_RELEASE, jobHarness, load, runUntil, start, writes, zigzag } from './jobHarness.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT } from './simTransport.ts';

const CONFIG = { release: JOBS_RELEASE, manifest: EN_APPROVED, timings: DEFAULT_TIMINGS };
const AT_REST = { stat: 1, hold: 0, vel: 0, qr: 32 } as const;
const POLLED_REST = { ...AT_REST, failed: false };

const model = (h: Harness): TinyGEdgeNextModel => h.device as TinyGEdgeNextModel;

/** The reducer's transition over a state, for the job and motion layers' own functions. */
function tx(s: SessionState): { t: JobLayerTx & MotionTx; fx: SessionEffect[] } {
  const fx: SessionEffect[] = [];
  const t: JobLayerTx & MotionTx = {
    s,
    config: CONFIG,
    set(patch) {
      t.s = { ...t.s, ...patch };
    },
    emit(e) {
      fx.push(e);
    },
    arm() {},
    cancel() {},
  };
  return { t, fx };
}

function withJob(s: SessionState, patch: Partial<JobState>): SessionState {
  return { ...s, job: { ...(s.job as JobState), ...patch } };
}

/** The motion lines and realtime bytes written after `from` (no GETs, no ENQ). */
function motionWrites(h: Harness, from = 0): string[] {
  return writes(h)
    .slice(from)
    .filter((w) => !w.startsWith('{"') && w !== '\\x05');
}

/** A value read through the session (the read allowlist), after its answer. */
async function read(h: Harness, token: string): Promise<unknown> {
  expect(h.session.request({ intent: 'read', tokens: [token] })).toEqual({ allowed: true });
  await h.run(300);
  return h.session.state.values[token]?.value;
}

/**
 * A jobs session connected to a board another sender left in the modes `lines` set (G91, G20): the lines go to
 * the model directly before run connects (their answers reach no one), as a previous program would have left it.
 */
async function finished(h: Harness, text: string): Promise<void> {
  await start(h, text);
  // Done, the line mode put back and the offsets the job may have changed read again (jobOffsets.ts).
  await runUntil(h, () => h.session.snapshot.job?.phase === 'done' && h.session.snapshot.rxm.busy === false && h.session.state.queue.length === 0 && !h.session.state.expected.some((e) => !e.late), 30_000);
  expect(h.session.snapshot.job?.phase).toBe('done');
}

async function leftIn(lines: readonly string[], settleMs = 500): Promise<Harness> {
  const h = harness('en', { device: { start: 'ready', rxm: 1 }, session: { manifest: EN_APPROVED, release: JOBS_RELEASE } });
  for (const line of lines) for (const b of new TextEncoder().encode(`${line}\n`)) h.device.receive(b, false);
  await h.run(settleMs);
  void h.session.connect(PORT);
  await h.run(3000);
  expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  return h;
}

// --- The firmware model on its own (the reviewer's model probes, inverted) ----------------------------------------

function sim() {
  const s = createSim(new TinyGEdgeNextModel());
  const send = (line: string, ms = 100): number[] => {
    s.host.take();
    s.host.sendLine(line);
    s.clock.advance(ms);
    return s.host
      .take()
      .map((l) => {
        try {
          return JSON.parse(l) as { f?: number[] };
        } catch {
          return {};
        }
      })
      .filter((v) => Array.isArray(v.f))
      .map((v) => (v.f as number[])[1] as number);
  };
  const get = (key: string): unknown => {
    s.host.take();
    s.host.sendLine(`{"${key}":null}`);
    s.clock.advance(30);
    for (const l of s.host.take()) {
      try {
        const v = JSON.parse(l) as { r?: Record<string, unknown> };
        if (v.r !== undefined && key in v.r) return v.r[key];
      } catch {
        /* a report or heartbeat */
      }
    }
    return undefined;
  };
  return { s, send, get, z: () => s.device.snapshot().position[2] as number };
}

describe('R1 (model): a safe-Z line after an answered `G90 G21` reaches the safe height under G91 and G20', () => {
  it('under G91 the Z word is a distance without it (-15); with it Z goes to -5', () => {
    const bug = sim();
    bug.send('G90 G0 Z-10', 5000);
    bug.send('G91');
    bug.send(safeZLine(Math.max(-10, -5)), 5000);
    expect(bug.z()).toBeCloseTo(-15); // the reviewer's reproduction: G53 keeps G91
    const fixed = sim();
    fixed.send('G90 G0 Z-10', 5000);
    fixed.send('G91');
    expect(fixed.send(ABSOLUTE_MM_LINE)).toEqual([0]);
    expect(fixed.send(safeZLine(Math.max(-10, -5)), 5000)).toEqual([0]);
    expect(fixed.z()).toBeCloseTo(-5);
    expect(fixed.get('dist')).toBe(0);
    expect(fixed.get('unit')).toBe(1);
  });

  it('under G20 the Z word is inches without it (-127 mm); with it Z goes to -5', () => {
    const bug = sim();
    bug.send('G90 G0 Z-10', 5000);
    bug.send('G20');
    bug.send(safeZLine(Math.max(-10, -5)), 10_000);
    expect(bug.z()).toBeCloseTo(-127);
    const fixed = sim();
    fixed.send('G90 G0 Z-10', 5000);
    fixed.send('G20');
    expect(fixed.send(ABSOLUTE_MM_LINE)).toEqual([0]);
    expect(fixed.send(safeZLine(Math.max(-10, -5)), 10_000)).toEqual([0]);
    expect(fixed.z()).toBeCloseTo(-5);
  });
});

describe('R2 (model): a jog piece after an answered `G21` runs at the requested feed from G20', () => {
  it('G20 then the piece alone reads F in inches (2540); after `G21` on its own line it is 100', () => {
    const bug = sim();
    bug.send('G20');
    bug.send(jogLine({ X: 0.25 }, 100));
    expect(bug.get('feed')).toBe(2540); // the reviewer's reproduction: F is set before G21 in the same block
    const fixed = sim();
    fixed.send('G20');
    expect(fixed.send(UNITS_LINE)).toEqual([0]);
    expect(fixed.send(jogLine({ X: 0.25 }, 100))).toEqual([0]);
    expect(fixed.get('feed')).toBe(100);
  });
});

// --- The session against the model -----------------------------------------------------------------------------

describe('R1 (session): go to zero and the tool-change return establish G90 G21 first and put the modes back', () => {
  it('go to zero from a board a job left in G91: Z rises to the safe height, and G91 is put back', async () => {
    // The other program lowers Z itself and leaves G91 (a jog of run's own ends in G90, §4.5b).
    const h = await leftIn(['G21 G91', 'G1 Z-10 F3000'], 3000);
    expect(h.session.state.live.dist).toBe(1);
    expect(h.device.snapshot().position[2]).toBeCloseTo(-10, 3);
    const from = writes(h).length;
    expect(h.session.request({ intent: 'goToZero', axes: ['x'], safeZ: -5 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.motion === null, 15_000);
    expect(motionWrites(h, from)).toEqual(['G90 G21', 'G53 G0 Z-5', 'G90 G0 X0', 'G91']);
    expect(h.device.snapshot().position[2]).toBeCloseTo(-5, 3); // not -15
    expect(h.device.snapshot().position[0]).toBeCloseTo(0, 3);
    expect(await read(h, 'dist')).toBe(1);
  });

  it('go to zero from a board a job left in G20: Z rises 5 mm, not 5 in, and G20 is put back', async () => {
    const h = await leftIn(['G90 G20']);
    expect(h.session.state.live.unit).toBe(0);
    expect(h.session.request({ intent: 'jog', axes: { z: -1 }, distanceMm: 10, feed: 3000 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.motion === null, 15_000);
    // No wait for the pushed report of the modes the jog put back: go to zero reads them itself (modes.ts).
    const from = writes(h).length;
    expect(h.session.request({ intent: 'goToZero', axes: ['x', 'y'], safeZ: -5 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.motion === null, 15_000);
    expect(motionWrites(h, from)).toEqual(['G90 G21', 'G53 G0 Z-5', 'G90 G0 X0 Y0', 'G90 G20']);
    expect(h.device.snapshot().position[2]).toBeCloseTo(-5, 3); // not -127
    expect(await read(h, 'unit')).toBe(0);
  });

  it('the return after a tool change in a G91 file: G90 G21, Z, XY, then G91 back, then the M6 line; the file ends where it should', async () => {
    const h = await jobHarness({ rxm: 1 });
    await start(h, ['G21 G91', 'G1 X2 F600', 'T1 M6', 'G1 X2', 'M30'].join('\n'));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange', 20_000);
    expect(h.session.request({ intent: 'jog', axes: { z: 1 }, distanceMm: 5, feed: 600 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.motion === null && h.session.snapshot.base === 'PROGRAM_PAUSED', 15_000);
    expect(h.session.snapshot.job?.toolChange?.moved).toBe(true);
    const from = writes(h).length;
    expect(h.session.request({ intent: 'resume' })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 30_000);
    const after = writes(h).slice(from).filter((x) => !x.startsWith('{"') && x !== '\\x05');
    expect(after[0]).toBe('G90 G21');
    expect(after[1]).toMatch(/^G53 G0 Z[3-5](\.\d+)?$/); // the machine Z as last reported (pushed reports lag a little)
    expect(after[2]).toMatch(/^G53 G0 X(2|1\.9\d*) Y0$/);
    expect(after.slice(3, 5)).toEqual(['G91', 'N3 T1 M6']);
    // Under G91 the return `G53 G0 X2` would have been a 2 mm step and the file would end near X6, not X4.
    expect(h.device.snapshot().position[0]).toBeCloseTo(4, 1);
  });

  it('the return is refused when the job\'s modes are not known to put back (nothing moves)', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, 'G21 G90\nG1 X1 F600\nT1 M6\nG1 X0\nM30');
    const s = h.session.state;
    const tc = { index: 2, tool: 1, spindle: 'off' as const, speed: null, mist: false, flood: false, restartsSpindle: false, at: { x: 0, y: 0, z: 0 } };
    const moved = { ...s, live: { ...s.live, mpo: { x: 0, y: 0, z: 5 } } };
    const unknown = tx(withJob(moved, { phase: 'toolChange', toolChange: { ...tc, units: undefined, dist: undefined } }));
    expect(onJobResume(unknown.t, { intent: 'resume' }, 0)).toMatchObject({ allowed: false, reason: expect.stringContaining('distance mode or units are not known') });
    expect(unknown.t.s.queue).toEqual([]);
    const known = tx(withJob(moved, { phase: 'toolChange', toolChange: { ...tc, units: 0, dist: 1 } }));
    expect(onJobResume(known.t, { intent: 'resume' }, 0)).toEqual({ allowed: true });
    expect(known.t.s.job?.resumeSteps.map((x) => x.line)).toEqual(['G53 G0 Z5', 'G53 G0 X0 Y0', 'G91 G20']);
    expect(known.t.s.queue.filter((q) => q.purpose === 'motion').map((q) => q.line)).toEqual(['G90 G21']);
    // Not moved: no return, so no mode lines either.
    const still = tx(withJob({ ...s, live: { ...s.live, mpo: { x: 0, y: 0, z: 0 } } }, { phase: 'toolChange', toolChange: { ...tc, units: undefined, dist: undefined } }));
    expect(onJobResume(still.t, { intent: 'resume' }, 0)).toEqual({ allowed: true });
    expect(still.t.s.job?.phase).toBe('running');
  });
});

describe('R2 (session): the first jog from a board in inches', () => {
  it('writes G21 on its own line, then the piece, then G90 G20; the feed is the requested millimetres per minute', async () => {
    const h = await leftIn(['G90 G20']);
    const from = writes(h).length;
    expect(h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 1000 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.motion === null, 15_000);
    expect(motionWrites(h, from)).toEqual(['G21', 'G21 G91 G1 X1 F1000', 'G90 G20']);
    expect(h.device.snapshot().position[0]).toBeCloseTo(1, 3);
    // Read back in inches (the board is in G20 again): 1000 mm/min is 39.37 in/min; F read in inches would be 1000.
    expect(await read(h, 'feed')).toBe(39.37);
    expect(await read(h, 'unit')).toBe(0);
  });

  it('a hold jog and a multi-piece step send G21 once, before the first piece', async () => {
    const h = await jobHarness({ rxm: 1 });
    const from = writes(h).length;
    expect(h.session.request({ intent: 'jog', axes: { y: 1 }, distanceMm: 10, feed: 1200 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.motion === null, 15_000);
    const w = motionWrites(h, from);
    expect(w[0]).toBe('G21');
    expect(w.filter((x) => x === 'G21')).toHaveLength(1);
    expect(w.filter((x) => x.startsWith('G21 G91'))).toHaveLength(4);
    expect(w.at(-1)).toBe('G90');
  });
});

describe('R3: Start reads the board again and checks the file again before anything is sent', () => {
  it('(reducer) a job checked in one unit mode is not started on the old lines after the mode changed: Start reads first', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, 'G90\nG1 X1 F600\nM30');
    const s = h.session.state;
    const t = reduce(CONFIG, { ...s, live: { ...s.live, unit: 0 }, values: { ...s.values, unit: { value: 0, status: 0, at: 9999 } } }, { type: 'intent', at: 10_000, request: { intent: 'startJob', breakpoints: [], confirm: CONFIRM } });
    expect(t.state.job?.phase).toBe('checking');
    expect(t.state.base).toBe('PREAMBLE');
    expect(t.state.writing).toMatchObject({ token: 'x', purpose: 'jobPrep' });
    expect(t.state.queue.filter((q) => q.purpose === 'jobPrep').map((q) => q.token)).toEqual(expect.arrayContaining(['unit', 'dist', 'mpo', 'g54']));
    expect(t.state.queue.some((q) => q.purpose === 'lineMode')).toBe(false);
    expect(t.state.rxm.step).toBeNull();
    expect(t.effects.some((e) => e.kind === 'writeLine' && e.line.startsWith('N'))).toBe(false);
  });

  it('(session) a 1 mm move checked at X0 is checked again after a 100 mm jog: the lines describe the 99 mm return', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, 'G90\nG1 X1 F600\nM30');
    const lines = h.session.state.job?.lines as JobState['lines'];
    const sum = (ls: JobState['lines'], f: (l: JobState['lines'][number]) => number): number => ls.map(f).reduce((a, b) => a + b, 0);
    expect(sum(lines, (l) => l.motion?.boundMm ?? 0)).toBeCloseTo(1, 3);
    const secondsPerMm = sum(lines, (l) => l.motion?.seconds ?? 0);
    expect(h.session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 100, feed: 5000 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.state.motion === null, 15_000);
    expect(h.device.snapshot().position[0]).toBeCloseTo(100);
    expect(h.session.startJob([], CONFIRM)).toEqual({ allowed: true });
    expect(h.session.state.job?.phase).toBe('checking');
    await runUntil(h, () => h.session.state.job?.phase !== 'checking', 10_000);
    expect(h.session.state.job?.phase).toBe('preparing');
    const checked = h.session.state.job?.lines as JobState['lines'];
    expect(checked).not.toEqual(lines);
    expect(sum(checked, (l) => l.motion?.boundMm ?? 0)).toBeCloseTo(99, 3);
    expect(sum(checked, (l) => l.motion?.seconds ?? 0)).toBeCloseTo(99 * secondsPerMm, 3);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    expect(h.device.snapshot().position[0]).toBeCloseTo(1, 3);
    expect(h.session.snapshot.job?.events.some((e) => e.text.includes('checking every line again'))).toBe(true);
  });

  it('a check at Start that blocks ends the start with nothing sent; the job is blocked, the machine idle', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, 'G21 G90\nG1 X1 F600\nM30');
    const s = h.session.state;
    // The file as the board must check it now: a probe (G38.2) the sanitiser stops. The reads are already in.
    const r = tx(withJob({ ...s, base: 'PREAMBLE', queue: [] }, { phase: 'checking', startedAt: 5, source: { text: 'G21 G90\nG38.2 Z-1 F10\nM30', c22: false } }));
    onJobPrepAnswer(r.t, { token: 'unit', purpose: 'jobPrep' }, { kind: 'Response', line: '', r: { unit: 1 }, footer: { rev: 3, status: 0, field3: 10, raw: [] } } as never, 7);
    expect(r.t.s.job?.phase).toBe('blocked');
    expect(r.t.s.job?.startedAt).toBeNull();
    expect(r.t.s.job?.report?.blocked).toBe(true);
    expect(r.t.s.job?.message).toMatch(/^The job did not start\. Checked with this board's values: \d+ findings? stops? this file\.$/);
    expect(r.t.s.base).toBe('IDLE_UNHOMED');
    expect(r.t.s.rxm.step).toBeNull();
    expect(r.fx.some((e) => e.kind === 'writeLine')).toBe(false);
    // The same job can be started again once the file is replaced: a fresh load.
    expect(reduce(CONFIG, r.t.s, { type: 'intent', at: 8, request: { intent: 'startJob', breakpoints: [], confirm: CONFIRM } }).effects.find((e) => e.kind === 'decision')).toMatchObject({ decision: { allowed: false } });
  });

  it('Stop job while checking: nothing was sent, the reads are dropped, "stopped"; the job starts again later with a fresh check', async () => {
    const h = await jobHarness({ rxm: 1 });
    const before = await start(h, 'G21 G90\nG1 X1 F600\nM30');
    expect(h.session.state.job?.phase).toBe('checking');
    expect(h.session.stopJob()).toEqual({ allowed: true });
    expect(h.session.state.job?.phase).toBe('stopped');
    expect(h.session.state.queue.some((q) => q.purpose === 'jobPrep')).toBe(false);
    await h.run(2000);
    expect(writes(h).slice(before).some((w) => w.startsWith('N'))).toBe(false);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.snapshot.job?.message).toBe('Stopped before the first line: nothing was sent.');
    // Start again (a stopped job): checked again, then run to the end.
    const again = writes(h).length;
    expect(h.session.startJob([], CONFIRM)).toEqual({ allowed: true });
    expect(h.session.state.job?.phase).toBe('checking');
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 30_000);
    expect(writes(h).slice(again).filter((w) => w.startsWith('N'))).toHaveLength(h.session.snapshot.job?.total as number);
  });

  it('Stop job after the check, while the line mode is being read: the job does not start', async () => {
    const h = await jobHarness({ rxm: 1 });
    const before = await start(h, 'G21 G90\nG1 X1 F600\nM30');
    await runUntil(h, () => h.session.state.job?.phase === 'preparing', 10_000);
    expect(h.session.state.rxm.step).toMatchObject({ kind: 'read', purpose: 'job' });
    expect(h.session.stopJob()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped', 10_000);
    await h.run(1000);
    expect(writes(h).slice(before).some((w) => w.startsWith('N'))).toBe(false);
    expect(h.session.snapshot.job?.phase).toBe('stopped');
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  });

  it('a finished job started again is checked again first; a prep read that times out while checking ends the start', async () => {
    const h = await jobHarness({ rxm: 1 });
    await finished(h, 'G21 G90\nG1 X1 F600\nG1 X0\nM30');
    expect(h.session.startJob([], CONFIRM)).toEqual({ allowed: true });
    expect(h.session.state.job?.phase).toBe('checking');
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 30_000);
    expect(h.session.snapshot.job?.phase).toBe('done');
    // The reads dropped (an answer timeout) while checking: the job did not start, and is "failed" with the reason.
    const s = h.session.state;
    const checking: SessionState = { ...withJob({ ...s, base: 'PREAMBLE' }, { phase: 'checking' }), expected: [{ token: 'x', purpose: 'jobPrep', late: false }], timers: { answer: 7 } };
    const r = reduce(CONFIG, checking, { type: 'timer', id: 'answer', seq: 7, at: 1 });
    expect(r.state.job?.phase).toBe('failed');
    expect(r.state.job?.message).toBe('The job did not start: the file could not be checked again (the controller did not answer the x read in time).');
    expect(r.state.base).toBe('IDLE_UNHOMED');
  });
});

describe('R4: a refused line during a Pause governs Resume', () => {
  async function ready(): Promise<SessionState> {
    const h = await jobHarness({ rxm: 1 });
    await load(h, 'G21 G90\nM3 S10000\nG1 X5 F600\nT2 M6\nG1 X0\nM5\nM30');
    return h.session.state;
  }

  it('(reviewer\'s case) a refusal answered while paused: the job is refused; plain Resume is denied; Skip (C33) continues', async () => {
    const s = await ready();
    const r = tx({ ...s, base: 'HELD', job: { ...(s.job as JobState), phase: 'paused', next: 3, acked: 2, confirmed: 2 }, live: { ...s.live, hold: 6 } });
    onJobAnswer(r.t, { token: 'job', purpose: 'job', index: 2 }, { r: {}, footer: { status: 108 } } as never, 10_000);
    expect(r.t.s.job?.refused).toMatchObject({ index: 2, status: 108 });
    expect(r.t.s.job?.phase).toBe('refused');
    expect(r.t.s.job?.message).toMatch(/^WARNING — The controller refused line 3 \(status 108/);
    expect(onJobResume(r.t, { intent: 'resume' }, 10_001)).toMatchObject({ allowed: false, reason: 'A line was refused.' });
    expect(r.t.s.job?.phase).toBe('refused');
    expect(r.fx.some((e) => e.kind === 'writeRealtime' && e.name === 'resume')).toBe(false);
    expect(onJobResume(r.t, { intent: 'resume', skip: true }, 10_002)).toEqual({ allowed: true });
    expect(r.t.s.job?.phase).toBe('running');
    expect(r.t.s.job?.refused).toBeNull();
    expect(r.fx.some((e) => e.kind === 'writeRealtime' && e.name === 'resume')).toBe(true);
  });

  it('a refusal answered while pausing: the hold already asked for is the refusal\'s; confirmed, the job stays refused (HELD)', async () => {
    const s = await ready();
    const r = tx({ ...s, base: 'RUNNING', job: { ...(s.job as JobState), phase: 'pausing', next: 3, acked: 2, confirmed: 0, pauseAt: 9000 } });
    onJobAnswer(r.t, { token: 'job', purpose: 'job', index: 2 }, { r: {}, footer: { status: 220 } } as never, 10_000);
    expect(r.t.s.job?.phase).toBe('refused');
    expect(r.fx.some((e) => e.kind === 'writeRealtime')).toBe(false); // no second `!`
    expect(onJobResume(r.t, { intent: 'resume', skip: true }, 10_001)).toMatchObject({ allowed: false, reason: 'The hold is not confirmed yet.' });
    r.t.s = { ...r.t.s, polled: { stat: 6, hold: 6, vel: 0, qr: 30, failed: false } };
    onJobPoll(r.t, 10_100);
    onJobPoll(r.t, 10_200);
    expect(r.t.s.base).toBe('HELD');
    expect(r.t.s.job?.phase).toBe('refused');
    expect(r.t.s.job?.confirmed).toBe(2);
    expect(onJobResume(r.t, { intent: 'resume' }, 10_300)).toMatchObject({ allowed: false });
    // A second refusal of a line already queued is only recorded.
    onJobAnswer(r.t, { token: 'job', purpose: 'job', index: 3 }, { r: {}, footer: { status: 220 } } as never, 10_400);
    expect(r.t.s.job?.refused).toMatchObject({ index: 2 });
    expect(r.t.s.job?.phase).toBe('refused');
  });

  it('(session) Pause right after Start, then a refusal of a line the board had queued: refused, Skip continues to the end', async () => {
    const h = await jobHarness({ rxm: 1 });
    model(h).injectRefusal(/^N3 /, 220, 1);
    const before = await start(h, zigzag(12));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'running', 10_000);
    expect(h.session.feedhold()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'refused' && h.session.state.job?.confirmed === 2, 15_000);
    expect(h.session.snapshot.base).toBe('HELD');
    expect(h.session.snapshot.job?.refused).toMatchObject({ line: 3, status: 220 });
    await h.run(1000);
    expect(h.session.snapshot.job?.phase).toBe('refused');
    expect(h.session.request({ intent: 'resume' })).toMatchObject({ allowed: false, reason: 'A line was refused.' });
    expect(writes(h).slice(before)).not.toContain('~');
    expect(h.session.request({ intent: 'resume', skip: true })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    expect(h.session.snapshot.job?.phase).toBe('done');
  });
});

describe('R5: a poll cycle confirms nothing unless every read was answered with status 0', () => {
  const rejected = (token: string) => `{"r":{"${token}":null},"f":[3,100,10]}`;
  const ok = (token: string, v: number) => `{"r":{"${token}":${v}},"f":[3,0,10]}`;
  const OK = '{"r":{},"f":[3,0,10]}';
  const BASE: Record<string, string> = { ...EN_ANSWERS, gc: OK, clear: '{"r":{"clear":null},"f":[3,0,10]}', home: '{"r":{"home":0},"f":[3,0,10]}', unit: '{"r":{"unit":1},"f":[3,0,10]}' };

  function connected(): Driver {
    const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    d.open();
    d.answer(BASE);
    return d;
  }

  /** Answers the line being written with `reply(token)`, through "the line being written comes last". */
  function answerWriting(d: Driver, reply: (token: string) => string): string {
    const token = d.writing as string;
    d.line(reply(token));
    return token;
  }

  it('(reviewer\'s case) two cycles of status-100 answers do not count as two confirmations: no M5 on stale live values, then W12 and FAULT', () => {
    const d = connected();
    d.state = { ...d.state, live: { ...d.state.live, ...AT_REST } }; // the live view says idle
    expect(d.intent({ intent: 'stopJob' })).toEqual({ allowed: true });
    const from = d.effects.length;
    const answered: string[] = [];
    for (let i = 0; i < 8; i++) answered.push(answerWriting(d, rejected));
    expect(answered).toEqual(['stat', 'hold', 'vel', 'qr', 'stat', 'hold', 'vel', 'qr']);
    expect(d.state.motion).toMatchObject({ op: 'stop', phase: 'hold', confirmed: 0 });
    expect(d.effects.slice(from).some((e) => e.kind === 'writeLine' && e.line === 'M5')).toBe(false);
    expect(d.state.polled).toBeNull();
    // The hold deadline passes with nothing confirmed: fail closed.
    d.at = 10_000;
    d.fire('motion');
    expect(d.state.fault).toMatchObject({ cause: 'stopNotConfirmed' });
    expect(d.state.motion).toBeNull();
  });

  it('a cycle with one rejected read, or a pushed report between its answers, confirms nothing; a whole cycle does', () => {
    const d = connected();
    d.state = { ...d.state, live: { ...d.state.live, ...AT_REST } };
    d.intent({ intent: 'stopJob' });
    // stat ok, hold rejected, vel ok, qr ok: not a confirmation.
    answerWriting(d, (t) => ok(t, 1));
    answerWriting(d, rejected);
    expect(d.state.polled).toMatchObject({ stat: 1, failed: true });
    answerWriting(d, (t) => ok(t, 0));
    answerWriting(d, (t) => ok(t, 32));
    expect(d.state.motion).toMatchObject({ phase: 'hold', confirmed: 0 });
    // A pushed report says "at rest" while the reads are refused: still nothing.
    answerWriting(d, (t) => ok(t, 1));
    d.line('{"sr":{"stat":1,"hold":0,"vel":0,"qr":32}}');
    answerWriting(d, rejected);
    answerWriting(d, rejected);
    answerWriting(d, rejected);
    expect(d.state.motion).toMatchObject({ phase: 'hold', confirmed: 0 });
    expect(d.state.live).toMatchObject(AT_REST);
    // Two whole cycles at rest: the stop finishes (idle: no `%`, then M5, M9, G90).
    const from = d.effects.length;
    for (let i = 0; i < 2; i++) {
      answerWriting(d, (t) => ok(t, 1));
      answerWriting(d, (t) => ok(t, 0));
      answerWriting(d, (t) => ok(t, 0));
      answerWriting(d, (t) => ok(t, 32));
    }
    expect(d.state.motion).toMatchObject({ phase: 'finish' });
    expect(d.effects.slice(from).filter((e) => e.kind === 'writeLine').map((e) => (e as Extract<SessionEffect, { kind: 'writeLine' }>).line).filter((l) => !l.startsWith('{'))).toEqual(['M5']);
  });

  it('a damaged stat answer leaves the cycle without a record until the next read; the cycle is then incomplete', () => {
    const d = connected();
    d.intent({ intent: 'stopJob' });
    expect(d.writing).toBe('stat');
    d.inbound({ kind: 'Garbled', reason: 'invalid-json', line: '{"r":' } as never);
    expect(d.state.polled).toBeNull();
    answerWriting(d, (t) => ok(t, 0)); // hold: a record starts here, without stat
    expect(d.state.polled).toEqual({ hold: 0, failed: false });
    expect(completedPoll(d.state)).toBeNull();
    answerWriting(d, (t) => ok(t, 0));
    answerWriting(d, (t) => ok(t, 32));
    expect(d.state.motion).toMatchObject({ phase: 'hold', confirmed: 0 });
    expect(d.state.polled).toBeNull();
  });

  it('the motion layer: an incomplete cycle resets the count and polls again, except during homing (its own timer polls)', async () => {
    const h = await jobHarness({ rxm: 1 });
    const s = h.session.state;
    const base = { ...s, polled: { stat: 1, failed: true }, queue: [], expected: [], writing: null };
    const hold = tx({ ...base, motion: { op: 'stop', phase: 'hold', jog: null, steps: [], reason: 'stopJob', confirmed: 1, deadline: 99_999, units: 1, dist: 0, returnTo: 'IDLE_UNHOMED', refusal: null, holdPolls: 1, queued: 0 } });
    onPollDone(hold.t, 1);
    expect(hold.t.s.motion?.confirmed).toBe(0);
    expect(hold.t.s.queue.filter((q) => q.purpose === 'poll').map((q) => q.token)).toEqual(['stat', 'hold', 'vel', 'qr']);
    const homing = tx({ ...base, motion: { op: 'home', phase: 'homing', jog: null, steps: [], reason: null, confirmed: 1, deadline: null, units: 1, dist: 0, returnTo: 'IDLE_UNHOMED', refusal: null, holdPolls: 0, queued: 0, axes: ['x'], seen: true } });
    onPollDone(homing.t, 1);
    expect(homing.t.s.motion?.confirmed).toBe(0);
    expect(homing.t.s.queue).toEqual([]);
    // A whole cycle at rest after the flush finishes the stop: M5, M9, G90 go out and the job lines still owed
    // (dropped by `%`, marked late) are forgotten.
    const flushed = tx({ ...base, base: 'STOPPING_JOB', polled: POLLED_REST, expected: [{ token: 'job', purpose: 'job', index: 4, late: true }], motion: { op: 'stop', phase: 'flush', jog: null, steps: [], reason: 'stopJob', confirmed: 1, deadline: 99_999, units: 1, dist: 0, returnTo: 'IDLE_UNHOMED', refusal: null, holdPolls: 2, queued: 0 } });
    onPollDone(flushed.t, 1);
    expect(flushed.t.s.motion?.phase).toBe('finish');
    expect(flushed.t.s.expected).toEqual([]);
    expect(flushed.t.s.queue.map((q) => q.line)).toEqual(['M5', 'M9', 'G90']);
  });

  it('the job layer: an incomplete cycle resets a drain, pause or resume count and polls again; while running it is ignored', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, 'G21 G90\nG1 X1 F600\nM30');
    const s = { ...h.session.state, polled: { stat: 1, hold: 0, failed: false }, queue: [], expected: [], writing: null };
    const draining = tx(withJob({ ...s, base: 'RUNNING' }, { phase: 'draining', stop: { kind: 'end', index: 2 }, confirmed: 1, acked: 3, next: 3 }));
    onJobPoll(draining.t, 1);
    expect(draining.t.s.job?.confirmed).toBe(0);
    expect(draining.t.s.job?.phase).toBe('draining');
    expect(draining.t.s.queue.filter((q) => q.purpose === 'poll')).toHaveLength(4);
    const running = tx(withJob({ ...s, base: 'RUNNING' }, { phase: 'running', confirmed: 0 }));
    onJobPoll(running.t, 1);
    expect(running.t.s.queue).toEqual([]);
    // A complete cycle at rest confirms as before.
    const whole = tx(withJob({ ...s, base: 'RUNNING', polled: POLLED_REST }, { phase: 'draining', stop: { kind: 'end', index: 2 }, confirmed: 1, acked: 3, next: 3 }));
    onJobPoll(whole.t, 1);
    expect(whole.t.s.job?.phase).toBe('done');
  });
});

describe('R6: the tool-change card comes only after M5 and M9 are answered', () => {
  const TC = ['G21 G90', 'M3 S10000', 'G1 X5 F600', 'T2 M6', 'G1 X0', 'M5', 'M30'].join('\n');

  it('(reviewer\'s case) drained at the tool change: the outputs are being turned off, the card is not shown yet', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, TC);
    const s = h.session.state;
    const i = (s.job as JobState).lines.findIndex((l) => l.toolChange !== undefined);
    const r = tx({ ...s, base: 'RUNNING', live: { ...s.live, ...AT_REST, spe: 1 }, polled: POLLED_REST, job: { ...(s.job as JobState), phase: 'draining', next: i, acked: i, confirmed: 1, stop: { kind: 'toolChange', index: i } } });
    onJobPoll(r.t, 10_000);
    expect(r.t.s.job?.phase).toBe('outputsOff');
    // The job's modes are read first, at rest (modes.ts), then M5 and M9.
    expect(r.t.s.queue.map((q) => q.line ?? `${q.purpose}:${q.token}`)).toEqual(['modes:unit', 'modes:dist', 'M5', 'M9']);
    expect(r.t.s.job?.message).not.toContain('turned the spindle and coolant off');
    expect(r.t.s.job?.message).toBe('Tool change at line 4: turning the spindle and coolant off (M5, M9). Wait for the card.');
    expect(r.t.s.job?.toolChange).toMatchObject({ index: i, tool: 2, units: undefined, dist: undefined });
    expect(r.t.s.base).toBe('PROGRAM_PAUSED');
    // Resume and a jog are not offered yet: the phase is not toolChange.
    expect(onJobResume(r.t, { intent: 'resume' }, 10_001)).toMatchObject({ allowed: false, reason: 'The job is not paused.' });
    expect(reduce(CONFIG, r.t.s, { type: 'intent', at: 10_002, request: { intent: 'jog', axes: { z: 1 }, distanceMm: 1, feed: 600 } }).effects.find((e) => e.kind === 'decision')).toMatchObject({ decision: { allowed: false } });
    // M5 answered: still waiting for M9. M9 answered: the card (W37).
    r.t.s = { ...r.t.s, queue: r.t.s.queue.slice(3), expected: [] };
    expect(onJobMotionAnswer(r.t, 'M5', 0, 10_003)).toBe(true);
    expect(r.t.s.job?.phase).toBe('outputsOff');
    r.t.s = { ...r.t.s, queue: [] };
    expect(onJobMotionAnswer(r.t, 'M9', 0, 10_004)).toBe(true);
    expect(r.t.s.job?.phase).toBe('toolChange');
    expect(r.t.s.job?.message).toMatch(/^WARNING — Tool change\. The job is stopped and Run turned the spindle and coolant off\./);
    expect(r.t.s.job?.events.at(-1)?.text).toBe('Spindle and coolant off (M5 and M9 answered). Tool change at line 4: T2.');
  });

  it('(session) the card and the change-ready state appear only once both lines are answered and the spindle is off', async () => {
    const h = await jobHarness({ rxm: 1 });
    const before = await start(h, TC);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'outputsOff', 20_000);
    expect(h.session.snapshot.base).toBe('PROGRAM_PAUSED');
    expect(h.session.snapshot.job?.message).not.toContain('turned the spindle and coolant off');
    await runUntil(h, () => h.session.snapshot.job?.phase === 'toolChange', 5000);
    expect(model(h).snapshot().spindle).toBe('off');
    expect(h.session.state.expected.some((e) => e.purpose === 'motion')).toBe(false);
    const w = writes(h).slice(before);
    expect(w.slice(w.indexOf('M5'), w.indexOf('M5') + 2)).toEqual(['M5', 'M9']);
    expect(h.session.snapshot.job?.message).toMatch(/^WARNING — Tool change\./);
    expect(h.session.request({ intent: 'resume', spindleRestart: true })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 30_000);
  });

  it('(session) M5 refused at the tool change: the job ends closed with the E-stop advice; no card, no resume', async () => {
    const h = await jobHarness({ rxm: 1 });
    model(h).injectRefusal(/^M5$/, 100, 1);
    await start(h, TC);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'failed', 20_000);
    const s = h.session.snapshot;
    expect(s.job?.message).toBe('The job ended at the tool change at line 4: the controller refused M5 (status 100). The spindle and coolant may still be on: use your E-stop or the controller\'s own stop.');
    expect(s.notices.adviseEstop).toBe(true);
    expect(s.base).toBe('IDLE_UNHOMED');
    expect(s.job?.toolChange).toBeNull();
    expect(h.session.request({ intent: 'resume' })).toMatchObject({ allowed: false });
    // Spindle off from idle still works: the user can turn it off by hand.
    expect(h.session.spindleOffNow()).toEqual({ allowed: true });
    await h.run(500);
    expect(model(h).snapshot().spindle).toBe('off');
  });

  it('M5 unanswered in time fails the job closed; a resume step unanswered leaves the job at the tool change; other phases ignore it', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, TC);
    const s = h.session.state;
    const tc = { index: 3, tool: 2, spindle: 'cw' as const, speed: 10_000, mist: false, flood: false, restartsSpindle: false, at: { x: 0, y: 0, z: 0 }, units: 1, dist: 0 };
    const owedM5: SessionState = { ...withJob({ ...s, base: 'PROGRAM_PAUSED' }, { phase: 'outputsOff', toolChange: tc }), queue: [{ token: 'gc', purpose: 'motion', line: 'M9', intent: 'spindleOffNow' }], expected: [{ token: 'gc', purpose: 'motion', line: 'M5', intent: 'spindleOffNow', late: false }], timers: { answer: 7 } };
    const r = reduce(CONFIG, owedM5, { type: 'timer', id: 'answer', seq: 7, at: 5000 });
    expect(r.state.job?.phase).toBe('failed');
    expect(r.state.job?.message).toContain('the controller did not answer M5 in time');
    expect(r.state.queue.some((q) => q.purpose === 'motion')).toBe(false);
    expect(r.state.notices.adviseEstop).toBe(true);
    const owedReturn: SessionState = { ...withJob({ ...s, base: 'PROGRAM_PAUSED' }, { phase: 'resuming', toolChange: tc, resumeSteps: [{ line: 'G53 G0 X0 Y0', intent: 'resume' }], passed: 3 }), queue: [{ token: 'gc', purpose: 'motion', line: 'G53 G0 X0 Y0', intent: 'resume' }], expected: [{ token: 'gc', purpose: 'motion', line: 'G53 G0 Z0', intent: 'resume', late: false }], timers: { answer: 8 } };
    const back = reduce(CONFIG, owedReturn, { type: 'timer', id: 'answer', seq: 8, at: 5000 });
    expect(back.state.job).toMatchObject({ phase: 'toolChange', resumeSteps: [], passed: null });
    expect(back.state.job?.events.at(-1)?.text).toBe('The controller did not answer G53 G0 Z0 in time; the job is still at the tool change.');
    expect(back.state.queue.some((q) => q.purpose === 'motion')).toBe(false);
    // Not the job layer's line: nothing changes (a running job, or no job).
    const running = tx(withJob(s, { phase: 'running' }));
    onJobMotionTimeout(running.t, 'M5', 1);
    expect(running.t.s.job?.phase).toBe('running');
    const none = tx({ ...s, job: null });
    onJobMotionTimeout(none.t, 'M5', 1);
    expect(none.t.s.job).toBeNull();
    expect(onJobMotionAnswer(none.t, 'M5', 0, 1)).toBe(false);
  });

  it('the card names no tool when the file names none; a tool-change record past the lines reads line 0', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, 'G21 G90\nG1 X1 F600\nM6\nG1 X0\nM30');
    const s = h.session.state;
    const tc = { index: 2, tool: null, spindle: 'off' as const, speed: null, mist: false, flood: false, restartsSpindle: false, at: {}, units: 1, dist: 0 };
    const r = tx(withJob({ ...s, base: 'PROGRAM_PAUSED', queue: [], expected: [] }, { phase: 'outputsOff', toolChange: tc }));
    expect(onJobMotionAnswer(r.t, 'M9', 0, 1)).toBe(true);
    expect(r.t.s.job?.events.at(-1)?.text).toBe('Spindle and coolant off (M5 and M9 answered). Tool change at line 3.');
    const past = tx(withJob({ ...s, base: 'PROGRAM_PAUSED', queue: [], expected: [] }, { phase: 'outputsOff', toolChange: { ...tc, index: 99 } }));
    onJobMotionAnswer(past.t, 'M9', 0, 1);
    expect(past.t.s.job?.events.at(-1)?.text).toBe('Spindle and coolant off (M5 and M9 answered). Tool change at line 0.');
    // A refusal of M9 after M5 was taken: the job still fails closed (named by the tool change's line, or 0 past the lines).
    const m9 = tx(withJob({ ...s, base: 'PROGRAM_PAUSED', queue: [], expected: [] }, { phase: 'outputsOff', toolChange: tc }));
    expect(onJobMotionAnswer(m9.t, 'M9', 3, 1)).toBe(true);
    expect(m9.t.s.job?.phase).toBe('failed');
    expect(m9.t.s.job?.message).toMatch(/^The job ended at the tool change at line 3: the controller refused M9 \(status 3\)/);
    const far = tx(withJob({ ...s, base: 'PROGRAM_PAUSED', queue: [], expected: [] }, { phase: 'outputsOff', toolChange: { ...tc, index: 99 } }));
    onJobMotionAnswer(far.t, 'M5', 3, 1);
    expect(far.t.s.job?.message).toMatch(/^The job ended at the tool change at line 0:/);
  });
});

describe('R7: a job answer with the firmware\'s gc echo is that line\'s answer', () => {
  it('(reviewer\'s case) {"r":{"gc":"N1 G21 G90"},"f":[3,0,10]} answers the owed job line instead of latching a FAULT', async () => {
    const h = await jobHarness({ rxm: 1 });
    await load(h, 'G21 G90\nM3 S10000\nG1 X5 F600\nT2 M6\nG1 X0\nM5\nM30');
    const s = h.session.state;
    const owed: SessionState = { ...s, base: 'RUNNING', job: { ...(s.job as JobState), phase: 'running', next: 1 }, queue: [], writing: null, expected: [{ token: 'job', purpose: 'job', index: 0, late: false }] };
    const r = reduce(CONFIG, owed, { type: 'inbound', epoch: s.epoch, at: 10_000, event: { kind: 'Response', line: '{"r":{"gc":"N1 G21 G90"},"f":[3,0,10]}', r: { gc: 'N1 G21 G90' }, footer: { rev: 3, status: 0, field3: 10, raw: [3, 0, 10] } } as never });
    // At jv 4 the echo is the N word alone; at jv 5 both.
    const n = reduce(CONFIG, owed, { type: 'inbound', epoch: s.epoch, at: 10_000, event: { kind: 'Response', line: '{"r":{"gc":"N1 G21 G90","n":1},"f":[3,0,10]}', r: { gc: 'N1 G21 G90', n: 1 }, footer: { rev: 3, status: 0, field3: 10, raw: [3, 0, 10] } } as never });
    expect(n.state.fault).toBeNull();
    expect(n.state.job?.acked).toBe(1);
    expect(r.state.fault).toBeNull();
    expect(r.state.overlays).not.toContain('FAULT');
    expect(r.state.expected.some((e) => e.purpose === 'job' && e.index === 0)).toBe(false);
    expect(r.state.job?.acked).toBe(1);
    expect(r.state.job?.free).toBe(10);
    // An echo with another key is still nobody's answer.
    const other = reduce(CONFIG, owed, { type: 'inbound', epoch: s.epoch, at: 10_000, event: { kind: 'Response', line: '{"r":{"gc":"N1","xvm":1},"f":[3,0,10]}', r: { gc: 'N1', xvm: 1 }, footer: { rev: 3, status: 0, field3: 10, raw: [3, 0, 10] } } as never });
    expect(other.state.fault).toMatchObject({ cause: 'unexpectedResponse' });
  });

  it('(session) a board another sender left at jv 5 echoes every job line; the job streams to the end, and run does not touch jv', async () => {
    const h = await jobHarness({ rxm: 1 });
    model(h).settings.setRam('jv', 5);
    const before = await start(h, zigzag(6));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    expect(h.session.snapshot.job?.phase).toBe('done');
    expect(h.session.snapshot.fault).toBeNull();
    expect(writes(h).slice(before).some((w) => w.includes('"jv"'))).toBe(false);
    expect(model(h).settings.num('jv')).toBe(5);
  });
});

describe('R8: the GET cap does not refuse a longer motion line', () => {
  it('(reviewer\'s case) a three-axis jog at F1234 (41-byte pieces) runs; no writeRefused FAULT', async () => {
    const h = await jobHarness({ rxm: 1 });
    const from = writes(h).length;
    expect(h.session.request({ intent: 'jog', axes: { x: -1, y: -1, z: -1 }, distanceMm: 10, feed: 1234 })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.motion === null, 20_000);
    expect(h.session.snapshot.fault).toBeNull();
    expect(h.session.snapshot.overlays).toEqual([]);
    const pieces = motionWrites(h, from).filter((w) => w.startsWith('G21 G91'));
    expect(pieces[0]).toBe('G21 G91 G1 X-3.085 Y-3.085 Z-3.085 F1234');
    expect(`${pieces[0] as string}\n`).toHaveLength(41);
    const p = h.device.snapshot().position;
    expect(p[0]).toBeCloseTo(-10, 3);
    expect(p[1]).toBeCloseTo(-10, 3);
    expect(p[2]).toBeCloseTo(-10, 3);
  });

  it('the gate: the GET cap applies to GETs, the motion cap to motion lines; a GET shape is still judged by the allowlist', () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    const ctx = { readable: (token: string) => token === 'stat', enqAllowed: false };
    const piece = 'G21 G91 G1 X-3.085 Y-3.085 Z-3.085 F1234\n';
    expect(piece).toHaveLength(41);
    expect(phase1WriteVerdict(enc(piece), { ...ctx, motion: true })).toEqual({ ok: true, kind: 'motion', lineKind: 'jog' });
    expect(phase1WriteVerdict(enc(piece), ctx)).toEqual({ ok: false, reason: 'a 41-byte write is not a GET, settings, report, motion or job line' });
    expect(phase1WriteVerdict(enc('G21 G91 G1 X-3.085 Y-3.085 F1234\n'), ctx)).toEqual({ ok: false, reason: 'a 33-byte write is not a GET line' });
    expect(phase1WriteVerdict(enc('G21 G91 G1 X-3.085 Y-3.085 Z-3.085 F12345\n'), { ...ctx, motion: true })).toEqual({ ok: false, reason: 'a 42-byte write is not a GET line or a motion line' });
    expect(phase1WriteVerdict(enc('{"stat":null}\n'), { ...ctx, motion: true })).toEqual({ ok: true, kind: 'get', token: 'stat' });
    expect(phase1WriteVerdict(enc('{"xvm":null}\n'), { ...ctx, motion: true })).toEqual({ ok: false, reason: '"xvm" is not readable now (not on the probe list or the dialect\'s read allowlist)' });
    expect(phase1WriteVerdict(enc('{"clear":null}\n'), { ...ctx, motion: true })).toEqual({ ok: true, kind: 'motion', lineKind: 'clear' });
    expect(phase1WriteVerdict(enc('{"clear":null}\n'), ctx)).toEqual({ ok: false, reason: '"clear" is not readable now (not on the probe list or the dialect\'s read allowlist)' });
    expect(phase1WriteVerdict(enc('G0 X1\n'), { ...ctx, motion: true })).toEqual({ ok: false, reason: 'not a single-token GET: "G0 X1\\n"' });
    // A 64-byte motion-shaped line is within the motion cap; 65 is not (the cap, not the grammar, refuses it).
    const long = `G21 G91 G1 X-1234.5678 Y-1234.5678 Z-1234.5678 A-1234.5678 F1\n`;
    expect(long.length).toBeLessThanOrEqual(64);
    expect(phase1WriteVerdict(enc(long), { ...ctx, motion: true })).toMatchObject({ ok: true, kind: 'motion' });
  });
});
