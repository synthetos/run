/**
 * @synthetos/schema
 *
 * Units, generated settings schemas from vendored HIL tables plus overlays, MachineProfile v2, fact engine and invalidation rules.
 *
 * So far: board definitions and selection (P0-08); the vendored HIL tables as
 * generated per-dialect status tables and settings schemas, the per-dialect
 * read allowlists, the forbidden writes, the edge-next overlay, `validate`
 * and the write-plan gate (P0-09).
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

// --- P0-09: vendored HIL tables, read allowlists, forbidden writes, EN overlay ---
export type { GeneratedTable, GeneratedTokenRow, HilTable, TableName, TableSource, TinyGDialectId, TokenDef, TokenType } from './tables/types.ts';
export { buildTable } from './tables/table.ts';
export { GETTER_CLASS, SETTER_CLASS, getterClass, setterClass } from './tables/accessors.ts';
export type { GetterClass, SetterClass } from './tables/accessors.ts';
export { DEN } from './generated/den.ts';
export { D440 } from './generated/d440.ts';
export { D449 } from './generated/d449.ts';
export {
  READ_ALLOWLISTS,
  ReadNotAllowedError,
  TINYG_440_READ,
  TINYG_449_STOCK_READ,
  TINYG_EN_READ,
  defineReadAllowlist,
  getLine,
  getLineFor,
  isReadAllowed,
  readAllowlistFor,
  readDecision,
  readDecisionFor,
} from './allowlists/index.ts';
export type { ReadAllowlist, ReadAllowlistSpec, ReadDecision } from './allowlists/index.ts';
export { FORBIDDEN_WRITES, forbiddenWriteReason, isForbiddenKey, isWriteForbidden } from './forbiddenWrites.ts';
export type { ForbiddenRule, ForbiddenWhen, ForbiddenWrites, WriteContext } from './forbiddenWrites.ts';
export { FACT_ROOTS } from './overlays/types.ts';
export type { EnumValue, FactPattern, OverlayEntry, Range, Risk, SourceRef, TypedConfirm, Unit } from './overlays/types.ts';
export { TINYG_EN_OVERLAY } from './overlays/tinygEn.ts';
export { SETTINGS_SCHEMAS, TINYG_REPO_URL, buildSettingsSchema, settingsSchemaFor, sourceUrl } from './settingsSchema.ts';
export type { SettingDef, SettingsSchema } from './settingsSchema.ts';
export { SWITCH_KEYS, validate } from './validate.ts';
export type { Issue, IssueCode, ValidateContext } from './validate.ts';
export { screenWritePlan } from './writePlan.ts';
export type { PlannedWrite, ProposedWrite, ScreenResult } from './writePlan.ts';
