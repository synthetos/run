/**
 * THE FLASHER PHASE SWITCH (firmware update, owner 2026-11-03; SAFETY §4.8 as
 * amended, H79-H88). The one place that says where run may put a board into
 * its bootloader and write its firmware.
 *
 * - `staging`: on. The staging host and the localhost bench build (the
 *   machine worker treats plain-HTTP loopback as staging, P1-03).
 * - `production`: OFF, and it stays off: production is read-only, refuses
 *   any artifact that carries the serial transport (P1-09), and its signed
 *   release list has no entry until the owner signs one with the release key.
 * - no environment (any other origin): off.
 *
 * Flashing also needs everything else: the matrix row of kind `flash`, the
 * idle gate before `{"boot":1}`, the flasher's authorization (the image, the
 * board, the backups) and the bootloader capability it alone mints. This
 * switch only decides whether the `flash` kind exists in the release at all.
 * A test pins these values (packages/safety/test/flasherPhase.test.ts);
 * changing them is an owner decision and needs owner review (CODEOWNERS).
 */
import type { Release } from './allowMatrix.ts';
import type { SettingsEnvironment } from './settingsPhase.ts';

export const FLASHER: Readonly<Record<SettingsEnvironment, boolean>> = Object.freeze({
  staging: true,
  production: false,
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
