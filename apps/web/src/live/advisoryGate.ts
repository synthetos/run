/**
 * The safety-advisory gate (ROADMAP P1-05; SAFETY H27, T-S31, T-S75).
 *
 * At every LIVE entry the signed advisory is fetched (`no-store`) and
 * verified. A verified copy is cached in `device-safety` as the raw signed
 * file and is re-verified whenever it is used, so the cache is never trusted
 * on its own. If the fetch fails, the cached copy is used while it is
 * younger than 7 days; after that LIVE is refused. A fetched file that does
 * not verify refuses LIVE (it never falls back to the cache). A revoked app
 * build refuses LIVE.
 *
 * While connected, `AdvisoryPoller` re-checks every 15 minutes. A revocation
 * (sticky for the session) or an advisory that can no longer be verified
 * blocks NEW Arm, Start and jog (live/liveGates.ts). It never sends anything
 * to the machine worker: a running job, a hold and every stop are untouched.
 */
import { findRevocation, verifySafetyAdvisory } from '@synthetos/protocol';
import type { AdvisoryEnvironment, AdvisoryRejection, ReleaseKey, Revocation } from '@synthetos/protocol';
import type { AdvisoryFetch } from '../cloud/live.ts';
import type { DeviceSafetyStore } from './deviceSafety.ts';

export const ADVISORY_CACHE_KEY = 'advisory.verified';
export const ADVISORY_MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const ADVISORY_POLL_MS = 15 * 60 * 1000;

export type AdvisoryCheck =
  | { readonly ok: true; readonly source: 'fetched' | 'cache' }
  | { readonly ok: false; readonly reason: 'revoked'; readonly revocation: Revocation }
  | { readonly ok: false; readonly reason: 'unverifiable'; readonly rejection: AdvisoryRejection }
  | { readonly ok: false; readonly reason: 'offline-no-cache' | 'offline-cache-too-old' };

export interface AdvisoryDeps {
  readonly fetchAdvisory: () => Promise<AdvisoryFetch>;
  readonly store: DeviceSafetyStore;
  /** The environment this page verifies for, or null (refuses). */
  readonly environment: AdvisoryEnvironment | null;
  /** This app build's commit SHA. */
  readonly appSha: string;
  readonly now: () => Date;
  readonly keys?: readonly ReleaseKey[];
}

interface CachedAdvisory {
  readonly file: unknown;
  readonly fetchedAt: number;
}

function isCached(value: unknown): value is CachedAdvisory {
  return typeof value === 'object' && value !== null && 'file' in value && typeof (value as { fetchedAt?: unknown }).fetchedAt === 'number';
}

async function judge(file: unknown, deps: AdvisoryDeps, now: Date): Promise<AdvisoryCheck | 'verified'> {
  const verdict = await verifySafetyAdvisory(file, { environment: deps.environment, now, ...(deps.keys === undefined ? {} : { keys: deps.keys }) });
  if (!verdict.ok) return { ok: false, reason: 'unverifiable', rejection: verdict.rejection };
  const revocation = findRevocation(verdict.advisory, deps.appSha);
  return revocation === undefined ? 'verified' : { ok: false, reason: 'revoked', revocation };
}

/** One check, as LIVE entry and the poll make it. Never throws. */
export async function checkAdvisory(deps: AdvisoryDeps): Promise<AdvisoryCheck> {
  const now = deps.now();
  const fetched = await deps.fetchAdvisory();
  if (fetched.ok) {
    const result = await judge(fetched.body, deps, now);
    if (result !== 'verified') return result;
    try {
      await deps.store.set(ADVISORY_CACHE_KEY, { file: fetched.body, fetchedAt: now.getTime() } satisfies CachedAdvisory);
    } catch {
      // A cache that cannot be written only means the next offline entry is refused.
    }
    return { ok: true, source: 'fetched' };
  }
  let cached: unknown;
  try {
    cached = await deps.store.get(ADVISORY_CACHE_KEY);
  } catch {
    cached = undefined;
  }
  if (!isCached(cached)) return { ok: false, reason: 'offline-no-cache' };
  const age = now.getTime() - cached.fetchedAt;
  // A negative age means the clock moved back: the cache's age is unknown, so it is too old.
  if (!(age >= 0 && age < ADVISORY_MAX_CACHE_AGE_MS)) return { ok: false, reason: 'offline-cache-too-old' };
  const result = await judge(cached.file, deps, now);
  return result === 'verified' ? { ok: true, source: 'cache' } : result;
}

export interface Scheduler {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/**
 * The 15-minute poll while connected. `blocked` is the reason new Arm,
 * Start and jog are refused, or null. A revocation stays for the session;
 * any other failure clears once a check passes again.
 */
export class AdvisoryPoller {
  private handle: unknown = null;
  private revoked: AdvisoryCheck | null = null;
  private failing: AdvisoryCheck | null = null;

  private readonly deps: AdvisoryDeps;
  private readonly scheduler: Scheduler;
  private readonly onChange: (blocked: AdvisoryCheck | null) => void;

  constructor(deps: AdvisoryDeps, scheduler: Scheduler, onChange: (blocked: AdvisoryCheck | null) => void = () => undefined) {
    this.deps = deps;
    this.scheduler = scheduler;
    this.onChange = onChange;
  }

  get blocked(): AdvisoryCheck | null {
    return this.revoked ?? this.failing;
  }

  start(): void {
    if (this.handle !== null) return;
    this.handle = this.scheduler.setInterval(() => void this.tick(), ADVISORY_POLL_MS);
  }

  stop(): void {
    if (this.handle !== null) this.scheduler.clearInterval(this.handle);
    this.handle = null;
    this.failing = null;
  }

  /** One poll. Exposed for tests and for the scheduler. */
  async tick(): Promise<void> {
    const before = this.blocked;
    const result = await checkAdvisory(this.deps);
    if (!result.ok && result.reason === 'revoked') this.revoked = result;
    this.failing = result.ok ? null : result;
    if (this.blocked !== before) this.onChange(this.blocked);
  }
}
