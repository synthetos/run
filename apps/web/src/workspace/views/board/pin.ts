import { h, type ComponentChild } from 'preact';
import {
  connectorLabel,
  dialectOf,
  plainValue,
  RESERVED,
  settingMeta,
  settingsOf,
  type PinInfo
} from '../../boardFacts.ts';
import { connected, type LiveView } from '../../model.ts';
import { coolantText, displayReadouts, spindleText } from '../../status.ts';


/** What a pin's settings say, row by row (readouts from the status report or the read-only poll). */
function PinSettings({ pin, view }: { readonly pin: PinInfo; readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  const dialect = dialectOf(view);
  const snapshot = view !== null && connected(view) ? view.message?.snapshot : undefined;
  const r = displayReadouts(snapshot);
  const rows = pin.keys.map((k) => {
    if (RESERVED.has(k)) return [settingMeta(k, dialect).label, 'Reserved on this firmware', k] as const;
    if (k === 'spe') return ['Spindle, reported', spindleText(r), 'spe'] as const;
    if (k === 'cof' || k === 'com') return [k === 'cof' ? 'Flood, reported' : 'Mist, reported', coolantText(r), k] as const;
    if (k === 'spc' || k === 'spd' || k === 'sps') return null;
    return [settingMeta(k, dialect).label, plainValue(k, settings[k], dialect) ?? 'Not read', k] as const;
  });
  const shown = rows.filter((x): x is readonly [string, string, string] => x !== null);
  const coolantSeen = new Set<string>();
  return h(
    'dl',
    { class: 'facts pin-facts' },
    shown
      .filter(([label, value]) => {
        const key = `${label}${value}`;
        if (coolantSeen.has(value) && label.endsWith('reported')) return false;
        coolantSeen.add(value);
        return key !== '';
      })
      .map(([label, value, raw]) => h('div', { key: raw }, h('dt', null, label, h('small', { class: 'raw-key' }, raw)), h('dd', null, value))),
  );
}

export function PinCard({ pin, view, onClose }: { readonly pin: PinInfo; readonly view: LiveView | null; readonly onClose: () => void }): ComponentChild {
  return h(
    'section',
    { class: 'insp pin-card', 'data-pin-card': pin.ref, 'aria-labelledby': 'pin-title' },
    h('header', null, h('h2', { id: 'pin-title' }, h('span', { class: 'pin-ref big' }, pin.ref), ` ${pin.label}`), h('button', { type: 'button', class: 'icon-button quiet', 'data-action': 'clear-pin', 'aria-label': 'Close the pin', onClick: onClose }, '×')),
    h('p', { class: 'pin-function' }, pin.function, pin.mcu === undefined ? null : h('small', { class: 'raw-key' }, ` ${pin.mcu}`)),
    h('p', { class: 'fine' }, connectorLabel(pin.connector)),
    pin.keys.length === 0 || pin.role === 'motor' ? null : h(PinSettings, { pin, view }),
    pin.note === undefined ? null : h('p', { class: 'note' }, pin.note),
    h('p', { class: 'raw-key block' }, `Source: ${pin.src}`),
  );
}
