/**
 * @synthetos/schema
 *
 * Units, generated settings schemas from vendored HIL tables plus overlays, MachineProfile v2, fact engine and invalidation rules.
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export { validateSchema } from './jsonSchema.ts';
export type { Schema, SchemaError } from './jsonSchema.ts';
export { BOARD_SCHEMA, commonSubset, parseBoardDefinition, selectBoard } from './boards.ts';
export type { BoardDefinition, BoardIdentity, BoardOutput, BoardSelection, Fact, OutputId, ParsedBoard, Verified } from './boards.ts';
