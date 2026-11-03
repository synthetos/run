/**
 * Phase 3 jobs at the reducer and the write gate (SAFETY §4.4a; T-S109, T-S114): the events a real run rarely
 * produces (a job line the executor did not write, a damaged answer while job lines are owed, a fault during the
 * line-mode step, the STALE limit through the timer), and the exact shapes of the job line kinds.
 */
import type { Inbound } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import {
  jobLineWritableIn,
  jobRuntimeWritableIn,
  lineModeWritableIn,
  phase1WriteVerdict,
  reduce,
  snapshotOf,
  type JobState,
  type SessionEvent,
  type SessionState,
} from '../src/index.ts';
import { checkAlarm } from '../src/session/motion.ts';
import { DEFAULT_TIMINGS } from '../src/session/types.ts';
import { EN_APPROVED, JOBS_RELEASE, jobHarness, load, runUntil, start, writes, zigzag } from './jobHarness.ts';

const CONFIG = { release: JOBS_RELEASE, manifest: EN_APPROVED, timings: DEFAULT_TIMINGS };

async function readyState(): Promise<SessionState> {
  const h = await jobHarness();
  await load(h, 'G21 G90\nG1 X5 F600\nG1 X0\nM30');
  return h.session.state;
}

function withJob(s: SessionState, patch: Partial<JobState>): SessionState {
  return { ...s, job: { ...(s.job as JobState), ...patch } };
}

const inbound = (s: SessionState, event: Inbound): SessionEvent => ({ type: 'inbound', epoch: s.epoch, at: 10_000, event });

describe('reducer edges of the job layer', () => {
  it('a job line the executor did not write is sent again from there', async () => {
    const s = withJob(await readyState(), { phase: 'running', next: 3 });
    const owed: SessionState = { ...s, expected: [{ token: 'job', purpose: 'job', index: 1, late: false }, { token: 'job', purpose: 'job', index: 2, late: false }] };
    const { state } = reduce(CONFIG, owed, { type: 'lineDropped', epoch: s.epoch, seq: 9, index: 2 });
    expect(state.job?.next).toBe(2);
    expect(state.expected.map((e) => e.index)).toEqual([1]);
    const later = reduce(CONFIG, { ...owed, job: { ...(owed.job as JobState), next: 1 } }, { type: 'lineDropped', epoch: s.epoch, seq: 9, index: 2 });
    expect(later.state.job?.next).toBe(1);
    const none = reduce(CONFIG, { ...owed, job: null }, { type: 'lineDropped', epoch: s.epoch, seq: 9, index: 2 });
    expect(none.state.job).toBeNull();
  });

  it('a prep read or a line-mode read that times out ends the load or the step', async () => {
    const s = await readyState();
    const prep: SessionState = { ...withJob(s, { phase: 'loading', source: { text: 'G0', c22: false } }), expected: [{ token: 'x', purpose: 'jobPrep', late: false }], timers: { answer: 7 } };
    expect(reduce(CONFIG, prep, { type: 'timer', id: 'answer', seq: 7, at: 1 }).state.job?.phase).toBe('blocked');
    const mode: SessionState = { ...s, rxm: { ...s.rxm, step: { kind: 'write', purpose: 'restore', value: 0 } }, expected: [{ token: 'rxm', purpose: 'lineMode', late: false, value: 0 }], timers: { answer: 7 } };
    expect(reduce(CONFIG, mode, { type: 'timer', id: 'answer', seq: 7, at: 1 }).state.rxm.step).toBeNull();
  });

  it('a damaged answer: a FAULT while job lines are owed; else the prep read, line-mode step or rt line it answered', async () => {
    const s = await readyState();
    const garbled: Inbound = { kind: 'Garbled', reason: 'invalid-json', line: '{"r":' } as never;
    const jobOwed: SessionState = { ...withJob(s, { phase: 'running' }), base: 'RUNNING', expected: [{ token: 'job', purpose: 'job', index: 0, late: false }] };
    expect(reduce(CONFIG, jobOwed, inbound(s, garbled)).state.overlays).toContain('FAULT');
    const prep: SessionState = { ...withJob(s, { phase: 'loading', source: { text: 'G21\nM30', c22: false } }), expected: [{ token: 'x', purpose: 'jobPrep', late: false }] };
    expect(reduce(CONFIG, prep, inbound(s, garbled)).state.job?.phase).toBe('ready');
    const mode: SessionState = { ...s, rxm: { ...s.rxm, step: { kind: 'readback', purpose: 'restore', value: 0 } }, expected: [{ token: 'rxm', purpose: 'lineMode', late: false }] };
    expect(reduce(CONFIG, mode, inbound(s, garbled)).state.rxm.step).toBeNull();
    const rt: SessionState = { ...s, expected: [{ token: 'rt', purpose: 'jobRuntime', line: '{"rt":{"fi":2}}', late: false }] };
    expect(reduce(CONFIG, rt, inbound(s, garbled)).state.overlays).not.toContain('FAULT');
  });

  it('a fault during the line-mode step ends the step; a status report of an alarm ends the job', async () => {
    const s = await readyState();
    const mode: SessionState = { ...withJob(s, { phase: 'preparing' }), base: 'PREAMBLE', rxm: { ...s.rxm, step: { kind: 'write', purpose: 'job', value: 1 }, footerExpect: 3 } };
    const { state } = reduce(CONFIG, mode, { type: 'writeFailed', epoch: s.epoch, at: 1, detail: 'gone' });
    expect(state.rxm.step).toBeNull();
    expect(state.rxm.footerExpect).toBeNull();
    // An alarm report with no `er` (checkAlarm, motion.ts) during a job ends it.
    const running: SessionState = { ...withJob(s, { phase: 'running' }), base: 'RUNNING', live: { ...s.live, stat: 2 } };
    const t = { s: running, config: CONFIG, set(p: Partial<SessionState>) { t.s = { ...t.s, ...p }; }, emit() {}, arm() {}, cancel() {} };
    expect(checkAlarm(t, 1)).toBe(false);
    expect(t.s.base).toBe('ALARM');
    expect(t.s.job?.message).toMatch(/^The controller alarmed at line \d+ and stopped the job/);
  });

  it('a line in character mode waits while any line is owed; a footer that changes when no change is expected is a FAULT', async () => {
    const s = await readyState();
    const charMode: SessionState = { ...s, footerRev: 2, queue: [{ token: 'stat', purpose: 'poll' }], expected: [{ token: 'job', purpose: 'job', index: 0, late: false }] };
    expect(reduce(CONFIG, charMode, { type: 'driftDetected', epoch: s.epoch }).effects.some((e) => e.kind === 'writeLine')).toBe(false);
    const expectWrong: SessionState = { ...s, footerRev: 3, rxm: { ...s.rxm, step: { kind: 'write', purpose: 'restore', value: 0 }, footerExpect: 2 }, expected: [{ token: 'stat', purpose: 'poll', late: false }] };
    const resp = { kind: 'Response', line: '{"r":{"stat":1},"f":[1,0,0]}', r: { stat: 1 }, footer: { rev: 1, status: 0, field3: 0, raw: [] } } as never;
    expect(reduce(CONFIG, expectWrong, inbound(s, resp)).state.fault?.cause).toBe('footerRevisionChanged');
  });

  it('STALE for the limit while a job runs is a liveness FAULT, through the job timer', async () => {
    const s = await readyState();
    const stale: SessionState = { ...withJob(s, { phase: 'running' }), base: 'RUNNING', overlays: ['STALE'], stale: { at: 0, silentForMs: 3000 }, timers: { job: 4 } };
    const { state } = reduce(CONFIG, stale, { type: 'timer', id: 'job', seq: 4, at: 10_000 });
    expect(state.fault).toMatchObject({ cause: 'staleWhileRunning', kind: 'liveness' });
    expect(state.job?.faultStopAt).toBe(10_000 + 20_000);
  });

  it('Spindle off at a stop point (nothing queued) sends M5 and M9 alone and keeps the job', async () => {
    const h = await jobHarness();
    const before = await start(h, zigzag(8), [5]);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'breakpoint');
    expect(h.session.spindleOffNow()).toEqual({ allowed: true });
    await h.run(500);
    expect(h.session.snapshot.job?.phase).toBe('breakpoint');
    const w = writes(h).slice(before);
    expect(w.slice(-6).filter((x) => x === 'M5' || x === 'M9')).toEqual(['M5', 'M9']);
    expect(w).not.toContain('%');
  });
});

describe('the write gate of the job line kinds', () => {
  it('a job line only as the exact line emitted, for jobLine; the line-mode and rt kinds only when asked for', async () => {
    const s = withJob(await readyState(), { phase: 'running', next: 2 });
    const line = (s.job as JobState).lines[1]?.text as string;
    const bytes = (text: string) => new TextEncoder().encode(`${text}\n`);
    const ctx = { readable: () => true, enqAllowed: false, motion: true };
    expect(phase1WriteVerdict(bytes(line), { ...ctx, jobLine: (t) => t === line })).toMatchObject({ ok: true, kind: 'job' });
    expect(phase1WriteVerdict(bytes(line), ctx).ok).toBe(false);
    expect(phase1WriteVerdict(bytes('{"rxm":1}'), ctx)).toMatchObject({ ok: false, reason: 'the line-mode setting is not written in this release' });
    expect(phase1WriteVerdict(bytes('{"rxm":1}'), { ...ctx, lineModeWritable: () => false }).ok).toBe(false);
    expect(phase1WriteVerdict(bytes('{"rxm":1}'), { ...ctx, lineModeWritable: () => true })).toMatchObject({ ok: true, kind: 'lineMode' });
    expect(phase1WriteVerdict(bytes('{"rt":{"fi":2}}'), ctx).ok).toBe(false);
    expect(phase1WriteVerdict(bytes('{"rt":{"job":1}}'), { ...ctx, jobRuntimeWritable: () => true })).toMatchObject({ ok: true, kind: 'jobRuntime' });
    expect(jobLineWritableIn(s, 1, line)).toBe(true);
    for (const index of [undefined, -1, 1.5, 2]) expect(jobLineWritableIn(s, index, line)).toBe(false);
    expect(jobLineWritableIn({ ...s, job: null }, 1, line)).toBe(false);
    expect(lineModeWritableIn({ ...s, rxm: { ...s.rxm, step: { kind: 'write', purpose: 'job', value: 1 } } }, '{"rxm":1}')).toBe(true);
    expect(lineModeWritableIn({ ...s, rxm: { ...s.rxm, step: { kind: 'read', purpose: 'job', value: 1 } } }, '{"rxm":1}')).toBe(false);
    expect(jobRuntimeWritableIn({ ...s, job: null }, '{"rt":{"fi":2}}')).toBe(false);
    const pending = { ...s, queue: [{ token: 'rt', purpose: 'jobRuntime' as const, line: '{"rt":{"job":1}}' }], writing: { token: 'rt', purpose: 'jobRuntime' as const, line: '{"rt":{"fi":2}}', seq: 1 } };
    expect(jobRuntimeWritableIn(pending, '{"rt":{"job":1}}')).toBe(false);
    expect(jobRuntimeWritableIn({ ...pending, rtLeaves: ['job', 'fi'] }, '{"rt":{"job":1}}')).toBe(true);
    expect(jobRuntimeWritableIn({ ...pending, rtLeaves: ['fi'] }, '{"rt":{"fi":2}}')).toBe(true);
    expect(jobRuntimeWritableIn(pending, '{"rt":{"fi":3}}')).toBe(false);
    expect(jobRuntimeWritableIn({ ...pending, writing: null, rtLeaves: ['job'] }, '{"rt":{"job":1}}')).toBe(true);
  });
});

describe('the job snapshot', () => {
  it('caps long texts, bounds queued travel (unbounded when a line cannot be bounded), maps lines to file lines', async () => {
    const s = await readyState();
    const job = s.job as JobState;
    const lines = job.lines.map((l, i) => (i === 1 ? { ...l, motion: { plannerLength: 1, boundMm: null, seconds: 1 } } : l));
    const st: SessionState = { ...withJob(s, { phase: 'running', startedAt: 0, next: 3, lines, message: 'x'.repeat(700) }), live: { ...s.live, line: 1 } };
    const v = snapshotOf(st).job;
    expect(v?.message?.length).toBe(601);
    expect(v?.queuedBoundMm).toBeNull();
    expect(v?.executing).toEqual({ n: 1, line: 1 });
    const stopped = snapshotOf({ ...st, job: { ...(st.job as JobState), stop: { kind: 'end', index: 99 } } }).job;
    expect(stopped?.stop?.line).toBeNull();
  });
});
