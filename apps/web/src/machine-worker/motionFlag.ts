/**
 * The motion capability flag of `machine.worker` (Phase 2, owner 2026-11-02; SAFETY §4.5b, T-S93).
 *
 * Motion (jog, go to zero, set zero, spindle and coolant) is enabled only where the worker verifies the
 * approved-builds manifest as `staging`: the staging host over https, and plain-HTTP loopback (the bench
 * server and the local test servers). Production's host is `production` and every other origin has no
 * environment, so they keep `PHASE_1_RELEASE`: read-only, whatever the manifest says. The flag is derived
 * from the worker's own origin, never from a build flag or a message from the page, so the attested
 * artifact is the same in every environment and production stays unchanged.
 *
 * A change to this file changes where the machine can be moved and needs safety review (SAFETY §8).
 */
import { PHASE_1_RELEASE, PHASE_2_RELEASE, withFlasher, withJobs, withSettingsWrites, type Release } from '@synthetos/safety';
import { approvalEnvironment } from './approval.ts';

/** True where motion is enabled: the staging environment (staging host, loopback bench). */
export function motionEnabledFor(origin: string): boolean {
  return approvalEnvironment(origin) === 'staging';
}

/**
 * The release the worker's session enforces at `origin`: the motion flag picks Phase 2 or Phase 1, and the
 * settings-write switch (safety settingsPhase.ts) adds settings writes for the same environment. On staging
 * and the loopback bench both are on; production and unknown origins get `PHASE_1_RELEASE` unchanged.
 */
export function releaseFor(origin: string): Release {
  // Phase 3 (SAFETY §4.4a): the jobs switch (safety jobsPhase.ts) adds jobs to the motion release for the same
  // environment; production and unknown origins keep PHASE_1_RELEASE.
  const environment = approvalEnvironment(origin);
  // The firmware update (SAFETY §4.8 as amended 2026-11-03): the flasher switch (safety flasherPhase.ts) adds the
  // flash kind for the same environment; production and unknown origins keep PHASE_1_RELEASE.
  return withFlasher(withJobs(withSettingsWrites(motionEnabledFor(origin) ? PHASE_2_RELEASE : PHASE_1_RELEASE, environment), environment), environment);
}
