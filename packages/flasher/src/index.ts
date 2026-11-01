/**
 * @synthetos/flasher
 *
 * Firmware flasher: manifest, Intel HEX validation, page planner, xboot client and guard filter.
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

// The verifier and the type only. The mint stays flasher-internal (ROADMAP P0-12).
export { consumeBootloaderCapability } from './bootloaderCapability.ts';
export type { BootloaderCapability } from './bootloaderCapability.ts';
