import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import {
  connectorPins,
  dialectOf,
  plainValue,
  settingMeta,
  settingsOf
} from '../../boardFacts.ts';
import { connected, type LiveView } from '../../model.ts';
import { Dismissable } from '../../notes/Dismissable.ts';
import { editBlocked } from '../../settings/editGate.ts';
import { coolantText, displayReadouts, spindleText } from '../../status.ts';
import { EditToggle, cell } from './shared.ts';

export function OutputsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [editing, setEditing] = useState(false);
  const edit = editing && editBlocked(view) === null ? view : null;
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const pins = connectorPins('J6');
  const snapshot = view !== null && connected(view) ? view.message?.snapshot : undefined;
  const r = displayReadouts(snapshot);
  const pwm = Object.keys(settings).filter((k) => /^p1/.test(k)).sort();
  const srList = snapshot?.live.srList;
  const missing = srList !== undefined && !['spe', 'spc', 'sps', 'cof', 'com'].every((k) => srList.includes(k));
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll' },
    h(EditToggle, { view, editing, onToggle: () => setEditing((e) => !e) }),
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'J6 spindle and coolant'),
      h(
        'table',
        { class: 'cfg-table' },
        h('thead', null, h('tr', null, ...['Pin', 'Name', 'What it does', 'Polarity', 'Chip pin'].map((t) => h('th', { scope: 'col', key: t }, t)))),
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
              p.signal === 'out.spindleEnable' ? cell('spep', settings, dialect, edit) : p.signal === 'out.spindleDirection' ? cell('spdp', settings, dialect, edit) : p.signal === 'out.spindlePwm' ? cell('spph', settings, dialect) : p.signal === 'out.coolant' ? cell('coph', settings, dialect) : h('td', { class: 'muted' }, 'Not applicable'),
              h('td', { class: 'mono' }, p.mcu ?? 'Not applicable'),
            ),
          ),
        ),
      ),
      h(Dismissable, { id: 'board/coolant-shared', label: 'the coolant note', inNotes: false }, h('p', { class: 'fine' }, 'Mist and flood share the one coolant output on this board.')),
    ),
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'Reported now'),
      h(
        'dl',
        { class: 'facts inline-facts' },
        h('div', null, h('dt', null, 'Spindle', h('small', { class: 'raw-key' }, 'spe spc sps')), h('dd', null, spindleText(r))),
        h('div', null, h('dt', null, 'Coolant', h('small', { class: 'raw-key' }, 'cof com')), h('dd', null, coolantText(r))),
      ),
      h('p', { class: 'fine' }, missing ? 'This board’s status list does not carry these: they were read once at connect and change only when the list carries them. Display only: never rely on them for safety.' : 'From the board’s status reports. Display only: never rely on them for safety.'),
    ),
    pwm.length === 0
      ? null
      : h(
        'section',
        { class: 'cfg-section' },
        h('h3', { class: 'tan-label' }, 'Spindle speed output (PWM)'),
        h('dl', { class: 'facts inline-facts' }, pwm.map((k) => h('div', { key: k }, h('dt', null, settingMeta(k, dialect).label, h('small', { class: 'raw-key' }, k)), h('dd', null, plainValue(k, settings[k], dialect) ?? 'Not read')))),
      ),
  );
}
