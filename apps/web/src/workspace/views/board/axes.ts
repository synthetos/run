/**
 * The Axes tab (Board settings spec §5.6, owner picture 157): an All axes card (soft limits, junction acceleration,
 * chordal tolerance), one card per axis the machine uses or whose mode is not Off, and one line for the unused axes
 * that are Off. Switch modes and contact live on Inputs, motor idle time on Motors (one home per setting).
 */
import { h, type ComponentChild } from 'preact';
import type { SettingValue, SettingsFile } from '@synthetos/schema';
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

type Settings = Readonly<Record<string, SettingValue>>;

const NARROW = 1100;
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

function names(axes: readonly string[]): string {
  const up = axes.map((a) => a.toUpperCase());
  return up.length === 1 ? (up[0] as string) : `${up.slice(0, -1).join(', ')} and ${up[up.length - 1] ?? ''}`;
}

/** The board the cards describe: its dialect, and whether it reports lengths in inches (G20). */
function axisContext(view: LiveView | null): AxisContext {
  return { dialectId: view?.readout.dialectId ?? '', inches: boardInches(view) };
}

function OffAxes({ defs, view, planned, axes, machine }: { readonly defs: SettingsFile; readonly view: LiveView | null; readonly planned: Settings; readonly axes: readonly string[]; readonly machine: readonly string[] }): ComponentChild {
  const cards = axisCards(defs, planned, [...machine, ...axes], axisContext(view)).cards.filter((c) => axes.includes(c.axis));
  return h(
    'details',
    { class: 'board-card axes-off', 'data-region': 'axes-off' },
    h('summary', null, `${names(axes)} · Off · Not used on this machine · Show`),
    cards.map((c) => h(AxisCardView, { key: c.axis, c, defs, view, planned, open: true, modes: view?.axisModes ?? null })),
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
  const narrow = typeof window !== 'undefined' && window.innerWidth < NARROW;
  return h(
    'div',
    root,
    h(AllAxes, { view }),
    cards.map((c, i) => h(AxisCardView, { key: c.axis, c, defs, view, planned, open: !narrow || i === 0, modes })),
    collapsedOff.length === 0 ? null : h(OffAxes, { defs, view, planned, axes: collapsedOff, machine }),
  );
}
