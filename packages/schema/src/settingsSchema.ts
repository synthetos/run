/**
 * Per-dialect settings schemas: the generated firmware table plus the hand
 * overlay plus the forbidden writes (ROADMAP P0-09; RUN_PLAN §7.2, §8.2).
 *
 * Every cfgArray token of the dialect's table is in `settings`, with its
 * group, type, persist flag and accessors. A key can be validated or written
 * only if it also has an overlay entry: the overlay carries the reviewed
 * range, risk and invalidation rules, and a key without one has never been
 * reviewed. Today only `tinyg-en` has an overlay; `tinyg-440` keys can be
 * read and shown but not written (fail closed until its overlay exists), and
 * `tinyg-449-stock` is always read-only.
 */
import { SPINDLE_OVERRIDE_SETTINGS } from './firmware45006.ts';
import { REMOVED_HOLD_KEYS, OVERRIDE_SETTINGS } from './firmware45005.ts';
import { FORBIDDEN_WRITES, isForbiddenKey } from './forbiddenWrites.ts';
import type { ForbiddenWrites } from './forbiddenWrites.ts';
import { frozenMap } from './frozen.ts';
import { D440 } from './generated/d440.ts';
import { D449 } from './generated/d449.ts';
import { DEN } from './generated/den.ts';
import { TINYG_EN_OVERLAY } from './overlays/tinygEn.ts';
import type { OverlayEntry, SourceRef } from './overlays/types.ts';
import { setterClass } from './tables/accessors.ts';
import { buildTable } from './tables/table.ts';
import type { GeneratedTable, HilTable, TinyGDialectId, TokenDef } from './tables/types.ts';

export interface SettingDef extends TokenDef {
  /** The reviewed meaning, range and risk. Absent: the key is shown read-only and never written. */
  readonly overlay?: OverlayEntry;
}

export interface SettingsSchema {
  readonly dialectId: TinyGDialectId;
  /** `<dialect>@<short commit>`: MachineProfile `settings.schemaKey` (RUN_PLAN §7.2). */
  readonly schemaKey: string;
  /** `readOnly` dialects never write anything (stock 449: PN §2.1). */
  readonly mode: 'writable' | 'readOnly';
  readonly table: HilTable;
  readonly settings: ReadonlyMap<string, SettingDef>;
  readonly forbidden: ForbiddenWrites;
}

/** The firmware repository the `src` links point at (vendor/firmware-pins.json `EN.repo`). */
export const TINYG_REPO_URL = 'https://github.com/synthetos/TinyG';

/** A link to the cfgArray row of a key at the pinned commit (RUN_PLAN §7.2 "source link"). */
export function sourceUrl(commit: string, src: SourceRef): string {
  return `${TINYG_REPO_URL}/blob/${commit}/firmware/tinyg/${src.file}#L${src.line}`;
}

/**
 * Builds a dialect's schema. Throws when an overlay entry is listed twice,
 * names a key the table does not have, names a key whose setter does not
 * store a value, or names a forbidden write: each would let a write plan
 * reach a key nobody reviewed for writing.
 */
export function buildSettingsSchema(gen: GeneratedTable, mode: SettingsSchema['mode'], overlay: readonly OverlayEntry[]): SettingsSchema {
  const table = buildTable(gen);
  const forbidden = FORBIDDEN_WRITES[gen.dialectId];
  const byKey = new Map<string, OverlayEntry>();
  for (const o of overlay) {
    const where = `${gen.dialectId} overlay ${o.key}`;
    if (byKey.has(o.key)) throw new Error(`${where}: listed twice`);
    const def = table.tokens.get(o.key);
    if (def === undefined) throw new Error(`${where}: not in the ${gen.name} table`);
    if (setterClass(def.setter) !== 'value') throw new Error(`${where}: setter ${def.setter} does not store a value`);
    if (isForbiddenKey(forbidden, o.key)) throw new Error(`${where}: the key is a forbidden write`);
    byKey.set(o.key, o);
  }
  const settings = [...table.tokens.values()].map((def): [string, SettingDef] => {
    const o = byKey.get(def.token);
    return [def.token, Object.freeze(o === undefined ? { ...def } : { ...def, overlay: o })];
  });
  return Object.freeze({
    dialectId: gen.dialectId,
    schemaKey: `${gen.dialectId}@${gen.commit.slice(0, 8)}`,
    mode,
    table,
    settings: frozenMap(settings),
    forbidden,
  });
}

export const SETTINGS_SCHEMAS: Readonly<Record<TinyGDialectId, SettingsSchema>> = Object.freeze({
  'tinyg-en': buildSettingsSchema(DEN, 'writable', TINYG_EN_OVERLAY),
  'tinyg-440': buildSettingsSchema(D440, 'writable', []),
  'tinyg-449-stock': buildSettingsSchema(D449, 'readOnly', []),
});

const EN_45005_SETTINGS = frozenMap([...SETTINGS_SCHEMAS['tinyg-en'].settings].filter(([key]) => !REMOVED_HOLD_KEYS.includes(key)).concat(OVERRIDE_SETTINGS.map(def => [def.token, def] as [string, SettingDef])));
const EN_45005: SettingsSchema = Object.freeze({
  ...SETTINGS_SCHEMAS['tinyg-en'],
  schemaKey: 'tinyg-en@0e807169',
  settings: EN_45005_SETTINGS,
  // Preserve provenance of the base table; firmware45005.ts cites the separately reviewed delta.
  table: Object.freeze({ ...SETTINGS_SCHEMAS['tinyg-en'].table, tokens: EN_45005_SETTINGS, members: (group: string) => Object.freeze(SETTINGS_SCHEMAS['tinyg-en'].table.members(group).filter(key => !REMOVED_HOLD_KEYS.includes(key))) }),
});

const EN_45006_SETTINGS = frozenMap([...EN_45005.settings, ...SPINDLE_OVERRIDE_SETTINGS.map(def => [def.token, def] as [string, SettingDef])]);
const EN_45006: SettingsSchema = Object.freeze({ ...EN_45005, schemaKey: 'tinyg-en@701c3876', settings: EN_45006_SETTINGS, table: Object.freeze({ ...EN_45005.table, tokens: EN_45006_SETTINGS }) });

/** The settings schema of a dialect; throws for a dialect without a vendored table (g2core). */
export function settingsSchemaFor(dialectId: string, fb?: number): SettingsSchema {
  if (!Object.hasOwn(SETTINGS_SCHEMAS, dialectId)) throw new Error(`no settings schema for dialect ${JSON.stringify(dialectId)}`);
  if (dialectId === 'tinyg-en' && fb !== undefined && fb >= 450.06) return EN_45006;
  if (dialectId === 'tinyg-en' && fb !== undefined && fb >= 450.05) return EN_45005;
  return SETTINGS_SCHEMAS[dialectId as TinyGDialectId];
}
