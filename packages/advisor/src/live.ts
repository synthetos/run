/**
 * Live chipload estimator (MACHINING_ASSISTANT §6.1, §6.2;
 * WORKSPACE_FEATURES "Live job analysis").
 *
 * Input: the status reports the board already sends every 100-250 ms:
 * `vel` (actual path velocity), `feed` (commanded F), `qr` (planner buffers
 * free), `stat` and `line`, plus `momo` when it is in the report.
 *
 * **The spindle speed is the commanded one.** TinyG has no spindle sensor and
 * never reports an actual speed, so the estimator takes `commandedRpm` (the
 * S word in effect) and says so (`rpmSource: 'commanded'`). A measured speed
 * from a VFD with feedback can be passed as `measuredRpm`; it is used only
 * when `useMeasuredRpm` is true, which is off by default.
 *
 * Over a rolling window (2-5 s, 3 s by default) ending at the newest report:
 *
 * - excluded: reports that are not running (`stat` other than 5: holds,
 *   stops, alarms), rapids (`momo` 0, or a velocity above the commanded
 *   feed), near-stops at corners and ramps (velocity below 10 % of the
 *   commanded feed) and malformed reports;
 * - `fz_live = mean(vel) / (rpm · z)`;
 * - the cause, from `qr`, when the machine is not reaching the feed (mean
 *   velocity under 95 % of the commanded feed): **planner starving** when
 *   the planner has many buffers free while cutting (lines arrive slower
 *   than they run: short segments or a slow stream), **machine-limited**
 *   when it is (nearly) full (velocity capped by acceleration and jerk at
 *   corners and short moves), otherwise unclear.
 */

/** TinyG `stat` 5: running (machine moving under a program). */
export const STAT_RUN = 5;
/** TinyG `momo` 0: G0, a rapid traverse. */
export const MOMO_RAPID = 0;

export interface StatusSample {
  /** Arrival time, ms (the caller's monotonic clock). */
  readonly t: number;
  /** Actual path velocity, mm/min. */
  readonly vel: number;
  /** Commanded feed F, mm/min. */
  readonly feed: number;
  /** Planner buffers free. */
  readonly qr: number;
  readonly stat: number;
  readonly line: number;
  readonly momo?: number;
}

export interface LiveChiploadOptions {
  readonly flutes: number;
  /** The commanded spindle speed (the S word in effect), rpm. Never a measured speed. */
  readonly commandedRpm: number;
  /** A measured speed from a VFD with feedback (future). Ignored unless `useMeasuredRpm` is true. */
  readonly measuredRpm?: number;
  /** Off by default: TinyG cannot measure the spindle. */
  readonly useMeasuredRpm?: boolean;
  /** Window length, ms; clamped to 2000-5000. Default 3000. */
  readonly windowMs?: number;
  /** Mean `qr` at or above which the planner is starving. Default 20. */
  readonly qrStarvingAtOrAbove?: number;
  /** Mean `qr` at or below which the planner is full (machine-limited). Default 12. */
  readonly qrFullAtOrBelow?: number;
  /** Fewest usable reports for an estimate. Default 5. */
  readonly minSamples?: number;
}

export type LiveCause = 'none' | 'planner-starving' | 'machine-limited' | 'unclear';

export interface LiveExclusions {
  readonly invalid: number;
  readonly notRunning: number;
  readonly rapid: number;
  readonly ramp: number;
}

export interface LiveEstimate {
  readonly status: 'ok' | 'insufficient' | 'no-spindle' | 'invalid-options';
  /** mm/tooth, at `rpm`; null unless status is ok. */
  readonly fzLive: number | null;
  readonly meanVel: number | null;
  readonly meanFeed: number | null;
  /** meanVel / meanFeed. */
  readonly feedRatio: number | null;
  readonly meanQr: number | null;
  readonly cause: LiveCause | null;
  readonly rpm: number;
  readonly rpmSource: 'commanded' | 'measured';
  readonly samples: number;
  readonly excluded: LiveExclusions;
  readonly windowMs: number;
}

export const LIVE_DEFAULTS = Object.freeze({
  windowMs: 3000,
  minWindowMs: 2000,
  maxWindowMs: 5000,
  qrStarvingAtOrAbove: 20,
  qrFullAtOrBelow: 12,
  minSamples: 5,
  /** Below this fraction of the commanded feed, a report is a corner stop or ramp. */
  rampFraction: 0.1,
  /** Above this fraction of the commanded feed, the machine is reaching it. */
  reachedFraction: 0.95,
  /** A velocity this far above the commanded feed is a rapid. */
  rapidMargin: 1.02,
});

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

function rpmOf(o: LiveChiploadOptions): { rpm: number; rpmSource: 'commanded' | 'measured' } {
  if (o.useMeasuredRpm === true && finite(o.measuredRpm) && o.measuredRpm > 0) return { rpm: o.measuredRpm, rpmSource: 'measured' };
  return { rpm: o.commandedRpm, rpmSource: 'commanded' };
}

export function estimateLiveChipload(samples: readonly StatusSample[], options: LiveChiploadOptions): LiveEstimate {
  const windowMs = Math.min(LIVE_DEFAULTS.maxWindowMs, Math.max(LIVE_DEFAULTS.minWindowMs, finite(options.windowMs) ? options.windowMs : LIVE_DEFAULTS.windowMs));
  const { rpm, rpmSource } = rpmOf(options);
  const excluded = { invalid: 0, notRunning: 0, rapid: 0, ramp: 0 };
  const base = { fzLive: null, meanVel: null, meanFeed: null, feedRatio: null, meanQr: null, cause: null, rpm, rpmSource, windowMs } as const;
  if (!(Number.isInteger(options.flutes) && options.flutes >= 1)) {
    return Object.freeze({ ...base, status: 'invalid-options', samples: 0, excluded: Object.freeze(excluded) });
  }
  if (!(finite(rpm) && rpm > 0)) return Object.freeze({ ...base, status: 'no-spindle', samples: 0, excluded: Object.freeze(excluded) });

  const valid = samples.filter((s) => finite(s.t) && finite(s.vel) && finite(s.feed) && finite(s.qr) && s.feed > 0 && s.vel >= 0);
  excluded.invalid = samples.length - valid.length;
  const newest = valid.reduce((m, s) => Math.max(m, s.t), Number.NEGATIVE_INFINITY);
  const used: StatusSample[] = [];
  for (const s of valid) {
    if (s.t <= newest - windowMs) continue;
    if (s.stat !== STAT_RUN) excluded.notRunning++;
    else if (s.momo === MOMO_RAPID || s.vel > s.feed * LIVE_DEFAULTS.rapidMargin) excluded.rapid++;
    else if (s.vel < s.feed * LIVE_DEFAULTS.rampFraction) excluded.ramp++;
    else used.push(s);
  }
  const minSamples = finite(options.minSamples) && options.minSamples >= 1 ? options.minSamples : LIVE_DEFAULTS.minSamples;
  if (used.length < minSamples) return Object.freeze({ ...base, status: 'insufficient', samples: used.length, excluded: Object.freeze(excluded) });

  const meanVel = mean(used.map((s) => s.vel));
  const meanFeed = mean(used.map((s) => s.feed));
  const meanQr = mean(used.map((s) => s.qr));
  const feedRatio = meanVel / meanFeed;
  const starving = options.qrStarvingAtOrAbove ?? LIVE_DEFAULTS.qrStarvingAtOrAbove;
  const full = options.qrFullAtOrBelow ?? LIVE_DEFAULTS.qrFullAtOrBelow;
  let cause: LiveCause;
  if (feedRatio >= LIVE_DEFAULTS.reachedFraction) cause = 'none';
  else if (meanQr >= starving) cause = 'planner-starving';
  else if (meanQr <= full) cause = 'machine-limited';
  else cause = 'unclear';
  return Object.freeze({
    ...base,
    status: 'ok',
    fzLive: meanVel / (rpm * options.flutes),
    meanVel,
    meanFeed,
    feedRatio,
    meanQr,
    cause,
    samples: used.length,
    excluded: Object.freeze(excluded),
  });
}

/** Most reports kept, whatever the window: a bound on memory for a misbehaving clock. */
export const LIVE_MAX_SAMPLES = 1000;

/** A rolling window of reports: push each report, read the estimate. Deterministic: time comes from the reports. */
export class LiveChiploadWindow {
  readonly #options: LiveChiploadOptions;
  #samples: StatusSample[] = [];

  constructor(options: LiveChiploadOptions) {
    this.#options = Object.freeze({ ...options });
  }

  /** Adds a report. A report without a finite time is dropped (returns false). */
  push(sample: StatusSample): boolean {
    if (!finite(sample.t)) return false;
    this.#samples.push(Object.freeze({ ...sample }));
    this.#samples = this.#samples.filter((s) => s.t > sample.t - LIVE_DEFAULTS.maxWindowMs);
    if (this.#samples.length > LIVE_MAX_SAMPLES) this.#samples = this.#samples.slice(-LIVE_MAX_SAMPLES);
    return true;
  }

  get size(): number {
    return this.#samples.length;
  }

  estimate(): LiveEstimate {
    return estimateLiveChipload(this.#samples, this.#options);
  }

  clear(): void {
    this.#samples = [];
  }
}
