import { describe, expect, it } from 'vitest';
import { jobHarness, jobLines, runUntil, start, zigzag } from './jobHarness.ts';
import { model } from './jobLayerHarness.ts';

describe('T-S113: breakpoints and program stops (H75, H36)', () => {
  it('stops before a breakpoint line with the queue drained, and Resume goes on from it', async () => {
    const h = await jobHarness();
    const before = await start(h, zigzag(12), [8]);
    await runUntil(h, () => h.session.snapshot.job?.phase === 'breakpoint');
    const s = h.session.snapshot;
    expect(s.job?.message).toBe('Stopped at breakpoint · line 8');
    expect(s.job?.acked).toBe(s.job?.sent);
    expect(jobLines(h, before).at(-1)).toMatch(/^N7 /);
    expect(model(h).snapshot().hold).toBe(0);
    h.session.request({ intent: 'resume' });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    expect(jobLines(h, before).filter((l) => l.startsWith('N8 '))).toHaveLength(1);
  });
});

describe('T-S113: breakpoints and program stops (H75, H36)', () => {
  it('a breakpoint set on a line already queued is reported as one that cannot be honoured (W41)', async () => {
    const h = await jobHarness();
    await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.sent ?? 0) > 8);
    const queued = h.session.snapshot.job?.sentThrough as number;
    expect(h.session.setBreakpoints([queued])).toEqual({ allowed: true });
    expect(h.session.snapshot.job?.events.at(-1)?.text).toBe(`Line ${queued} is already queued on the controller, so a breakpoint there cannot stop the job.`);
    expect(h.session.setBreakpoints([0])).toMatchObject({ allowed: false });
  });
});

describe('T-S113: breakpoints and program stops (H75, H36)', () => {
  it('an M0 is a host barrier: nothing after it is sent until the machine has drained (H36)', async () => {
    const h = await jobHarness();
    const before = await start(h, ['G21 G90', 'G1 X5 F600', 'M0', 'G1 X0', 'M30'].join('\n'));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'programStop');
    expect(jobLines(h, before).at(-1)).toMatch(/^N3 M0/);
    h.session.request({ intent: 'resume' });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done');
    expect(h.session.snapshot.job?.phase).toBe('done');
  });
});
