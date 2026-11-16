/**
 * The Board view (Stage 1, read-only): the board's configuration as it was
 * read, organised in tabs so nothing needs a long scroll.
 *
 * - Overview: the OD-5 board drawing, where every screw terminal and pin is
 *   its own target (name, function, current setting), and what the board
 *   reported about itself.
 * - Motors, Axes, Inputs, Spindle and coolant, Communications: every value is
 *   the real settings read, in plain words with the raw key as secondary
 *   text. Values can be edited where Run may write them; edits collect as
 *   pending changes.
 * - All settings (grouped, searchable, with the drift check, P1-07), Backups
 *   (back up, and restore through the same write path) and Firmware (future,
 *   disabled).
 *
 * Settings writes (SAFETY §4.6, amendment 2026-11-02): the pending changes
 * tray (workspace/settings) shows the diff and is the only place that
 * writes, through the model's `applySettings`, behind the phase switch and
 * the idle gate. Every value shown is what the board answered to a GET
 * through the read allowlist; strings from the board go through `boardText`
 * (T-S85). Pin names come from the generated board definition (RUN_PLAN
 * rule 6).
 */
import { h, type ComponentChild } from 'preact';

import { useState } from 'preact/hooks';




import { SettingsStatus } from '../../machine-ui/SettingsView.ts';

import { Dismissable } from '../notes/Dismissable.ts';

import type { ReadoutPhase } from '../../live/readout.ts';

import { PendingTray, SettingsTable } from '../settings/SettingsUi.ts';

import { BackupsHub, FirmwareTab } from './FirmwareViews.ts';


import {
    dialectOf,
    draftStore,
    plainValue,
    settingMeta,
    settingsOf
} from '../boardFacts.ts';



import { connected, type LiveView, type WorkspaceModel } from '../model.ts';


import { TabBar, TabPane } from '../ui.ts';

import { boardTab, type BoardTab as Tab } from '../boardNavigation.ts';

import { uiLevel } from '../jobWorkflow.ts';

import { GuidedSettings } from '../settings/GuidedSettings.ts';
import { AxesTab } from './board/axes.ts';
import { InputsTab } from './board/inputs.ts';
import { MotorsTab } from './board/motors.ts';
import { OutputsTab } from './board/outputs.ts';
import { OverviewTab } from './board/overview.ts';
import { Empty } from './board/shared.ts';


// Firmware and Backups (SAFETY §4.8 as amended 2026-11-03 and 2026-11-09): the Firmware tab (the Update panel, then
// the firmware image backups, custom firmware and trusted builds) and the Backups tab (settings backups).
export { MotorDraft } from './board/motorDraft.ts';
export { FirmwareTab } from './FirmwareViews.ts';



function CommsTab({ view }: { readonly view: LiveView | null }): ComponentChild {
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


function SettingsTab({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region settings-tab' },
    settingsRead(view?.readout.phase ?? { kind: 'idle' }, () => model?.actions.value?.keepBoardSettings()),
    uiLevel.value.value === 'simple' ? h(GuidedSettings, { view, prefix: 'board' }) : h(SettingsTable, { view }),
  );
}


export function BoardView({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  // The old-firmware gate: a board below the signed list's minimum opens straight into the Update panel.
  const old = view?.message?.oldFirmware ?? null;
  const tab = boardTab.value;
  const setTab = (next: Tab): void => { boardTab.value = next; };
  const [oldSeen, setOldSeen] = useState<string | null>(null);
  const oldKey = old === null ? null : `${view?.message?.snapshot.epoch ?? 0}`;
  if (oldKey !== null && oldKey !== oldSeen) {
    setOldSeen(oldKey);
    if (tab !== 'firmware') setTab('firmware');
  }
  const drafts = Object.keys(draftStore.value.value).length;
  const tabs: readonly { id: Tab; label: string; badge?: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'motors', label: 'Motors', ...(drafts === 0 ? {} : { badge: String(drafts) }) },
    { id: 'axes', label: 'Axes' },
    { id: 'inputs', label: 'Inputs' },
    { id: 'io', label: 'Spindle and coolant' },
    { id: 'comms', label: 'Communications' },
    { id: 'settings', label: 'All settings' },
    { id: 'firmware', label: 'Firmware', ...(old === null ? {} : { badge: 'Update' }) },
    { id: 'backups', label: 'Backups' },
  ];
  const pane = (id: Tab, child: ComponentChild): ComponentChild => h(TabPane, { prefix: 'board', id, current: tab, class: 'cpane' }, child);
  return h(
    'div',
    { class: 'board-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Board')), h('div', { class: 'view-actions board-tabs' }, h(TabBar<Tab>, { label: 'Board', prefix: 'board', attr: 'data-board-tab', current: tab, onSelect: setTab, tabs }))),
    h(PendingTray, { model }),
    pane('overview', h(OverviewTab, { view })),
    pane('motors', h(MotorsTab, { view })),
    pane('axes', h(AxesTab, { view })),
    pane('inputs', h(InputsTab, { view })),
    pane('io', h(OutputsTab, { view })),
    pane('comms', h(CommsTab, { view })),
    pane('settings', h(SettingsTab, { model })),
    pane('firmware', h('div', { class: 'firmware-tab' }, h(FirmwareTab, { model }), h(BackupsHub, { model, part: 'firmware' }))),
    pane('backups', h(BackupsHub, { model, part: 'settings' })),
  );
}


/**
 * The settings read's outcome. "Recorded" and "match" are only information, so they get a × (remembered per notice,
 * workspace/notes/Dismissable.ts); reading, incomplete and a drift (a review is needed) always show.
 */
function settingsRead(phase: ReadoutPhase, onKeep: () => void): ComponentChild {
  const body = h('div', { 'data-region': 'settings' }, h(SettingsStatus, { phase, onKeep }));
  return phase.kind === 'recorded' || phase.kind === 'match'
    ? h(Dismissable, { id: `board/settings-${phase.kind}`, label: 'the settings read note', inNotes: false, class: 'settings-read dismissable-card' }, body)
    : h('div', { class: 'settings-read' }, body);
}
