/**
 * The vendored firmware tables, as the models read them (RUN_PLAN §8.2: one
 * source of truth for firmware tables).
 *
 * `vendor/tinyg-hil-tables/den.json` (edge-next ead63997) and `d440.json`
 * (master d0418390, build 440.21) were generated from the firmware sources by
 * EN-HIL's `tests/hil/tools/gen_tables.py` (P0-09, D32). The models take
 * every status code and every token's getter, setter, group, persistence and
 * print precision from them, so a model can never invent a code the firmware
 * does not have, and a GET with a side effect (E138) is recognised by the
 * same getter name the firmware's cfgArray uses.
 */
import '../marker.ts';
import den from '../../../../vendor/tinyg-hil-tables/den.json' with { type: 'json' };
import d440 from '../../../../vendor/tinyg-hil-tables/d440.json' with { type: 'json' };

export interface TokenInfo {
  /** cfgArray getter function name, e.g. `get_flt`, `st_set_md`. */
  readonly get: string;
  /** cfgArray setter function name. */
  readonly set: string;
  /** Group the token belongs to ('' for none). */
  readonly group: string;
  /** Persisted to EEPROM on a successful SET. */
  readonly persist: boolean;
  /** Decimal places the firmware prints. */
  readonly precision: number;
  readonly type: string;
}

export interface FirmwareTable {
  readonly name: string;
  readonly commit: string;
  readonly fb: number;
  readonly status: Readonly<Record<string, number>>;
  readonly tokens: Readonly<Record<string, TokenInfo>>;
}

export const EN_TABLE: FirmwareTable = den as FirmwareTable;
export const TG_TABLE: FirmwareTable = d440 as FirmwareTable;

/** Status code by firmware name (without the `STAT_` prefix). Unknown names throw: a typo is a test-kit bug. */
export function statusCode(table: FirmwareTable, name: string): number {
  const code = table.status[name];
  if (code === undefined) throw new Error(`${table.name}: no status named ${name}`);
  return code;
}

/** Token metadata, or undefined when the firmware has no such token. */
export function token(table: FirmwareTable, name: string): TokenInfo | undefined {
  return Object.hasOwn(table.tokens, name) ? table.tokens[name] : undefined;
}

/** The single (non-group) tokens of a group, in table order. */
export function groupMembers(table: FirmwareTable, group: string): string[] {
  return Object.entries(table.tokens)
    .filter(([, info]) => info.group === group && info.get !== 'get_grp')
    .map(([name]) => name);
}
