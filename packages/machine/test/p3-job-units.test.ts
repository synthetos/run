import { describe, expect, it } from 'vitest';
import {
    JOB_LIMITS,
    feedLimitLine,
    jobFlagLine,
    rxmLine,
    slotRoom,
    textHash,
    type JobState,
    type SessionState
} from '../src/index.ts';
import {
    abandonLoad,
    feedLimitWindow,
    onFeedLimit,
    onJobBreakpoints,
    onJobFault,
    onJobPause,
    onJobPoll,
    onJobResume,
    onJobRuntimeAnswer,
    onJobStop,
    onJobTimer,
    onLoadJob,
    onStartJob,
    pumpJob,
    queuedLine
} from '../src/session/job.ts';
import { CONFIRM, JOBS_RELEASE } from './jobHarness.ts';
import { deps, ready, tx, why, withJob } from './jobLayerHarness.ts';
describe('plain words and lines', () => {


  it('the exact lines and the text hash', () => {
    expect(rxmLine(1)).toBe('{"rxm":1}');
    expect(jobFlagLine(0)).toBe('{"rt":{"job":0}}');
    expect(feedLimitLine(2.4)).toBe('{"rt":{"fi":2}}');
    expect(textHash('a')).toBe(textHash('a'));
    expect(textHash('a')).not.toBe(textHash('b'));
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
});
describe('more of the job layer, through its edges', () => {


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
