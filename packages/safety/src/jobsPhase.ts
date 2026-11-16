/**
 * Jobs are enabled on staging and production (owner decision 2026-11-15).
 * Production requires a server-validated run.connect grant to reach Web Serial, with the same grant
 * checked by the UI before new gated actions. This machine-only switch contains no account state.
 * All existing allow-matrix, board approval, idle and write-gate checks still apply.
 * Unknown environments fail closed.
 */
import type { Release } from './allowMatrix.ts';
import type { SettingsEnvironment } from './settingsPhase.ts';

export const JOBS: Readonly<Record<SettingsEnvironment, boolean>> = Object.freeze({
  staging: true,
  production: true,
});

/** True only where the switch says so. Fails closed for no environment or anything unknown. */
export function jobsEnabled(environment: SettingsEnvironment | null | undefined): boolean {
  if (environment !== 'staging' && environment !== 'production') return false;
  return JOBS[environment] === true;
}

/**
 * `base` with the jobs kind turned on where the switch allows it and `base` has motion, else `base` unchanged.
 * A release without motion never gets jobs: streaming a file is motion.
 */
export function withJobs(base: Release, environment: SettingsEnvironment | null | undefined): Release {
  if (!jobsEnabled(environment) || !base.motion) return base;
  return Object.freeze({ ...base, name: `${base.name} + jobs`, jobs: true });
}
