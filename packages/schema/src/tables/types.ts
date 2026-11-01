/**
 * Types for the firmware tables generated from the vendored HIL tables
 * (ROADMAP P0-09; RUN_PLAN §8.2).
 *
 * `vendor/tinyg-hil-tables/*.json` is the single source of truth. `pnpm
 * gen:schema` turns each file into a `GeneratedTable` module under
 * `src/generated/`; `buildTable` turns that into lookups.
 */

/**
 * The TinyG dialects that have a vendored table. The same strings as the
 * protocol `DialectId`s (a schema test holds them equal); declared here so
 * that the schema runtime does not depend on the protocol package.
 */
export type TinyGDialectId = 'tinyg-en' | 'tinyg-440' | 'tinyg-449-stock';

/** The vendored table names (`vendor/tinyg-hil-tables/<name>.json`). */
export type TableName = 'den' | 'd440' | 'd449';

/**
 * The cfgArray value type as the generator reports it: the `TYPE_*` bits of
 * the row's flags, or a guess from the getter on trees whose flag macros do
 * not carry them (`other` on 440.21).
 */
export type TokenType = 'boolean' | 'data' | 'float' | 'integer' | 'null' | 'signed' | 'string' | 'txtcon' | 'other';

/** One cfgArray row: `[token, group, type, precision, persist, getter, setter]`. */
export type GeneratedTokenRow = readonly [
  token: string,
  group: string,
  type: TokenType,
  precision: number,
  persist: boolean,
  getter: string,
  setter: string,
];

/** A generated module's content. */
export interface GeneratedTable {
  readonly name: TableName;
  readonly dialectId: TinyGDialectId;
  /** The firmware commit the table was generated from (full SHA, from SOURCES.json). */
  readonly commit: string;
  /** The `commit` field inside the vendored file (the generator's short SHA). */
  readonly tableCommit: string;
  /** The `ref` field inside the vendored file. */
  readonly ref: string;
  readonly fb: number;
  /** SHA-256 of the vendored file the module was generated from. */
  readonly sha256: string;
  /** Status codes, ascending, each with every `STAT_*` name that has that value. */
  readonly status: readonly (readonly [code: number, names: readonly string[]])[];
  /** cfgArray rows, in token order. */
  readonly tokens: readonly GeneratedTokenRow[];
}

/** One token of a table. */
export interface TokenDef {
  readonly token: string;
  /** cfgArray group; `''` for ungrouped tokens (group tokens themselves are ungrouped). */
  readonly group: string;
  readonly type: TokenType;
  readonly precision: number;
  /** `F_PERSIST`: written to EEPROM when set. */
  readonly persist: boolean;
  /** The cfgArray get function: what a GET of this token runs on the board. */
  readonly getter: string;
  /** The cfgArray set function: what a SET of this token runs on the board. */
  readonly setter: string;
}

export interface TableSource {
  readonly name: TableName;
  readonly dialectId: TinyGDialectId;
  readonly commit: string;
  readonly tableCommit: string;
  readonly ref: string;
  readonly fb: number;
  readonly sha256: string;
}

/** A dialect's firmware table, as lookups. Every collection is immutable. */
export interface HilTable {
  readonly source: TableSource;
  readonly tokens: ReadonlyMap<string, TokenDef>;
  /** Status code to its `STAT_*` names. */
  readonly status: ReadonlyMap<number, readonly string[]>;
  /** The member tokens of a group, in token order; empty for anything that is not a group. */
  members(group: string): readonly string[];
}
