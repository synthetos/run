import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { AxisModes } from '../../../machine-ui/AxisModes.ts';
import {
  dialectOf,
  plainValue,
  settingMeta,
  settingsOf
} from '../../boardFacts.ts';
import { type LiveView } from '../../model.ts';
import { Dismissable } from '../../notes/Dismissable.ts';
import { editBlocked, SettingEditor } from '../../settings/SettingsUi.ts';
import { cell, EditToggle, Empty, type Settings } from './shared.ts';

const AXIS_MOTION = ['am', 'vm', 'fr', 'tn', 'tm', 'jm', 'jd'] as const;

const AXIS_HOMING = ['sn', 'sx', 'sv', 'lv', 'lb', 'zb', 'jh'] as const;

const MOTION_HEAD = ['Mode', 'Max velocity', 'Max feed', 'Travel min', 'Travel max', 'Jerk', 'Junction deviation'];

const HOMING_HEAD = ['Min switch', 'Max switch', 'Search velocity', 'Latch velocity', 'Latch backoff', 'Zero backoff', 'Homing jerk'];

function axisTable({ title, head, fields, settings, dialect, edit = null }: { readonly title: string; readonly head: readonly string[]; readonly fields: readonly string[]; readonly settings: Settings; readonly dialect: string | null; readonly edit?: LiveView | null }): ComponentChild {
  const axes = ['x', 'y', 'z', 'a', 'b', 'c'].filter((a) => fields.some((f) => settings[`${a}${f}`] !== undefined));
  return h(
    'section',
    { class: 'cfg-section' },
    h('h3', { class: 'tan-label' }, title),
    h(
      'table',
      { class: 'cfg-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), ...head.map((t) => h('th', { scope: 'col', key: t }, t)))),
      h('tbody', null, axes.map((a) => h('tr', { key: a }, h('th', { scope: 'row' }, a.toUpperCase()), ...fields.map((f) => (settings[`${a}${f}`] === undefined ? h('td', { key: f, class: 'muted' }, 'Unknown') : cell(`${a}${f}`, settings, dialect, edit)))))),
    ),
  );
}

export function AxesTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [editing, setEditing] = useState(false);
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  if (settings['xam'] === undefined) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  const edit = editing && editBlocked(view) === null ? view : null;
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll' },
    h(EditToggle, { view, editing, onToggle: () => setEditing((e) => !e) }),
    view?.axisModes === null || view?.axisModes === undefined
      ? null
      : // All clear is only information (a ×); a mode that would block motion stays.
      view.axisModes.kind === 'facts' && view.axisModes.facts.length === 0
        ? h(Dismissable, { id: 'board/axis-modes-clear', label: 'the axis modes note', inNotes: false, class: 'dismissable-card' }, h(AxisModes, { view: view.axisModes }))
        : h(AxisModes, { view: view.axisModes }),
    axisTable({ title: 'Motion', head: MOTION_HEAD, fields: AXIS_MOTION, settings: settings, dialect: dialect, edit: edit }),
    axisTable({ title: 'Homing and switches', head: HOMING_HEAD, fields: AXIS_HOMING, settings: settings, dialect: dialect, edit: edit }),
    h('dl', { class: 'facts inline-facts' }, ...['st', 'sl', 'mt', 'ja', 'ct'].map((k) => h('div', { key: k }, h('dt', null, settingMeta(k, dialect).label, h('small', { class: 'raw-key' }, k)), h('dd', null, plainValue(k, settings[k], dialect) ?? 'Not read', edit === null ? null : h('div', { class: 'cell-edit' }, h(SettingEditor, { k, view: edit, compact: true })))))),
  );
}
