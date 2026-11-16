import { h, type ComponentChild } from 'preact';
import {
  dialectOf,
  plainValue,
  settingMeta,
  settingsOf
} from '../../boardFacts.ts';
import { connected, type LiveView } from '../../model.ts';
import { Dismissable } from '../../notes/Dismissable.ts';
import { Empty } from './shared.ts';

export function CommsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const srList = view !== null && connected(view) ? view.message?.snapshot.live.srList : undefined;
  if (settings['ej'] === undefined && srList === undefined) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region cfg-scroll' },
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'Serial link'),
      h('dl', { class: 'facts inline-facts' }, ...['baud', 'ex', 'ec', 'ee', 'ej', 'jv', 'js', 'tv', 'qv', 'sv', 'si', 'rxm'].filter((k) => settings[k] !== undefined).map((k) => h('div', { key: k }, h('dt', null, settingMeta(k, dialect).label, h('small', { class: 'raw-key' }, k)), h('dd', null, `${plainValue(k, settings[k], dialect) ?? 'Not read'}${k === 'si' ? ' ms' : ''}`)))),
      h(Dismissable, { id: 'board/comms-read-only', label: 'the communication settings note', inNotes: false }, h('p', { class: 'fine' }, 'Read-only communication settings. Changing them can prevent senders from connecting.')),
    ),
    h(
      'section',
      { class: 'cfg-section' },
      h('h3', { class: 'tan-label' }, 'Status report list'),
      srList === undefined ? h('p', { class: 'fine' }, 'Read when the board answers the first status request.') : h('ul', { class: 'key-chips', 'aria-label': 'Fields in the status report' }, srList.map((k) => h('li', { key: k }, settingMeta(k, dialect).label, h('code', { class: 'raw-key' }, k)))),
      h(Dismissable, { id: 'board/sr-list', label: 'the status report list note', inNotes: false }, h('p', { class: 'fine' }, 'Fields reported by this board. Read only.')),
    ),
  );
}
