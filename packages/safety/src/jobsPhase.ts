/**
 * THE JOBS PHASE SWITCH (Phase 3, owner 2026-11-02; SAFETY §4.4a, H70-H78).
 * The one place that says where run may stream a whole G-code file to a
 * controller.
 *
 * - `staging`: on. The staging host and the localhost bench build (the
 *   machine worker treats plain-HTTP loopback as staging, P1-03).
 * - `production`: OFF. Production stays read-only: it gets neither motion nor
 *   jobs, and it refuses any artifact that carries the serial transport
 *   (P1-09), a second, independent lock.
 * - no environment (any other origin): off.
 *
 * Jobs also need everything else: the motion release (a job is motion), an
 * approved board, the allow-matrix rows of kind `jobs` and the write gate.
 * This switch only decides whether the `jobs` kind exists in the release at
 * all. A test pins these values (packages/safety/test/jobsPhase.test.ts);
 * changing them is an owner decision and needs owner review (CODEOWNERS).
 */
import type { Release } from './allowMatrix.ts';
import type { SettingsEnvironment } from './settingsPhase.ts';

export const JOBS: Readonly<Record<SettingsEnvironment, boolean>> = Object.freeze({
  staging: true,
  production: false,
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
