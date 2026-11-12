/**
 * @synthetos/library
 *
 * Tool, material, stock, fixture and store-product records
 * (MACHINING_ASSISTANT §2, §3, §4, §9): their types, schemas and runtime
 * validation; external link sanitising (§8); versioning and forking; and the
 * built-in seed data, whose every number names a source or is flagged as a
 * placeholder (§1 principle 4).
 *
 * Pure data and checks. This package has no runtime npm dependencies, uses no
 * network API and never imports machine, protocol, contracts or the cloud
 * client (.dependency-cruiser.cjs `layer-library`); its only workspace import
 * is the repository's JSON Schema validator (`@synthetos/schema/json-schema`).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export * from './types.ts';
export { DEFAULT_PLACEHOLDER_NOTE, citationText, isPlaceholder, toAdvice, userValue } from './sourced.ts';
export type { Advice, CitedValue, PlaceholderValue, SourceCitation, SourceKind, Sourced } from './sourced.ts';
export { EXTERNAL_LINK_REL, URL_MAX_LENGTH, checkExternalUrl, safeExternalLink } from './url.ts';
export type { ExternalLink, UrlCheck, UrlProblem } from './url.ts';
export {
  ASSET_PATH,
  EDIT_PATH,
  FIXTURE_SCHEMA,
  FORK_SCHEMA,
  ID_PATTERN,
  ISO_DATE,
  MATERIAL_SCHEMA,
  MULTILINE_TEXT,
  PLAIN_TEXT,
  PURCHASE_LINK_SCHEMA,
  STOCK_SCHEMA,
  STORE_PRODUCT_SCHEMA,
  TOOL_SCHEMA,
} from './schemas.ts';
export { TOOL_TYPE_GEOMETRY, readFixture, readMaterial, readPurchaseLink, readStock, readStoreProduct, readTool } from './validate.ts';
export type { LibraryIssue, LibraryResult } from './validate.ts';
export { editFork, editablePaths, forkRecord, isInherited, isSameVersion, readFork, rebaseFork, refOf, resolveFork, revertField, reviseRecord } from './fork.ts';
export type { LibraryFork, LibraryKind, LibraryRecord } from './fork.ts';
export { BUILTIN_MATERIALS, BUILTIN_TOOL_MATERIALS, BUILTIN_TOOL_TYPES, SEED_PLACEHOLDER_NOTE, builtinMaterial, toolTypeSpec } from './seed.ts';
export type { ToolMaterialSpec, ToolTypeSpec } from './seed.ts';
export { deepFreeze } from './freeze.ts';
export { ONSRUD_CATALOG } from './catalog/onsrud.ts';
