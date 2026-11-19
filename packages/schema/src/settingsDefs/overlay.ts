/**
 * The reviewed write entries of a settings file, in the overlay shape the
 * settings schema, `validate` and the write plan read (spec §4.3). Only a
 * definition with a `write` object becomes an entry: nothing else can ever
 * be validated or written.
 */
import { deepFreeze } from '../frozen.ts';
import type { OverlayEntry, SourceRef, Unit } from '../overlays/types.ts';
import type { SettingDefinition, SettingsFile } from './types.ts';

/** Units only a describe-only token may carry. */
const NOT_WRITTEN_UNITS: ReadonlySet<string> = new Set(['none', 'text', 'Hz', 'mm/min2', 'ratio', 'rpm', 'ms']);

function sourceRef(key: string, src: string): SourceRef {
  const m = /^EN ([a-z_]+\.[ch]):([0-9]+)$/.exec(src);
  if (m === null) throw new Error(`${key}: overlay source must be an EN row, not ${JSON.stringify(src)}`);
  return { tag: 'EN', file: m[1] as string, line: Number(m[2]) };
}

function entryOf(d: SettingDefinition & { readonly write: NonNullable<SettingDefinition['write']> }): OverlayEntry {
  if (NOT_WRITTEN_UNITS.has(d.unit)) throw new Error(`${d.key}: unit ${d.unit} is never written`);
  const values = d.unit === 'enum' && d.values !== undefined ? { values: d.values.map(({ value, label }) => ({ value, label })) } : {};
  return deepFreeze({ key: d.key, label: d.label, description: d.description, unit: d.unit as Unit, ...structuredClone(d.write), ...values, src: sourceRef(d.key, d.src) });
}

/** Every definition with a `write` object, as an overlay entry. */
export function overlayFromDefs(f: SettingsFile): readonly OverlayEntry[] {
  const written = [...f.tokens.values()].filter((d): d is SettingDefinition & { write: NonNullable<SettingDefinition['write']> } => d.write !== undefined);
  return Object.freeze(written.map(entryOf));
}
