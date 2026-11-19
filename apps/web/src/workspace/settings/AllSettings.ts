/**
 * All settings (Board settings spec §5.7, OD-44, mockup 2026-11-18-board-config-all-settings): every setting the
 * board reported, at both levels, grouped by the settings file, with the same control as the tabs. Simple shows the
 * plain name and the value in words; Advanced adds the raw token beside them. Owner walk 2026-11-19 (no scrolling):
 * the group chips act as tabs and show one group at a time; a search or "Only pending" looks across every group; the
 * rows page to fit the window; a small "i" opens the description in one line under the list.
 */
import { h, type ComponentChild } from 'preact';
import { signal } from '@preact/signals';
import { useRef, useState } from 'preact/hooks';
import type { SettingsFile } from '@synthetos/schema';
import { draftStore } from '../boardFacts.ts';
import { uiLevel } from '../jobWorkflow.ts';
import type { LiveView } from '../model.ts';
import { allSettingsRows, pageOf, settingsItems, type SettingsGroupRows } from './allSettingsModel.ts';
import { SettingsTable } from './allSettingsTable.ts';
import { defsFor } from './defs.ts';
import { usePageSize } from './pageSize.ts';
import { StatusFields } from './statusFields.ts';

/** The group shown (null: the first one), kept across visits to other tabs. */
export const settingsGroup = signal<string | null>(null);
const settingsPage = signal(0);
const LINE_PX = 34;
const FOOT = 'Live readouts (input states, homed axes, positions) are on Inputs, Axes and the Job view.';

function pick(id: string): void {
  settingsGroup.value = id;
  settingsPage.value = 0;
}

function Chips({ groups, current }: { readonly groups: readonly SettingsGroupRows[]; readonly current: string | null }): ComponentChild {
  return h(
    'div',
    { class: 'chips settings-chips', role: 'group', 'aria-label': 'Groups' },
    groups.map((g) => h('button', { key: g.group.id, type: 'button', class: `chip${current === g.group.id ? ' on' : ''}`, 'data-group-chip': g.group.id, 'aria-pressed': current === g.group.id ? 'true' : 'false', onClick: () => pick(g.group.id) }, g.group.title)),
  );
}

/** The shown group's title and what it holds; the Status report group also lists the fields in each report. */
function GroupHead({ g, view }: { readonly g: SettingsGroupRows | undefined; readonly view: LiveView | null }): ComponentChild {
  if (g === undefined) return null;
  return h('div', { class: 'settings-group-head', 'data-group': g.group.id }, h('h3', null, g.group.title), h('small', null, g.group.explanation), g.group.id === 'status-report' ? h(StatusFields, { view }) : null);
}

function Pager({ page, pages }: { readonly page: number; readonly pages: number }): ComponentChild {
  const go = (p: number): void => { settingsPage.value = p; };
  return h(
    'div',
    // Always there, so showing it never changes the space the rows get; hidden by class (no inline style: CSP).
    { class: `settings-pager${pages === 1 ? ' single' : ''}`, 'data-pages': String(pages) },
    h('button', { type: 'button', class: 'small', 'data-action': 'settings-page-back', disabled: page === 0, onClick: () => go(page - 1) }, 'Back'),
    h('span', { class: 'fine' }, `Page ${page + 1} of ${pages}`),
    h('button', { type: 'button', class: 'small', 'data-action': 'settings-page-next', disabled: page >= pages - 1, onClick: () => go(page + 1) }, 'Next'),
  );
}

/** One line under the list: the open setting's description, else where the live readouts are. */
function Description({ defs, open }: { readonly defs: SettingsFile | null; readonly open: string | null }): ComponentChild {
  const d = open === null ? undefined : defs?.tokens.get(open);
  return h('p', { class: 'fine settings-desc', 'data-settings-desc': open ?? '' }, d === undefined ? FOOT : `${d.label}: ${d.description}`);
}

function Tools({ text, setText, pendingOnly, setPendingOnly, total, id }: { readonly text: string; readonly setText: (t: string) => void; readonly pendingOnly: boolean; readonly setPendingOnly: (v: boolean) => void; readonly total: number; readonly id: string }): ComponentChild {
  return h(
    'div',
    { class: 'settings-tools' },
    h('h2', { id }, 'All settings'),
    h('input', { type: 'search', class: 'settings-search', placeholder: 'Search every group by name, value or token', 'aria-label': 'Search settings', value: text, onInput: (e: Event) => { settingsPage.value = 0; setText((e.currentTarget as HTMLInputElement).value); } }),
    h('label', { class: 'settings-filter' }, h('input', { type: 'checkbox', 'aria-label': 'Only pending changes', checked: pendingOnly, onChange: (e: Event) => { settingsPage.value = 0; setPendingOnly((e.currentTarget as HTMLInputElement).checked); } }), ' Only pending'),
    h('span', { class: 'fine' }, total === 0 ? '' : `${total} settings`),
  );
}

export function AllSettings({ view, id = 'all-settings-title' }: { readonly view: LiveView | null; readonly id?: string }): ComponentChild {
  const [text, setText] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const size = usePageSize(box, LINE_PX);
  const settings = view?.readout.settings ?? {};
  const defs = defsFor(view);
  const advanced = uiLevel.value.value === 'advanced';
  const level = advanced ? 'advanced' : 'simple';
  const drafts = draftStore.value.value;
  const groups = allSettingsRows(defs, settings, drafts, { text: '', group: null, pendingOnly: false, level });
  const across = text.trim() !== '' || pendingOnly;
  const current = groups.some((g) => g.group.id === settingsGroup.value) ? settingsGroup.value : (groups[0]?.group.id ?? null);
  const shown = across ? allSettingsRows(defs, settings, drafts, { text, group: null, pendingOnly, level }) : groups.filter((g) => g.group.id === current);
  const page = pageOf(settingsItems(shown, across), settingsPage.value, size);
  return h(
    'section',
    { class: 'settings-table', 'data-region': 'all-settings', 'aria-labelledby': id },
    h(Tools, { text, setText, pendingOnly, setPendingOnly, total: Object.keys(settings).length, id }),
    h(Chips, { groups, current: across ? null : current }),
    across ? null : h(GroupHead, { g: shown[0], view }),
    h('div', { class: 'settings-page', ref: box }, h(SettingsTable, { items: page.items, defs, view, advanced, open, setOpen })),
    h(Pager, { page: page.page, pages: page.pages }),
    h(Description, { defs, open }),
  );
}
