import type { SettingValue } from '@synthetos/schema';
import { h, type ComponentChild } from 'preact';
import {
  draftDiff,
  draftStore,
  plainValue,
  settingMeta
} from '../../boardFacts.ts';
import { connected, type LiveView } from '../../model.ts';
import { editBlocked, SettingEditor } from '../../settings/SettingsUi.ts';
import { Keyed } from '../../ui.ts';


export type Settings = Readonly<Record<string, SettingValue>>;

export const NOT_CONNECTED_TEXT = 'Connect a board on the Run view. Its settings appear here, read with GETs only.';

export function fact(label: string, value: string, raw: string, attr?: string): ComponentChild {
  return h('div', { key: raw }, h('dt', null, label, h('small', { class: 'raw-key' }, raw)), h('dd', attr === undefined ? null : { 'data-board-fact': attr }, value));
}

/** A value from the read, plain words first and the raw key after; "Not read" when absent. With `edit`, its editor below. */
export function cell(key: string, settings: Settings, dialect: string | null, edit: LiveView | null = null): ComponentChild {
  if (settingMeta(key, dialect).access === 'reserved') return h('td', { key, class: 'muted' }, h(Keyed, { value: 'Reserved on this firmware', raw: key }));
  const v = plainValue(key, settings[key], dialect);
  const d = draftDiff(key, settings);
  return h(
    'td',
    { key, class: v === null ? 'muted' : undefined, title: settingMeta(key, dialect).description },
    h(Keyed, { value: v ?? 'Unknown', raw: key }),
    d === 'changed' || d === 'unread' ? h('span', { class: 'draft-badge', title: `Pending: ${String(draftStore.value.value[key])}` }, 'pending') : null,
    edit === null ? null : h('div', { class: 'cell-edit' }, h(SettingEditor, { k: key, view: edit, compact: true })),
  );
}

/** "Edit values" for a tab's tables: editors appear under each value Run may write. */
export function EditToggle({ view, editing, onToggle }: { readonly view: LiveView | null; readonly editing: boolean; readonly onToggle: () => void }): ComponentChild {
  const blocked = editBlocked(view);
  return h(
    'div',
    { class: 'edit-bar' },
    h('button', { type: 'button', class: `small${editing ? ' primary' : ''}`, 'data-action': 'toggle-edit', 'aria-pressed': editing ? 'true' : 'false', disabled: blocked !== null, title: blocked ?? 'Edit values; changes collect in Pending changes', onClick: onToggle }, editing ? 'Done editing' : 'Edit values'),
    h('span', { class: 'fine' }, blocked ?? (editing ? 'Review pending changes before applying.' : 'Reported by the board.')),
  );
}

export function Empty({ view }: { readonly view: LiveView | null }): ComponentChild {
  return h('p', { class: 'board-empty' }, view !== null && connected(view) ? 'Waiting for board settings.' : NOT_CONNECTED_TEXT);
}
