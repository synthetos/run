/**
 * All settings as data (Board settings spec §5.7). Pure: every setting the board reported, grouped by the settings
 * file's groups in their order, then "No definition yet" for tokens the file does not describe; search over the
 * name, the value in words and the token; one group at a time; only pending changes.
 */
import type { GroupDefinition, SettingValue, SettingsFile } from '@synthetos/schema';
import { valueWordsOf } from './meta.ts';

type Settings = Readonly<Record<string, SettingValue>>;
type Drafts = Readonly<Record<string, number>>;

export interface AllSettingsQuery {
  readonly text: string;
  readonly group: string | null;
  readonly pendingOnly: boolean;
  /** Groups the data marks `level: advanced` (settings Run owns) are listed at Advanced only. */
  readonly level: 'simple' | 'advanced';
}

export interface SettingsGroupRows {
  readonly group: GroupDefinition;
  readonly rows: readonly string[];
}

export const NO_DEFINITION: GroupDefinition = Object.freeze({
  id: 'none',
  title: 'No definition yet',
  explanation: 'Reported by the board. Run has no description for these, so they are shown as read and never changed.',
});

function words(defs: SettingsFile | null, key: string, v: SettingValue | undefined): string {
  if (v === undefined) return '';
  return typeof v === 'number' ? valueWordsOf(defs?.tokens.get(key) ?? null, v) : v;
}

function matches(defs: SettingsFile | null, settings: Settings, key: string, text: string): boolean {
  if (text === '') return true;
  const d = defs?.tokens.get(key);
  return [key, d?.label ?? '', d?.short ?? '', d?.description ?? '', words(defs, key, settings[key])].some((x) => x.toLowerCase().includes(text));
}

function grouped(defs: SettingsFile | null, settings: Settings): SettingsGroupRows[] {
  const known = defs === null ? [] : defs.groups.map((g) => ({ group: g, rows: [...defs.tokens.values()].filter((d) => d.group === g.id && settings[d.key] !== undefined).map((d) => d.key) }));
  const none = Object.keys(settings).filter((k) => defs?.tokens.get(k) === undefined).sort();
  return [...known, { group: NO_DEFINITION, rows: none }];
}

export function allSettingsRows(defs: SettingsFile | null, settings: Settings, drafts: Drafts, q: AllSettingsQuery): readonly SettingsGroupRows[] {
  const text = q.text.trim().toLowerCase();
  return grouped(defs, settings)
    .filter((g) => q.level === 'advanced' || g.group.level !== 'advanced')
    .filter((g) => q.group === null || g.group.id === q.group)
    .map((g) => ({ group: g.group, rows: g.rows.filter((k) => (!q.pendingOnly || drafts[k] !== undefined) && matches(defs, settings, k, text)) }))
    .filter((g) => g.rows.length > 0);
}

/** A group whose every definition is never written by Run: its header says why, so its rows carry no lock tag. */
export function readOnlyGroup(defs: SettingsFile | null, id: string): boolean {
  if (defs === null || id === NO_DEFINITION.id) return true;
  return [...defs.tokens.values()].every((d) => d.group !== id || d.access !== 'write');
}
