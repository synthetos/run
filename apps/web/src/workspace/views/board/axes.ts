/**
 * The Axes tab (Board settings spec §5.6, owner picture 157): an All axes card (soft limits, junction acceleration,
 * chordal tolerance), one card per axis the machine uses or whose mode is not Off, and the unused axes that are Off.
 * Each is its own sub-tab, so nothing scrolls (owner walk 2026-11-19, picture 166). Switch modes and contact live on
 * Inputs, motor idle time on Motors (one home per setting).
 */
import { h, type ComponentChild } from 'preact';
import type { SettingValue } from '@synthetos/schema';
import { axisModeState } from '../../../machine-ui/AxisModes.ts';
import { settingMeta, settingsOf } from '../../boardFacts.ts';
import { selectedMachine } from '../../library.ts';
import type { LiveView } from '../../model.ts';
import { defsFor } from '../../settings/defs.ts';
import { plannedDrafts, readOnlyNotice } from '../../settings/editGate.ts';
import { guidedAxes } from '../../settings/GuidedSettings.ts';
import { boardInches } from '../../settings/meta.ts';
import { SettingControl } from '../../settings/SettingControl.ts';
import { axisCards, type AxisContext } from './axesModel.ts';
import { AxisCardView } from './axisCardView.ts';
import { Empty } from './shared.ts';
import { SubTabs, subTabChoice, type SubTab } from './subTabs.ts';

type Settings = Readonly<Record<string, SettingValue>>;

const AXIS_TOKEN = /^[xyzabc](am|vm|fr|tn|tm|jm|jd|ra|sv|lv|lb|zb|jh)$/;

function AllAxes({ view }: { readonly view: LiveView | null }): ComponentChild {
  const dialect = view?.readout.dialectId ?? null;
  // A read-only board says why once, above the tabs (spec §5.3); rows do not repeat it.
  const tags = readOnlyNotice(view) === null;
  return h(
    'section',
    { class: 'board-card', 'data-region': 'all-axes' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'card-title' }, 'All axes'), h('span', { class: 'fine' }, 'Settings that belong to no single axis.')),
    h(
      'table',
      { class: 'cfg-table axis-table' },
      h('tbody', null, ['sl', 'ja', 'ct'].map((k) => {
        const m = settingMeta(k, dialect);
        return h('tr', { key: k, 'data-axis-row': k }, h('th', { scope: 'row' }, m.short), h('td', null, h(SettingControl, { k, view }), tags && m.access === 'read' && m.reason !== null ? h('span', { class: 'tag' }, m.reason) : null));
      })),
    ),
  );
}

/** The board the cards describe: its dialect, and whether it reports lengths in inches (G20). */
function axisContext(view: LiveView | null): AxisContext {
  return { dialectId: view?.readout.dialectId ?? '', inches: boardInches(view) };
}

/** The axes this machine does not use and whose mode is Off: one row each, with the mode, so one can be turned on. */
function OffAxes({ view, axes }: { readonly view: LiveView | null; readonly axes: readonly string[] }): ComponentChild {
  return h(
    'section',
    { class: 'board-card axes-off', 'data-region': 'axes-off' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'card-title' }, 'Other axes'), h('span', { class: 'fine' }, 'Not used on this machine. Choose a mode to use one; it then gets its own tab.')),
    h('table', { class: 'cfg-table axis-table' }, h('tbody', null, axes.map((a) => h('tr', { key: a, 'data-axis-off': a }, h('th', { scope: 'row' }, `${a.toUpperCase()} axis`), h('td', null, h(SettingControl, { k: `${a}am`, view })))))),
  );
}

/** A dialect without a settings file: the axis tokens the board reported, raw. */
function RawAxes({ view, settings }: { readonly view: LiveView | null; readonly settings: Settings }): ComponentChild {
  const keys = Object.keys(settings).filter((k) => AXIS_TOKEN.test(k)).sort();
  return h(
    'section',
    { class: 'board-card' },
    h('div', { class: 'sec-head' }, h('h3', { class: 'card-title' }, 'No definition yet'), h('span', { class: 'fine' }, 'Reported by the board. Run has no description for these, so they are shown as read and never changed.')),
    h('table', { class: 'cfg-table axis-table' }, h('tbody', null, keys.map((k) => h('tr', { key: k }, h('th', { scope: 'row' }, k), h('td', null, h(SettingControl, { k, view })))))),
  );
}

export function AxesTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const settings = settingsOf(view);
  if (settings['xam'] === undefined) return h('div', { class: 'scroll-region' }, h(Empty, { view }));
  const defs = defsFor(view);
  const modes = view?.axisModes ?? null;
  const root = { tabindex: 0, class: 'scroll-region cfg-scroll axes-tab', 'data-region': 'axes', 'data-axis-modes': axisModeState(modes) ?? undefined };
  if (defs === null) return h('div', root, h(RawAxes, { view, settings }));
  const planned: Settings = { ...settings, ...plannedDrafts(view) };
  const machine = guidedAxes(selectedMachine.value, settings);
  const { cards, collapsedOff } = axisCards(defs, planned, machine, axisContext(view));
  // One view at a time (owner walk 2026-11-19, picture 166): All axes, each axis in use, then the unused ones.
  const tabs: readonly SubTab[] = [
    { id: 'all', label: 'All axes' },
    ...cards.map((c) => ({ id: c.axis, label: `${c.axis.toUpperCase()} axis` })),
    ...(collapsedOff.length === 0 ? [] : [{ id: 'other', label: 'Other axes' }]),
  ];
  const part = (id: string): ComponentChild => {
    if (id === 'all') return h(AllAxes, { view });
    if (id === 'other') return h(OffAxes, { view, axes: collapsedOff });
    const c = cards.find((x) => x.axis === id);
    return c === undefined ? null : h(AxisCardView, { c, defs, view, planned, open: true, modes });
  };
  return h('div', root, h(SubTabs, { name: 'Axes', prefix: 'board-axes', tabs, choice: subTabChoice.axes, render: part }));
}
