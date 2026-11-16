import { describe, expect, it } from 'vitest';
import { JOB_LIMITS, type JobState } from '../src/index.ts';
import {
  onJobFault,
  onJobPoll,
  onJobTimer
} from '../src/session/job.ts';
import { deps, ready, tx, withJob } from './jobLayerHarness.ts';

describe('the guards of the job decisions', () => {
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
});

describe('the guards of the job decisions', () => {
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
});

describe('more of the job layer, through its edges', () => {
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
});

describe('more of the job layer, through its edges', () => {
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
