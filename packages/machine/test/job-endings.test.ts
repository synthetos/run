import { describe, expect, it } from 'vitest';
import { JOB_LIMITS, type JobState } from '../src/index.ts';
import {
  onJobFault,
  onJobLinkLost,
  onJobReset
} from '../src/session/job.ts';
import { failJob, jobStopped, lastFileLine } from '../src/session/jobState.ts';
import { jobHarness, runUntil, start, writes, zigzag } from './jobHarness.ts';
import { model, ready, tx, withJob } from './jobLayerHarness.ts';

describe('T-S114: a reset, a lost link or an alarm during a job (H71, H72)', () => {
  it('a reset mid-job is a FAULT with W40; nothing more is written to the board', async () => {
    const h = await jobHarness();
    await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 5);
    model(h).resetBoard();
    await runUntil(h, () => h.session.snapshot.overlays.includes('FAULT'));
    const at = writes(h).length;
    await h.run(5000);
    const s = h.session.snapshot;
    expect(s.fault?.cause).toBe('bannerAfterReady');
    expect(s.overlays).toContain('UNKNOWN');
    expect(s.job?.phase).toBe('failed');
    expect(s.job?.message).toMatch(/^DANGER — The controller reset during the job at line \d+\. Everything queued is gone/);
    expect(writes(h).slice(at).some((w) => w.startsWith('N'))).toBe(false);
  });
});

describe('T-S114: a reset, a lost link or an alarm during a job (H71, H72)', () => {
  it('a lost link ends the job (LOST)', async () => {
    const h = await jobHarness();
    await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 5);
    h.endpoint.disconnect();
    await h.run(100);
    expect(h.session.snapshot.overlays).toContain('LOST');
    expect(h.session.snapshot.job?.phase).toBe('failed');
    expect(h.session.snapshot.job?.message).toMatch(/^The connection was lost at line/);
  });
});

describe('T-S114: a reset, a lost link or an alarm during a job (H71, H72)', () => {
  it('an alarm (a limit switch) ends the job and the session is in ALARM', async () => {
    const h = await jobHarness();
    await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 5);
    model(h).injectLimitSwitch(1);
    await runUntil(h, () => h.session.snapshot.base === 'ALARM');
    await h.run(2000);
    // The alarm's `er` latches a FAULT; the controller has already flushed and turned its outputs off, so no
    // flush sequence is sent into the alarm.
    expect(h.session.snapshot.job?.phase).toBe('failed');
    expect(h.session.snapshot.job?.message).toMatch(/^The job ended at line \d+: the board reported an exception \(status 203\)/);
    expect(h.session.snapshot.job?.stopping).toBe(false);
  });
});

describe('the guards of the job decisions', () => {
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
});

describe('the guards of the job decisions', () => {
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
