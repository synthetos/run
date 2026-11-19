/**
 * A setting in plain words, read from the dialect's settings file (Board
 * settings spec §4.3): its name, its value spelled out with its unit, and why
 * it is not written. A dialect without a file shows the token and the raw
 * number; nothing here invents a meaning.
 */
import { settingsDefsFor, type DefinitionUnit, type SettingAccess, type SettingDefinition, type SettingValue, type ValueDef } from '@synthetos/schema';
import { valueText } from '../../machine-ui/SettingsView.ts';
import type { LiveView } from '../model.ts';
import { boardBuild } from './defs.ts';
import { numberWords, unitWords, withUnit } from './units.ts';

export interface SettingMeta {
  readonly key: string;
  /** The raw token, shown beside the name at Advanced only (OD-44). */
  readonly token: string;
  readonly label: string;
  /** The name inside its group ("Microsteps" under Motor 1). */
  readonly short: string;
  /** The unit as it reads beside a number ("million mm/min³"); empty for enumerations. */
  readonly unit: string;
  readonly description: string;
  /** Every allowed value by meaning, when the data lists them. */
  readonly values: readonly ValueDef[] | null;
  readonly hwAllowed: readonly number[] | null;
  /** Null when the dialect has no definition for the token. */
  readonly access: SettingAccess | null;
  readonly reason: string | null;
  readonly def: SettingDefinition | null;
}

function definition(key: string, dialect: string | null, fb?: number): SettingDefinition | null {
  return settingsDefsFor(dialect ?? 'tinyg-en', fb)?.tokens.get(key) ?? null;
}

/** A token with no definition: shown as itself, never described, never writable. */
function rawMeta(key: string): SettingMeta {
  return { key, token: key, label: key, short: key, unit: '', description: '', values: null, hwAllowed: null, access: null, reason: null, def: null };
}

function metaOf(d: SettingDefinition): SettingMeta {
  return {
    key: d.key,
    token: d.key,
    label: d.label,
    short: d.short,
    unit: unitWords(d.unit as DefinitionUnit),
    description: d.description,
    values: d.values ?? null,
    hwAllowed: d.write?.hwAllowed ?? null,
    access: d.access,
    reason: d.reason ?? null,
    def: d,
  };
}

export function settingMeta(key: string, dialect: string | null = null, fb?: number): SettingMeta {
  const d = definition(key, dialect, fb);
  return d === null ? rawMeta(key) : metaOf(d);
}

/** The definition as it reads with these settings: its rotary unit when its motor drives A, B or C (data `rotary`). */
export function withRotary(d: SettingDefinition | null, settings: Readonly<Record<string, SettingValue>>): SettingDefinition | null {
  const r = d?.rotary;
  if (d === null || r === undefined) return d;
  const v = settings[r.when];
  return typeof v === 'number' && r.in.includes(v) ? { ...d, unit: r.unit } : d;
}

/** The meta as the setting reads with these settings (a motor on a rotary axis reads degrees). */
export function metaWith(meta: SettingMeta, settings: Readonly<Record<string, SettingValue>>): SettingMeta {
  const d = withRotary(meta.def, settings);
  return d === null || d === meta.def ? meta : metaOf(d);
}

/**
 * The words for one value of a definition: its value label, "Unknown value (n)" outside the list, or the number with
 * its unit. With `inches` (the board reports G20), a length (`convert`) reads in inches: the board's number is inches.
 */
export function valueWordsOf(d: SettingDefinition | null, v: number, inches = false): string {
  if (d === null) return numberWords(v);
  if (d.values !== undefined) return d.values.find((e) => e.value === v)?.label ?? `Unknown value (${numberWords(v)})`;
  return withUnit(v, d.unit, d.display, inches && d.convert === true);
}

/** The board reports inches (`unit` 0, G20). */
export function boardInches(view: LiveView | null): boolean {
  return view?.message?.snapshot.live.unit === 0;
}

/** A setting's value as the connected board reported it, in words and in the board's units, or null when not read. */
export function boardValueWords(key: string, view: LiveView | null): string | null {
  const v = view?.readout.settings[key];
  if (v === undefined) return null;
  if (typeof v !== 'number') return valueText(v);
  const d = withRotary(definition(key, view?.readout.dialectId ?? null, boardBuild(view)), view?.readout.settings ?? {});
  return valueWordsOf(d, v, boardInches(view));
}

/** A setting's value in plain words ("Homing and limit", "1.8° per step"), or null when not read. */
export function plainValue(key: string, v: SettingValue | undefined, dialect: string | null = null, fb?: number): string | null {
  if (v === undefined) return null;
  if (typeof v === 'number') return valueWordsOf(definition(key, dialect, fb), v);
  return valueText(v);
}
