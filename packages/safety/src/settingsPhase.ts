/**
 * Settings writes are enabled on staging and production (owner decision 2026-11-15).
 * Production requires a server-validated run.connect grant to reach Web Serial, with the same grant
 * checked by the UI before new gated actions. This machine-only switch contains no account state.
 * All existing allow-matrix, board approval, idle and write-gate checks still apply.
 * Unknown environments fail closed.
 */
import type { Release } from './allowMatrix.ts';

export type SettingsEnvironment = 'staging' | 'production';

export const SETTINGS_WRITES: Readonly<Record<SettingsEnvironment, boolean>> = Object.freeze({
  staging: true,
  production: true,
});

/** True only where the switch says so. Fails closed for no environment or anything unknown. */
export function settingsWritesEnabled(environment: SettingsEnvironment | null | undefined): boolean {
  if (environment !== 'staging' && environment !== 'production') return false;
  return SETTINGS_WRITES[environment] === true;
}

/**
 * `base` with the settings kind turned on where the switch allows it, else `base` unchanged. It composes
 * with the motion flag: on staging the worker's Phase 2 release gains settings writes, so motion and
 * settings are both on; production uses the same settings capability after its Connect grant.
 */
export function withSettingsWrites(base: Release, environment: SettingsEnvironment | null | undefined): Release {
  if (!settingsWritesEnabled(environment)) return base;
  return Object.freeze({ ...base, name: `${base.name} + settings writes`, settings: true });
}
