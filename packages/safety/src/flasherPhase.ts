/**
 * Firmware updates are enabled on staging and production (owner decision 2026-11-15).
 * Production requires a server-validated run.connect grant to reach Web Serial, with the same grant
 * checked by the UI before new gated actions. This machine-only switch contains no account state.
 * All existing allow-matrix, board approval, idle and write-gate checks still apply.
 * Unknown environments fail closed.
 */
import type { Release } from './allowMatrix.ts';
import type { SettingsEnvironment } from './settingsPhase.ts';

export const FLASHER: Readonly<Record<SettingsEnvironment, boolean>> = Object.freeze({
  staging: true,
  production: true,
});

/** True only where the switch says so. Fails closed for no environment or anything unknown. */
export function flasherEnabled(environment: SettingsEnvironment | null | undefined): boolean {
  if (environment !== 'staging' && environment !== 'production') return false;
  return FLASHER[environment] === true;
}

/** `base` with the flash kind turned on where the switch allows it and `base` opens ports, else `base` unchanged. */
export function withFlasher(base: Release, environment: SettingsEnvironment | null | undefined): Release {
  if (!flasherEnabled(environment) || !base.port) return base;
  return Object.freeze({ ...base, name: `${base.name} + flasher`, flash: true });
}
