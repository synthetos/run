/**
 * THE SETTINGS-WRITE PHASE SWITCH (SAFETY §4.6, H57-H63, amendment
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
import type { Release } from './allowMatrix.ts';

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

/**
 * `base` with the settings kind turned on where the switch allows it, else `base` unchanged. It composes
 * with the motion flag: on staging the worker's Phase 2 release gains settings writes, so motion and
 * settings are both on; on production `base` (read-only) is returned as it is.
 */
export function withSettingsWrites(base: Release, environment: SettingsEnvironment | null | undefined): Release {
  if (!settingsWritesEnabled(environment)) return base;
  return Object.freeze({ ...base, name: `${base.name} + settings writes`, settings: true });
}
