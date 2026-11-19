/**
 * The Communications tab (Board settings spec §5.6b): the communication and status-report settings spelled out from
 * the settings file, one sentence for why Run never changes them (H61), and the fields the board puts in its status
 * reports. A dialect without a file shows the values raw under "No definition yet".
 */
import { h, type ComponentChild } from 'preact';
import type { SettingsFile } from '@synthetos/schema';
import { settingMeta, settingsOf } from '../../boardFacts.ts';
import { connected, type LiveView } from '../../model.ts';
import { defsFor } from '../../settings/defs.ts';
import { SettingControl } from '../../settings/SettingControl.ts';
import { Empty } from './shared.ts';

/** Communication keys shown raw when the dialect has no settings file. */
const RAW_KEYS = ['baud', 'ex', 'ec', 'ee', 'ej', 'jv', 'js', 'tv', 'qv', 'sv', 'si', 'rxm', 'net'];

function Rows({ keys, view, label }: { readonly keys: readonly string[]; readonly view: LiveView | null; readonly label: (k: string) => string }): ComponentChild {
  return h('table', { class: 'cfg-table axis-table' }, h('tbody', null, keys.map((k) => h('tr', { key: k }, h('th', { scope: 'row' }, label(k)), h('td', null, h(SettingControl, { k, view }))))));
}

function Groups({ defs, view }: { readonly defs: SettingsFile; readonly view: LiveView | null }): ComponentChild {
  const settings = view?.readout.settings ?? {};
  return h('div', { class: 'comms-groups' }, ['communications', 'status-report'].map((id) => {
    const group = defs.groups.find((g) => g.id === id);
    const keys = [...defs.tokens.values()].filter((d) => d.group === id && settings[d.key] !== undefined).map((d) => d.key);
    if (group === undefined || keys.length === 0) return null;
    return h(
      'section',
      { key: id, class: 'board-card' },
      h('div', { class: 'sec-head' }, h('h3', { class: 'card-title' }, group.title), h('span', { class: 'fine' }, group.explanation)),
      h(Rows, { keys, view, label: (k) => defs.tokens.get(k)?.short ?? k }),
    );
  }));
}

function StatusList({ view }: { readonly view: LiveView | null }): ComponentChild {
  const srList = view !== null && connected(view) ? view.message?.snapshot.live.srList : undefined;
  const dialect = view?.readout.dialectId ?? null;
  return h(
    'section',
    { class: 'board-card' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'card-title' }, 'Status report fields'), h('span', { class: 'fine' }, 'What the board puts in each status report.')),
    srList === undefined ? h('p', { class: 'fine' }, 'Read when the board answers the first status request.') : h('ul', { class: 'key-chips', 'aria-label': 'Fields in the status report' }, srList.map((k) => h('li', { key: k }, settingMeta(k, dialect).label, h('code', { class: 'raw-key' }, k)))),
  );
}

export function CommsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  const srList = view !== null && connected(view) ? view.message?.snapshot.live.srList : undefined;
  if (settings['ej'] === undefined && srList === undefined) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  const defs = defsFor(view);
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll comms-tab' },
    h('p', { class: 'note info', 'data-comms-why': '' }, 'Run never changes these settings: they decide how the board and Run talk to each other.'),
    defs === null
      ? h('section', { class: 'board-card' }, h('div', { class: 'sec-head' }, h('h3', { class: 'card-title' }, 'No definition yet'), h('span', { class: 'fine' }, 'Reported by the board. Run has no description for these, so they are shown as read and never changed.')), h(Rows, { keys: RAW_KEYS.filter((k) => settings[k] !== undefined), view, label: (k) => k }))
      : h(Groups, { defs, view }),
    h(StatusList, { view }),
  );
}
