/**
 * All settings (Board settings spec §5.7, OD-44, mockup 2026-11-18-board-config-all-settings): every setting the
 * board reported, at both levels, grouped by the settings file, with the same control as the tabs. Simple shows the
 * plain name and the value in words; Advanced adds the raw token beside them. A small "i" opens the description on
 * its own line. Search by name, value words or token; one group at a time; only pending changes.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import type { SettingDefinition, SettingsFile } from '@synthetos/schema';
import { draftStore } from '../boardFacts.ts';
import { uiLevel } from '../jobWorkflow.ts';
import type { LiveView } from '../model.ts';
import { allSettingsRows, readOnlyGroup, type SettingsGroupRows } from './allSettingsModel.ts';
import { defsFor } from './defs.ts';
import { SettingControl } from './SettingControl.ts';
import { StatusFields } from './statusFields.ts';

interface RowProps {
  readonly k: string;
  readonly defs: SettingsFile | null;
  readonly view: LiveView | null;
  readonly advanced: boolean;
  readonly lockTags: boolean;
  readonly open: boolean;
  readonly onInfo: () => void;
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

/** One row: the name, then the value once (the same control as the tabs, in the board's units), then why it is locked. */
function Row(p: RowProps): ComponentChild {
  const d = p.defs?.tokens.get(p.k) ?? null;
  return [
    h(
      'tr',
      { key: p.k, 'data-key': p.k, class: draftStore.value.value[p.k] === undefined ? undefined : 'drafted' },
      h(NameCell, { d, k: p.k, advanced: p.advanced, open: p.open, onInfo: p.onInfo }),
      h('td', { 'data-value': '' }, h(SettingControl, { k: p.k, view: p.view }), lockTag(d, p.lockTags)),
    ),
    p.open && d !== null ? h('tr', { key: `${p.k}-desc`, class: 'desc-row' }, h('td', { colSpan: 2, class: 'settings-desc' }, d.description)) : null,
  ];
}

function Group({ g, defs, view, advanced, open, setOpen }: { readonly g: SettingsGroupRows; readonly defs: SettingsFile | null; readonly view: LiveView | null; readonly advanced: boolean; readonly open: string | null; readonly setOpen: (k: string | null) => void }): ComponentChild {
  const lockTags = !readOnlyGroup(defs, g.group.id);
  return h(
    'tbody',
    { key: g.group.id, 'data-group': g.group.id },
    h('tr', { class: 'group-row' }, h('th', { colSpan: 2, scope: 'rowgroup' }, h('span', null, g.group.title), h('small', null, g.group.explanation))),
    g.group.id === 'status-report' ? h('tr', { class: 'fields-row' }, h('td', { colSpan: 2 }, h(StatusFields, { view }))) : null,
    g.rows.map((k) => h(Row, { key: k, k, defs, view, advanced, lockTags, open: open === k, onInfo: () => setOpen(open === k ? null : k) })),
  );
}

function Chips({ defs, current, advanced, onPick }: { readonly defs: SettingsFile | null; readonly current: string | null; readonly advanced: boolean; readonly onPick: (id: string | null) => void }): ComponentChild {
  if (defs === null) return null;
  const listed = defs.groups.filter((g) => advanced || g.level !== 'advanced');
  return h(
    'div',
    { class: 'chips settings-chips', role: 'group', 'aria-label': 'Groups' },
    [{ id: null, title: 'All' }, ...listed].map((g) => h('button', { key: g.id ?? 'all', type: 'button', class: `chip${current === g.id ? ' on' : ''}`, 'aria-pressed': current === g.id ? 'true' : 'false', onClick: () => onPick(g.id) }, g.title)),
  );
}

export function AllSettings({ view, id = 'all-settings-title' }: { readonly view: LiveView | null; readonly id?: string }): ComponentChild {
  const [text, setText] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const settings = view?.readout.settings ?? {};
  const defs = defsFor(view);
  const advanced = uiLevel.value.value === 'advanced';
  const groups = allSettingsRows(defs, settings, draftStore.value.value, { text, group, pendingOnly, level: advanced ? 'advanced' : 'simple' });
  const total = Object.keys(settings).length;
  return h(
    'section',
    { class: 'settings-table', 'data-region': 'all-settings', 'aria-labelledby': id },
    h(
      'div',
      { class: 'settings-tools' },
      h('h2', { id }, 'All settings'),
      h('input', { type: 'search', class: 'settings-search', placeholder: 'Search by name, value or token', 'aria-label': 'Search settings', value: text, onInput: (e: Event) => setText((e.currentTarget as HTMLInputElement).value) }),
      h('label', { class: 'settings-filter' }, h('input', { type: 'checkbox', 'aria-label': 'Only pending changes', checked: pendingOnly, onChange: (e: Event) => setPendingOnly((e.currentTarget as HTMLInputElement).checked) }), ' Only pending'),
      h('span', { class: 'fine' }, total === 0 ? '' : `${total} settings`),
    ),
    h(Chips, { defs, current: group, advanced, onPick: setGroup }),
    total === 0
      ? null
      : h(
          'table',
          { class: 'cfg-table all-settings' },
          h('thead', null, h('tr', null, ...['Setting', 'Value'].map((t) => h('th', { scope: 'col', key: t }, t)))),
          groups.map((g) => h(Group, { key: g.group.id, g, defs, view, advanced, open, setOpen })),
        ),
    h('p', { class: 'fine settings-foot' }, 'Live readouts (input states, homed axes, positions) are on Inputs, Axes and the Job view.'),
  );
}
