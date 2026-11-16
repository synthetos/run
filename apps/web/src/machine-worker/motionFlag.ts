/**
 * Machine abilities by deployment origin (owner decision 2026-11-15).
 * Production and staging share jog, jobs, settings and firmware abilities. Production's document can
 * reach Web Serial only when the server validates run.connect. The UI checks that same grant for new
 * gated actions. No identity or network check enters this worker or the accepted operation/stop paths.
 * Unknown origins remain read-only; loopback retains the existing bench rules.
 */
import { PHASE_1_RELEASE, PHASE_2_RELEASE, withFlasher, withJobs, withSettingsWrites, type Release } from '@synthetos/safety';
import { approvalEnvironment } from './approval.ts';

export function motionEnabledFor(origin: string): boolean {
  return approvalEnvironment(origin) !== null;
}

/** The browser's document policy gates the port; the worker still enforces all machine blockers. */
export function releaseFor(origin: string): Release {
  const environment = approvalEnvironment(origin);
  return withFlasher(withJobs(withSettingsWrites(motionEnabledFor(origin) ? PHASE_2_RELEASE : PHASE_1_RELEASE, environment), environment), environment);
}
