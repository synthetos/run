/**
 * The rows of All settings (Board settings spec §5.7, OD-44): the plain name (the raw token beside it at Advanced),
 * the value once with the same control as the tabs, and why a setting is locked unless its group header already says
 * so. Across groups (a search) a title line comes before each group's rows. Every line is one fixed-height row, so a
 * page of them fits the window (owner walk 2026-11-19: no scrolling).
 */
import { h, type ComponentChild } from 'preact';
import type { SettingDefinition, SettingsFile } from '@synthetos/schema';
import { draftStore } from '../boardFacts.ts';
import type { LiveView } from '../model.ts';
import { readOnlyGroup, type SettingsItem } from './allSettingsModel.ts';
import { SettingControl } from './SettingControl.ts';

export interface TableProps {
  readonly items: readonly SettingsItem[];
  readonly defs: SettingsFile | null;
  readonly view: LiveView | null;
  readonly advanced: boolean;
  readonly open: string | null;
  readonly setOpen: (k: string | null) => void;
}

const LOCKED = new Set(['read', 'forbidden', 'reserved', 'readout']);

/** The reason a setting is not written, as a tag, unless its group header already says why. */
function lockTag(d: SettingDefinition | null, show: boolean): ComponentChild {
  return show && d !== null && LOCKED.has(d.access) && d.reason !== undefined ? h('span', { class: 'tag', 'data-lock': '' }, d.reason) : null;
}

/** The plain name; at Advanced the raw token beside it (OD-44: the token with the text, never alone). */
function NameCell({ d, k, advanced, open, onInfo }: { readonly d: SettingDefinition | null; readonly k: string; readonly advanced: boolean; readonly open: boolean; readonly onInfo: () => void }): ComponentChild {
  if (d === null) return h('th', { scope: 'row' }, k);
  return h('th', { scope: 'row' }, d.label, advanced ? h('code', { class: 'raw-key' }, k) : null, h('button', { type: 'button', class: 'icon-button quiet info-toggle', 'aria-label': `What ${d.label} does`, 'aria-expanded': open ? 'true' : 'false', onClick: onInfo }, 'i'));
}

function Row({ k, group, p }: { readonly k: string; readonly group: string; readonly p: TableProps }): ComponentChild {
  const d = p.defs?.tokens.get(k) ?? null;
  return h(
    'tr',
    { 'data-key': k, class: draftStore.value.value[k] === undefined ? undefined : 'drafted' },
    h(NameCell, { d, k, advanced: p.advanced, open: p.open === k, onInfo: () => p.setOpen(p.open === k ? null : k) }),
    h('td', { 'data-value': '' }, h(SettingControl, { k, view: p.view }), lockTag(d, !readOnlyGroup(p.defs, group))),
  );
}

/** One page of lines: setting rows, and a group's title line when the list spans groups. */
export function SettingsTable(p: TableProps): ComponentChild {
  return h(
    'table',
    { class: 'cfg-table all-settings' },
    h('tbody', null, p.items.map((i) => (i.kind === 'group'
      ? h('tr', { key: `#${i.group.id}`, class: 'group-row', 'data-group': i.group.id }, h('th', { colSpan: 2, scope: 'rowgroup' }, i.group.title))
      : h(Row, { key: i.key, k: i.key, group: i.group, p })))),
  );
}
