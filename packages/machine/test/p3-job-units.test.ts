import { describe, expect, it } from 'vitest';
import {
  JOB_LIMITS, feedLimitLine,
  jobFlagLine, rxmLine, slotRoom, textHash,
  type JobState, type SessionState
} from '../src/index.ts';
import {
  abandonLoad,
  feedLimitWindow,
  onFeedLimit,
  onJobBreakpoints,
  onJobPause,
  onJobResume,
  onJobRuntimeAnswer,
  onJobStop,
  pumpJob,
  queuedLine
} from '../src/session/job.ts';
import { JOBS_RELEASE } from './jobHarness.ts';
import { ready, tx, why, withJob } from './jobLayerHarness.ts';

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
});

describe('the guards of the job decisions', () => {
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
    checkFeedSummaries(f);
    onFeedLimit(tx(s).t, 'fs', {}, false);
    const loading = tx({ ...withJob(s, { phase: 'loading' }), queue: [{ token: 'x', purpose: 'jobPrep' }] });
    abandonLoad(loading.t, 0, 'gone');
    expect(loading.t.s.job?.phase).toBe('blocked');
    expect(loading.t.s.queue).toEqual([]);
    expect(slotRoom({ ...s, job: null })).toBe(0);
    pumpJob(tx(withJob({ ...s, base: 'RUNNING', footerRev: 3 }, { phase: 'running', free: 10 })).t, false);
  });
});

function checkFeedSummaries(f: ReturnType<typeof tx>): void {
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
}
