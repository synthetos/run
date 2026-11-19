/**
 * The Spindle and coolant tab (Board settings spec §5.6b): the J6 pins from the board file with each output's
 * polarity from the settings file (a control where Run may write it; "Reserved on this firmware" for a stub; "No
 * setting on this firmware" where the firmware has none), what is wired to the coolant output (the machine record,
 * changed on the J6.6 pin panel, never a board setting), the readouts, and the spindle PWM values.
 */
import { h, type ComponentChild } from 'preact';
import type { PinInfo } from '../../boardFacts.ts';
import { connectorPins, settingMeta, settingsOf } from '../../boardFacts.ts';
import { COOLANT_WIRING } from '../../coolant.ts';
import { selectedMachine } from '../../library.ts';
import { connected, type LiveView } from '../../model.ts';
import { Dismissable } from '../../notes/Dismissable.ts';
import { defsFor } from '../../settings/defs.ts';
import { SettingControl } from '../../settings/SettingControl.ts';
import { coolantText, displayReadouts, spindleText } from '../../status.ts';
import { CHOOSE_MACHINE_FIRST } from './CoolantWiring.ts';
import { Empty } from './shared.ts';
import { SubTabs, subTabChoice, type SubTab } from './subTabs.ts';

/** The setting that decides each output's polarity. */
const POLARITY: Readonly<Record<string, string>> = { 'out.spindleEnable': 'spep', 'out.spindleDirection': 'spdp', 'out.spindlePwm': 'spph', 'out.coolant': 'coph' };

function Polarity({ pin, view }: { readonly pin: PinInfo; readonly view: LiveView | null }): ComponentChild {
  const k = pin.signal === undefined ? undefined : POLARITY[pin.signal];
  const attrs = { 'data-polarity': pin.ref };
  if (k === undefined) return h('td', { ...attrs, class: 'muted' }, 'Not applicable');
  const defs = defsFor(view);
  if (defs === null) return h('td', attrs, view?.readout.settings[k] === undefined ? 'Not read' : h(SettingControl, { k, view }));
  const d = defs.tokens.get(k);
  if (d === undefined) return h('td', { ...attrs, class: 'muted' }, 'No setting on this firmware');
  if (d.access === 'reserved') return h('td', { ...attrs, class: 'muted', title: d.reason }, 'Reserved on this firmware');
  return h('td', attrs, h(SettingControl, { k, view }));
}

function wiredTo(): string {
  const machine = selectedMachine.value;
  if (machine === null) return CHOOSE_MACHINE_FIRST;
  const label = COOLANT_WIRING.find(([value]) => value === machine.coolant)?.[1];
  return label === undefined ? 'Not set. Choose it on the J6.6 pin panel.' : `Wired to: ${label}.`;
}

function PinRow({ pin, view }: { readonly pin: PinInfo; readonly view: LiveView | null }): ComponentChild {
  return h(
    'tr',
    { key: pin.ref },
    h('th', { scope: 'row' }, h('strong', null, pin.label), ' ', h('small', { class: 'pin-ref' }, pin.ref)),
    h('td', null, pin.function, pin.signal === 'out.coolant' ? h('small', { class: 'block fine', 'data-coolant-wired': '' }, wiredTo()) : null),
    h(Polarity, { pin, view }),
  );
}

function Readouts({ view }: { readonly view: LiveView | null }): ComponentChild {
  const snapshot = view !== null && connected(view) ? view.message?.snapshot : undefined;
  const r = displayReadouts(snapshot);
  const srList = snapshot?.live.srList;
  const missing = srList !== undefined && !['spe', 'spc', 'sps', 'cof', 'com'].every((k) => srList.includes(k));
  return h(
    'section',
    { class: 'board-card' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'card-title' }, 'Reported now')),
    h('dl', { class: 'facts inline-facts' }, h('div', null, h('dt', null, 'Spindle'), h('dd', null, spindleText(r))), h('div', null, h('dt', null, 'Coolant'), h('dd', null, coolantText(r)))),
    h('p', { class: 'fine' }, missing ? 'This board’s status list does not carry these: they were read once at connect and change only when the list carries them. Display only: never rely on them for safety.' : 'From the board’s status reports. Display only: never rely on them for safety.'),
  );
}

/** The PWM values in three short columns (general, clockwise, counter-clockwise), so the card fits without scrolling. */
const PWM_COLUMNS: readonly { readonly title: string; readonly test: (k: string) => boolean }[] = [
  { title: 'General', test: (k) => !/^p1[cw]/.test(k) },
  { title: 'Clockwise', test: (k) => k.startsWith('p1c') },
  { title: 'Counter-clockwise', test: (k) => k.startsWith('p1w') },
];

function Pwm({ view, keys }: { readonly view: LiveView | null; readonly keys: readonly string[] }): ComponentChild {
  const dialect = view?.readout.dialectId ?? null;
  const table = (ks: readonly string[]): ComponentChild => h('table', { class: 'cfg-table axis-table pwm-table' }, h('tbody', null, ks.map((k) => h('tr', { key: k }, h('th', { scope: 'row' }, settingMeta(k, dialect).label), h('td', null, h(SettingControl, { k, view }))))));
  return h(
    'section',
    { class: 'board-card', 'data-region': 'pwm' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'card-title' }, 'Spindle speed output (PWM)')),
    h('div', { class: 'pwm-columns' }, PWM_COLUMNS.map((c) => h('div', { key: c.title, class: 'axis-section' }, h('h4', { class: 'tan-label' }, c.title), table(keys.filter(c.test))))),
  );
}

function J6({ view }: { readonly view: LiveView | null }): ComponentChild {
  return h(
    'section',
    { class: 'board-card' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'card-title' }, 'J6 spindle and coolant')),
    h('table', { class: 'cfg-table outputs-table' }, h('thead', null, h('tr', null, ...['Pin', 'What it does', 'Polarity'].map((t) => h('th', { scope: 'col', key: t }, t)))), h('tbody', null, connectorPins('J6').map((p) => h(PinRow, { key: p.ref, pin: p, view })))),
    h(Dismissable, { id: 'board/coolant-shared', label: 'the coolant note', inNotes: false }, h('p', { class: 'fine' }, 'Mist and flood share the one coolant output on this board.')),
  );
}

export function OutputsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  if (Object.keys(settings).length === 0) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  const pwm = Object.keys(settings).filter((k) => /^p1/.test(k)).sort();
  // Two views, so neither scrolls (owner walk 2026-11-19): the J6 outputs with the readouts, then the PWM values.
  const tabs: readonly SubTab[] = [{ id: 'outputs', label: 'Outputs' }, ...(pwm.length === 0 ? [] : [{ id: 'pwm', label: 'Spindle speed (PWM)' }])];
  const part = (id: string): ComponentChild => (id === 'pwm' ? h(Pwm, { view, keys: pwm }) : [h(J6, { key: 'j6', view }), h(Readouts, { key: 'now', view })]);
  return h('div', { tabindex: 0, class: 'scroll-region cfg-scroll outputs-tab' }, h(SubTabs, { name: 'Spindle and coolant', prefix: 'board-io', tabs, choice: subTabChoice.io, render: part }));
}
