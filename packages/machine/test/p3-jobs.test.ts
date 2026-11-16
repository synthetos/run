import { w42 } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { jobHarness, jobLines, runUntil, start, writes, zigzag } from './jobHarness.ts';
import { SMALL, model } from './jobLayerHarness.ts';
describe('T-S110: Pause, Resume and Stop job (SAFETY §4.4a)', () => {

  it('Pause writes ! and the job holds; Resume writes ~ and streaming goes on to the end', async () => {
    const h = await jobHarness();
    const before = await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 6);
    expect(h.session.feedhold()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'paused');
    expect(h.session.snapshot.base).toBe('HELD');
    const sentAtPause = h.session.snapshot.job?.sent ?? 0;
    await h.run(2000);
    expect(h.session.snapshot.job?.sent).toBe(sentAtPause);
    expect(model(h).snapshot().hold).toBe(6);
    expect(h.session.request({ intent: 'resume' })).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 90_000);
    const w = writes(h).slice(before);
    expect(w).toContain('!');
    expect(w.indexOf('~')).toBeGreaterThan(w.indexOf('!'));
    expect(jobLines(h, before)).toHaveLength(h.session.snapshot.job?.total as number);
  });


  it('Stop job: !, % once held, M5, M9; "Stopped at line N"; nothing more is sent; rxm put back', async () => {
    const h = await jobHarness({ rxm: 0 });
    const before = await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 6);
    expect(h.session.stopJob()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped' && h.session.snapshot.footerRev === 2);
    const s = h.session.snapshot;
    const w = writes(h).slice(before);
    const bang = w.indexOf('!');
    const tail = w.slice(bang).filter((x) => !x.startsWith('{"') && x !== '\\x05');
    expect(tail.slice(0, 5)).toEqual(['!', '%', 'M5', 'M9', 'G90']);
    expect(w.slice(bang).some((x) => x.startsWith('N'))).toBe(false);
    expect(s.job?.message).toMatch(/^Stopped at line \d+: queue cleared, spindle and coolant off$/);
    expect(s.base).toBe('IDLE_UNHOMED');
    expect(model(h).snapshot().hold).toBe(0);
    expect(w).toContain('{"rxm":0}');
    expect(w42({ line: 3 })).toBe('Stopped at line 3: queue cleared, spindle and coolant off');
  });


  it('Stop job after a Pause and a Resume still reaches stopped: late job answers do not swallow M5 (H76)', async () => {
    const h = await jobHarness();
    const before = await start(h, zigzag(40));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 5);
    h.session.feedhold();
    await runUntil(h, () => h.session.snapshot.job?.phase === 'paused');
    expect(h.session.request({ intent: 'resume' })).toEqual({ allowed: true });
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 14);
    expect(h.session.stopJob()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped');
    const w = writes(h).slice(before);
    const tail = w.slice(w.lastIndexOf('!')).filter((x) => !x.startsWith('{"') && x !== '\\x05');
    expect(tail.slice(0, 5)).toEqual(['!', '%', 'M5', 'M9', 'G90']);
    expect(h.session.snapshot.motion).toBeNull();
  });


  it('Spindle off during a running job ends it like Stop job', async () => {
    const h = await jobHarness();
    await start(h, zigzag(20));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 4);
    expect(h.session.spindleOffNow()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped');
    expect(h.session.snapshot.job?.phase).toBe('stopped');
  });


  it('Stop job while preparing (before the first line) sends nothing of the job', async () => {
    const h = await jobHarness({ rxm: 1 });
    const before = await start(h, SMALL);
    h.session.stopJob();
    await h.run(2000);
    expect(jobLines(h, before)).toEqual([]);
    expect(h.session.snapshot.job?.phase).toBe('stopped');
  });
});
