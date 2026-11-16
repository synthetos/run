import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import {
  connectorPins,
  dialectOf,
  plainValue,
  settingMeta,
  settingsOf
} from '../../boardFacts.ts';
import { type LiveView } from '../../model.ts';
import { Dismissable } from '../../notes/Dismissable.ts';
import { SettingEditor, editBlocked } from '../../settings/SettingsUi.ts';
import { Keyed } from '../../ui.ts';
import { EditToggle, cell } from './shared.ts';

export function InputsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [editing, setEditing] = useState(false);
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const pins = [...connectorPins('J7'), ...connectorPins('J8')].filter((p) => p.role === 'input');
  const st = plainValue('st', settings['st'], dialect);
  const edit = editing && editBlocked(view) === null ? view : null;
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll' },
    h(EditToggle, { view, editing, onToggle: () => setEditing((e) => !e) }),
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'Switch inputs'),
      h(
        'table',
        { class: 'cfg-table' },
        h('thead', null, h('tr', null, ...['Pin', 'Name', 'Input', 'What it does', 'Contact', 'Chip pin'].map((t) => h('th', { scope: 'col', key: t }, t)))),
        h(
          'tbody',
          null,
          pins.map((p) =>
            h(
              'tr',
              { key: p.ref },
              h('th', { scope: 'row' }, h('span', { class: 'pin-ref' }, p.ref)),
              h('td', null, h('strong', null, p.label)),
              h('td', null, p.function),
              cell(p.keys[0] as string, settings, dialect, edit),
              h('td', null, h(Keyed, { value: st ?? 'Not read', raw: 'st' })),
              h('td', { class: 'mono' }, p.mcu ?? 'Not applicable'),
            ),
          ),
        ),
      ),
      h(Dismissable, { id: 'board/inputs-pullups', label: 'the inputs note', inNotes: false }, h('p', { class: 'fine' }, 'One switch type applies to all inputs. Inputs have 2.7 kΩ pull-ups to 3.3 V.')),
      edit === null ? null : h('dl', { class: 'facts inline-facts' }, h('div', null, h('dt', null, settingMeta('st', dialect).label, h('small', { class: 'raw-key' }, 'st')), h('dd', null, st ?? 'Not read', h('div', { class: 'cell-edit' }, h(SettingEditor, { k: 'st', view: edit, compact: true }))))),
    ),
  );
}
