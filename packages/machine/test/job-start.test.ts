import { describe, expect, it } from 'vitest';
import {
  type SessionState
} from '../src/index.ts';
import {
  onJobBreakpoints,
  onLoadJob,
  onStartJob
} from '../src/session/job.ts';
import { CONFIRM, JOBS_RELEASE } from './jobHarness.ts';
import { ready, tx, why, withJob } from './jobLayerHarness.ts';

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
});
