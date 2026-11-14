/** SAFETY §4.8 owner approval, 2026-11-14: only the separate updater enables this release. */
import { PHASE_1_RELEASE, type Release } from '@synthetos/safety';
import { approvalEnvironment } from './approval.ts';
export function firmwareReleaseFor(origin: string): Release {
  const environment = approvalEnvironment(origin);
  return environment === null ? PHASE_1_RELEASE : Object.freeze({ ...PHASE_1_RELEASE, name: 'Firmware update only', settings: true, flash: true, reports: true, motion: false, jobs: false });
}
