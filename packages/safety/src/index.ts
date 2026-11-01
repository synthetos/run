/**
 * @synthetos/safety
 *
 * Safety core: allow-matrix, sanitiser, preflight, jog plan, flash gate, fault policy, overrun bound and the canonical warning strings.
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';
