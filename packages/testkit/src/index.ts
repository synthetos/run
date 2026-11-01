/**
 * @synthetos/testkit
 *
 * DEV ONLY. Firmware models, MockSerial, fault plans, virtual clock and replay transport for tests. Never part of a production bundle.
 *
 * No production entry graph may import this package (RUN_PLAN §5.3, T-S40).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

/**
 * Marker export that identifies the test kit. The bundle scan (P0-13, T-S40)
 * fails a production build that contains this literal.
 */
export const TESTKIT_MARKER = '__SYNTHETOS_TESTKIT_DEV_ONLY__';
