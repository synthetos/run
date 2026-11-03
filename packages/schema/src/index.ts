/**
 * @synthetos/schema
 *
 * Units, generated settings schemas from vendored HIL tables plus overlays, MachineProfile v2, fact engine and invalidation rules.
 *
 * So far: board definitions and selection (P0-08); the vendored HIL tables as
 * generated per-dialect status tables and settings schemas, the per-dialect
 * read allowlists, the forbidden writes, the edge-next overlay, `validate`
 * and the write-plan gate (P0-09); MachineProfile v2 with its v1 migration,
 * import/export rules and field classes, the device-local fact store with
 * its invalidation rules, and the gate DSL (TB-01).
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export { validateSchema } from './jsonSchema.ts';
export type { Schema, SchemaError } from './jsonSchema.ts';
export { deepFreeze } from './frozen.ts';
export { BOARD_SCHEMA, checkBoardConsistency, commonSubset, parseBoardDefinition, selectBoard } from './boards.ts';
export type { BoardConnector, BoardDefinition, BoardIdentity, BoardOutput, BoardPin, BoardRating, BoardSelection, ConnectorNet, Fact, OutputId, ParsedBoard, Verified } from './boards.ts';

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
export { boardSettingsFrom, canonicalSettings, deviceHash, settingsDrift, settingsReadGroups } from './settingsRead.ts';
export type { BoardSettings, BoardSettingsRead, DriftResult, ExpectedSettings, GroupAnswer, SettingDiff, SettingValue, SettingsGroup } from './settingsRead.ts';
export { SWITCH_KEYS, validate } from './validate.ts';
export { HOMING_AXES, homingAxes, homingAxis } from './homing.ts';
export type { HomingAxis, HomingAxisConfig } from './homing.ts';
export type { Issue, IssueCode, ValidateContext } from './validate.ts';
export { TRAVEL_AXES, TRAVEL_SEMANTICS, confirmSoftLimits, firmwareTravelEqual, travelSemanticsFor, travelWriteProblem } from './travel.ts';
export type { AxisSoftLimit, SoftLimitConfirmation, SoftLimitReadBack, TravelAxis, TravelSemantics, TravelWriteProblem } from './travel.ts';
export { screenWritePlan } from './writePlan.ts';
export type { PlannedWrite, ProposedWrite, ScreenResult } from './writePlan.ts';

// --- TB-01: MachineProfile v2, fact engine, invalidation rules, gate DSL ---
export { PROFILE_AXES, PROFILE_SCHEMA_VERSION } from './profile/types.ts';
export type {
  BoundDevice,
  ControllerFamily,
  Drive,
  DriveKind,
  HostLossPolicy,
  MachineProfileV2,
  ProfileAxis,
  ProfileAxisDef,
  ProfileBoard,
  ProfileFirmware,
  ProfileMachine,
  ProfileSettings,
  SpindleDrive,
  WiringRef,
} from './profile/types.ts';
export { HOLD_TIMEOUT_S, MAX_MOTOR, PROFILE_DIALECT_IDS, PROFILE_V1_SCHEMA, PROFILE_V2_SCHEMA } from './profile/schema.ts';
export { MOTORS_PER_FAMILY, familyOfDialect, profileSemanticIssues } from './profile/semantics.ts';
export { DEFAULT_HOST_GATE_VALUES, HOST_GATE_PATHS, PROFILE_FIELD_CLASSES, hostGatesOf, profileFieldClass } from './profile/fieldClasses.ts';
export type { ProfileFieldClass } from './profile/fieldClasses.ts';
export { readProfileValue } from './profile/migrate.ts';
export type { ProfileError, ProfileErrorCode, ProfileRead, ProfileResult } from './profile/migrate.ts';
export {
  PROFILE_FILE_EXTENSION,
  PROFILE_MAX_BYTES,
  PROFILE_MAX_DEPTH,
  ProfileInvalidError,
  exportProfile,
  importProfileBytes,
  importProfileText,
  profileSizeError,
  readStoredProfile,
  toStoredProfile,
  utf8Length,
} from './profile/io.ts';
export { canonicalProfile } from './profile/canonical.ts';
export { newMachineProfile } from './profile/create.ts';
export type { NewProfileInput } from './profile/create.ts';
export { factRoot, isFactKey, isFactPattern, patternMatches } from './facts/keys.ts';
export { ALL_FACTS, INVALIDATION_RULES, settingInvalidates } from './facts/rules.ts';
export type { FactTrigger, FactTriggerKind, InvalidationRule, RuleScope } from './facts/rules.ts';
export {
  AGED_ROOTS,
  DAY_MS,
  DEFAULT_FACT_MAX_AGE_MS,
  EMPTY_FACT_STATE,
  FUTURE_SKEW_MS,
  FactError,
  SESSION_ROOTS,
  addFact,
  factProblem,
  invalidate,
  readFactState,
  view,
} from './facts/store.ts';
export type { Clock, FactBinding, FactRecord, FactState, FactStatus, FactView, NewFact, ViewOptions } from './facts/store.ts';
export { GATE_MAX_DEPTH, GATE_MAX_LENGTH, GateSyntaxError, checkGate, evaluateGate, parseGate } from './facts/gate.ts';
export type { Gate, GateContext, GateResult, Unmet } from './facts/gate.ts';
export { BOARD_DEFINITIONS, UNCERTAIN_BOARD_NOTICE, UNRECOGNISED_BOARD_NOTICE, boardPanels, selectGeneratedBoard } from './boardCatalog.ts';
export type { BoardPanel, BoardPanelSet } from './boardCatalog.ts';
export {
  COMMS_KEYS,
  COMMS_LAST,
  HIGH_RISK_CATEGORIES,
  IDENTITY_KEYS,
  READOUT_KEYS,
  categoryOf,
  changeRisk,
  isCommsKey,
  orderWrites,
  planSettingsWrite,
  readBackMatches,
  restoreChanges,
  sameSetting,
  valueWords,
} from './settingsWrite.ts';
export type { ChangeRisk, PlannedChange, ProposedValue, RestoreChanges, RestoreSkip, RiskCategory, SettingsPlan } from './settingsWrite.ts';
