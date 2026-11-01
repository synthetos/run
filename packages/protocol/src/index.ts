/**
 * @synthetos/protocol
 *
 * Wire protocol for Synthetos controllers: framing, inbound classification, dialect data, capability probe and classifier, read allowlists.
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';
