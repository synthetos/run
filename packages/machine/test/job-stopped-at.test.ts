/**
 * A job that ended early holds where it ended (first-time walk 2026-11-08, S7): `stoppedAt` is the last line the
 * board took when the stop finished, the same line as "Stopped at line N", and the board's later reports never
 * move it. The page draws the job card's progress from it.
 */
import { describe, expect, it } from 'vitest';
import { jobHarness, runUntil, start, zigzag } from './jobHarness.ts';

describe('stoppedAt (S7)', () => {
  it('Stop job records the stop line, matching W42, and it does not move afterwards', async () => {
    const h = await jobHarness({ rxm: 0 });
    await start(h, zigzag(30));
    await runUntil(h, () => (h.session.snapshot.job?.acked ?? 0) > 6);
    expect(h.session.stopJob()).toEqual({ allowed: true });
    await runUntil(h, () => h.session.snapshot.job?.phase === 'stopped' && h.session.snapshot.footerRev === 2);
    const job = h.session.snapshot.job;
    const at = job?.stoppedAt;
    expect(at).not.toBeNull();
    expect(job?.message).toBe(`Stopped at line ${String(at?.line)}: queue cleared, spindle and coolant off`);
    expect(at?.n ?? 0).toBeGreaterThan(0);
    expect(at?.n ?? 0).toBeLessThan(job?.total ?? 0);
    await runUntil(h, () => false, 1500);
    expect(h.session.snapshot.job?.stoppedAt).toEqual(at);
  });

  it('a job that runs to its end has no stop line', async () => {
    const h = await jobHarness({ rxm: 0 });
    await start(h, zigzag(3));
    await runUntil(h, () => h.session.snapshot.job?.phase === 'done', 60_000);
    expect(h.session.snapshot.job?.stoppedAt).toBeNull();
  });
});
