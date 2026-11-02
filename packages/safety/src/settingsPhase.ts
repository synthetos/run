/**
 * THE SETTINGS-WRITE PHASE SWITCH (SAFETY §4.6, H50-H54, amendment
 * 2026-11-02). The one place that says where run may write settings to a
 * controller.
 *
 * - `staging`: on. The staging host and the localhost bench build (the
 *   machine worker treats plain-HTTP loopback as staging, P1-03).
 * - `production`: OFF until the owner says so. Production also refuses any
 *   artifact that carries the serial transport (P1-09), so this is a second,
 *   independent lock.
 * - no environment (any other origin): off.
 *
 * Settings writes also need everything else: an approved board (not
 * READ_ONLY), the idle gate, the allow-matrix row and the write gate. This
 * switch only decides whether the `settings` kind exists in the release at
 * all. A test pins these values (packages/safety/test/settingsPhase.test.ts);
 * changing them is an owner decision and needs owner review (CODEOWNERS).
 */
import { PHASE_1_RELEASE, PHASE_1_SETTINGS_RELEASE, type Release } from './allowMatrix.ts';

export type SettingsEnvironment = 'staging' | 'production';

export const SETTINGS_WRITES: Readonly<Record<SettingsEnvironment, boolean>> = Object.freeze({
  staging: true,
  production: false,
});

/** True only where the switch says so. Fails closed for no environment or anything unknown. */
export function settingsWritesEnabled(environment: SettingsEnvironment | null | undefined): boolean {
  if (environment !== 'staging' && environment !== 'production') return false;
  return SETTINGS_WRITES[environment] === true;
}

/** The release the machine session enforces in this environment. */
export function releaseFor(environment: SettingsEnvironment | null | undefined): Release {
  return settingsWritesEnabled(environment) ? PHASE_1_SETTINGS_RELEASE : PHASE_1_RELEASE;
}
