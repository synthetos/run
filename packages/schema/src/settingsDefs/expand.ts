/**
 * Loads one settings file (Board settings spec §4.2, §4.3): validates it
 * against settings.schema.json, expands the families, resolves the shared
 * value lists, applies the cross-field rules the JSON schema cannot express,
 * and keeps the tokens the given build has. Pure; throws an `Error` naming
 * the token on any rule break, so a bad file fails at load, never at a write.
 */
import schemaJson from '../../settings.schema.json' with { type: 'json' };
import { frozenMap, deepFreeze } from '../frozen.ts';
import { validateSchema } from '../jsonSchema.ts';
import type { Schema } from '../jsonSchema.ts';
import { expandFamily, unresolved } from './families.ts';
import type { RawFamily, RawToken } from './families.ts';
import type { GroupDefinition, SettingDefinition, SettingsFile, ValueDef, WriteDef } from './types.ts';

export const SETTINGS_FILE_SCHEMA: Schema = schemaJson as Schema;

interface RawEnum {
  readonly labelSrc?: string;
  readonly values: readonly ValueDef[];
}

interface RawFile extends Omit<SettingsFile, 'tokens'> {
  readonly enums?: Readonly<Record<string, RawEnum>>;
  readonly families?: readonly RawFamily[];
  readonly tokens: Readonly<Record<string, RawToken>>;
}

/** Fields copied as they are when present. */
const OPTIONAL = ['display', 'reason', 'since', 'until', 'labelSrc', 'verify', 'differs'] as const;

function validated(raw: unknown): RawFile {
  const errors = validateSchema(SETTINGS_FILE_SCHEMA, raw);
  if (errors.length === 0) return raw as RawFile;
  const words = errors.map((e) => `${e.path || '/'} ${e.message === 'property not allowed' ? 'additional property not allowed' : e.message}`);
  throw new Error(`settings file: ${words.join('; ')}`);
}

function valuesOf(key: string, t: RawToken, file: RawFile): { values?: readonly ValueDef[]; labelSrc?: string } {
  const ref = t['enum'] as string | undefined;
  const own = t['values'] as readonly ValueDef[] | undefined;
  if (ref === undefined) return own === undefined ? {} : { values: own };
  if (own !== undefined) throw new Error(`${key}: both values and enum`);
  const shared = file.enums?.[ref];
  if (shared === undefined) throw new Error(`${key}: unknown enum "${ref}"`);
  return { values: shared.values, ...(shared.labelSrc === undefined ? {} : { labelSrc: shared.labelSrc }) };
}

function checkWrite(key: string, t: RawToken, file: RawFile): void {
  const write = t['write'] as WriteDef | undefined;
  if (write !== undefined && file.mode === 'readOnly') throw new Error(`${key}: a readOnly file has no write objects`);
  if (t['access'] === 'write' && write === undefined) throw new Error(`${key}: access write needs a write object`);
  if (write !== undefined && t['access'] !== 'write') throw new Error(`${key}: a write object needs access write`);
  const typed = write?.typedConfirm;
  if (typed?.kind === 'whenValue' && typed.value === undefined) throw new Error(`${key}: typedConfirm whenValue needs a value`);
  if (typed?.kind === 'increaseFactor' && typed.factor === undefined) throw new Error(`${key}: typedConfirm increaseFactor needs a factor`);
}

function checkUnit(key: string, unit: unknown, values: readonly ValueDef[] | undefined): void {
  if (unit === 'enum' && values === undefined) throw new Error(`${key}: unit enum needs values`);
  if (values !== undefined && unit !== 'enum' && unit !== 'microsteps') throw new Error(`${key}: values need unit enum or microsteps`);
}

function resolve(key: string, t: RawToken, file: RawFile, groups: ReadonlySet<string>): SettingDefinition {
  const left = unresolved(t);
  if (left !== null) throw new Error(`${key}: unresolved ${left}`);
  const { values, labelSrc } = valuesOf(key, t, file);
  checkUnit(key, t['unit'], values);
  checkWrite(key, t, file);
  if (!groups.has(t['group'] as string)) throw new Error(`${key}: unknown group "${String(t['group'])}"`);
  const def: Record<string, unknown> = { key };
  for (const f of ['label', 'short', 'description', 'unit', 'group', 'tab', 'access', 'src'] as const) def[f] = t[f];
  for (const f of OPTIONAL) if (t[f] !== undefined) def[f] = t[f];
  if (values !== undefined) def['values'] = values;
  if (def['labelSrc'] === undefined && labelSrc !== undefined) def['labelSrc'] = labelSrc;
  if (t['write'] !== undefined) def['write'] = t['write'];
  return deepFreeze(structuredClone(def)) as unknown as SettingDefinition;
}

function present(def: SettingDefinition, fb: number | undefined): boolean {
  if (fb === undefined) return true;
  return (def.since === undefined || fb >= def.since) && (def.until === undefined || fb < def.until);
}

function checkProbeContact(file: RawFile, defined: ReadonlySet<string>): void {
  const pc = file.probeContact;
  if (pc === undefined) return;
  if ((pc.token === undefined) === (pc.fixed === undefined)) throw new Error('probeContact: exactly one of token or fixed');
  if (pc.token !== undefined && !defined.has(pc.token)) throw new Error(`probeContact: token "${pc.token}" is not defined`);
}

function rawTokens(file: RawFile): [string, RawToken][] {
  return [...(file.families ?? []).flatMap(expandFamily), ...Object.entries(file.tokens)];
}

/** Validates and expands a settings file for build `fb` (default: the lowest build the file serves). */
export function expandSettingsFile(raw: unknown, fb?: number): SettingsFile {
  const file = validated(raw);
  const at = fb ?? file.firmware.fb.min;
  const groups = new Set(file.groups.map((g: GroupDefinition) => g.id));
  const seen = new Set<string>();
  const tokens: [string, SettingDefinition][] = [];
  for (const [key, t] of rawTokens(file)) {
    if (seen.has(key)) throw new Error(`${key}: defined twice`);
    seen.add(key);
    const def = resolve(key, t, file, groups);
    if (present(def, at)) tokens.push([key, def]);
  }
  checkProbeContact(file, seen);
  const { enums: _enums, families: _families, tokens: _raw, ...header } = file;
  return Object.freeze({ ...deepFreeze(structuredClone(header)), tokens: frozenMap(tokens) });
}
