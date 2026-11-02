/**
 * §6.2 live chipload: a rolling window over status reports, rapids and holds
 * excluded, the cause told apart by qr. The spindle speed is the commanded
 * one: TinyG has no spindle sensor.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_DEFAULTS, LIVE_MAX_SAMPLES, LiveChiploadWindow, STAT_RUN, estimateLiveChipload, type StatusSample } from '../src/index.ts';

const OPTIONS = { flutes: 2, commandedRpm: 18_000 };

/** Reports every 250 ms ending at t = 10 s. */
function reports(n: number, over: Partial<StatusSample> = {}): StatusSample[] {
  return Array.from({ length: n }, (_, i) => ({ t: 10_000 - (n - 1 - i) * 250, vel: 1110, feed: 1500, qr: 24, stat: STAT_RUN, line: 100 + i, ...over }));
}

describe('estimateLiveChipload', () => {
  it('fz_live = mean vel / (commanded rpm · z), and says the speed is the commanded one', () => {
    const e = estimateLiveChipload(reports(12), OPTIONS);
    expect(e.status).toBe('ok');
    expect(e.rpmSource).toBe('commanded');
    expect(e.rpm).toBe(18_000);
    expect(e.fzLive).toBeCloseTo(1110 / (18_000 * 2), 12);
    expect(e.feedRatio).toBeCloseTo(0.74, 12);
    expect(e.windowMs).toBe(3000);
    expect(e.samples).toBe(12);
  });

  it('uses a measured speed only when asked to (off by default)', () => {
    expect(estimateLiveChipload(reports(12), { ...OPTIONS, measuredRpm: 15_000 })).toMatchObject({ rpm: 18_000, rpmSource: 'commanded' });
    expect(estimateLiveChipload(reports(12), { ...OPTIONS, measuredRpm: 15_000, useMeasuredRpm: true })).toMatchObject({ rpm: 15_000, rpmSource: 'measured' });
    expect(estimateLiveChipload(reports(12), { ...OPTIONS, measuredRpm: Number.NaN, useMeasuredRpm: true })).toMatchObject({ rpm: 18_000, rpmSource: 'commanded' });
    expect(estimateLiveChipload(reports(12), { ...OPTIONS, measuredRpm: 0, useMeasuredRpm: true })).toMatchObject({ rpmSource: 'commanded' });
    expect(estimateLiveChipload(reports(12), { ...OPTIONS, useMeasuredRpm: true })).toMatchObject({ rpmSource: 'commanded' });
  });

  it('classifies the cause from qr: starving when buffers are free, machine-limited when full', () => {
    expect(estimateLiveChipload(reports(12, { qr: 24 }), OPTIONS).cause).toBe('planner-starving');
    expect(estimateLiveChipload(reports(12, { qr: 20 }), OPTIONS).cause).toBe('planner-starving');
    expect(estimateLiveChipload(reports(12, { qr: 11 }), OPTIONS).cause).toBe('machine-limited');
    expect(estimateLiveChipload(reports(12, { qr: 12 }), OPTIONS).cause).toBe('machine-limited');
    expect(estimateLiveChipload(reports(12, { qr: 16 }), OPTIONS).cause).toBe('unclear');
    expect(estimateLiveChipload(reports(12, { vel: 1450 }), OPTIONS).cause).toBe('none');
    expect(estimateLiveChipload(reports(12, { qr: 16 }), { ...OPTIONS, qrStarvingAtOrAbove: 15 }).cause).toBe('planner-starving');
    expect(estimateLiveChipload(reports(12, { qr: 16 }), { ...OPTIONS, qrFullAtOrBelow: 16 }).cause).toBe('machine-limited');
  });

  it('excludes holds, rapids, corner stops and malformed reports', () => {
    const samples = [
      ...reports(8),
      { t: 9000, vel: 0, feed: 1500, qr: 24, stat: 6, line: 1 },
      { t: 9100, vel: 4000, feed: 1500, qr: 24, stat: STAT_RUN, line: 2 },
      { t: 9200, vel: 1000, feed: 1500, qr: 24, stat: STAT_RUN, line: 3, momo: 0 },
      { t: 9300, vel: 100, feed: 1500, qr: 24, stat: STAT_RUN, line: 4 },
      { t: 9400, vel: Number.NaN, feed: 1500, qr: 24, stat: STAT_RUN, line: 5 },
      { t: 9500, vel: 1000, feed: 0, qr: 24, stat: STAT_RUN, line: 6 },
      { t: Number.POSITIVE_INFINITY, vel: 1000, feed: 1500, qr: 24, stat: STAT_RUN, line: 7 },
      { t: 9600, vel: -1, feed: 1500, qr: 24, stat: STAT_RUN, line: 8 },
      { t: 9700, vel: 1000, feed: 1500, qr: Number.NaN, stat: STAT_RUN, line: 9 },
      { t: 9800, vel: 1000, feed: 1500, qr: 24, stat: STAT_RUN, line: 10, momo: 1 },
    ];
    const e = estimateLiveChipload(samples, OPTIONS);
    expect(e.excluded).toEqual({ invalid: 5, notRunning: 1, rapid: 2, ramp: 1 });
    expect(e.samples).toBe(9);
  });

  it('keeps only the window (2-5 s, clamped) ending at the newest report', () => {
    const old = reports(40); // 10 s of reports
    expect(estimateLiveChipload(old, OPTIONS).samples).toBe(12);
    expect(estimateLiveChipload(old, { ...OPTIONS, windowMs: 500 })).toMatchObject({ windowMs: 2000, samples: 8 });
    expect(estimateLiveChipload(old, { ...OPTIONS, windowMs: 60_000 })).toMatchObject({ windowMs: 5000, samples: 20 });
    expect(estimateLiveChipload(old, { ...OPTIONS, windowMs: Number.NaN }).windowMs).toBe(LIVE_DEFAULTS.windowMs);
  });

  it('needs enough usable reports', () => {
    expect(estimateLiveChipload(reports(4), OPTIONS)).toMatchObject({ status: 'insufficient', fzLive: null, cause: null, samples: 4 });
    expect(estimateLiveChipload(reports(4), { ...OPTIONS, minSamples: 4 }).status).toBe('ok');
    expect(estimateLiveChipload(reports(4), { ...OPTIONS, minSamples: 0 }).status).toBe('insufficient');
    expect(estimateLiveChipload([], OPTIONS).status).toBe('insufficient');
  });

  it('reports no spindle for a commanded speed that is not positive, and invalid options for bad flutes', () => {
    expect(estimateLiveChipload(reports(12), { ...OPTIONS, commandedRpm: 0 })).toMatchObject({ status: 'no-spindle', fzLive: null });
    expect(estimateLiveChipload(reports(12), { ...OPTIONS, commandedRpm: Number.NaN }).status).toBe('no-spindle');
    expect(estimateLiveChipload(reports(12), { ...OPTIONS, flutes: 0 }).status).toBe('invalid-options');
    expect(estimateLiveChipload(reports(12), { ...OPTIONS, flutes: 1.5 }).status).toBe('invalid-options');
  });

  it('is frozen and deterministic', () => {
    const a = estimateLiveChipload(reports(12), OPTIONS);
    expect(Object.isFrozen(a) && Object.isFrozen(a.excluded)).toBe(true);
    expect(estimateLiveChipload(reports(12), OPTIONS)).toEqual(a);
  });
});

describe('LiveChiploadWindow', () => {
  it('rolls: old reports fall out, malformed times are dropped, and it can be cleared', () => {
    const w = new LiveChiploadWindow(OPTIONS);
    for (const s of reports(40)) expect(w.push(s)).toBe(true);
    expect(w.size).toBe(20); // 5 s kept
    expect(w.estimate().samples).toBe(12);
    expect(w.push({ ...reports(1)[0]!, t: Number.NaN })).toBe(false);
    expect(w.size).toBe(20);
    w.clear();
    expect(w.size).toBe(0);
    expect(w.estimate().status).toBe('insufficient');
  });

  it('is bounded in memory whatever the clock does', () => {
    const w = new LiveChiploadWindow(OPTIONS);
    for (let i = 0; i < LIVE_MAX_SAMPLES + 50; i++) w.push({ t: 1000, vel: 1000, feed: 1500, qr: 24, stat: STAT_RUN, line: i });
    expect(w.size).toBe(LIVE_MAX_SAMPLES);
  });
});
