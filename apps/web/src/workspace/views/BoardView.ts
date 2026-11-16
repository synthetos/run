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
import {
  draftStore
} from '../boardFacts.ts';
import { boardTab, type BoardTab as Tab } from '../boardNavigation.ts';
import { type WorkspaceModel } from '../model.ts';
import { PendingTray } from '../settings/SettingsUi.ts';
import { TabBar, TabPane } from '../ui.ts';
import { AxesTab } from './board/axes.ts';
import { CommsTab } from './board/comms.ts';
import { InputsTab } from './board/inputs.ts';
import { MotorsTab } from './board/motors.ts';
import { OutputsTab } from './board/outputs.ts';
import { OverviewTab } from './board/overview.ts';
import { SettingsTab } from './board/settings.ts';
import { BackupsHub, FirmwareTab } from './FirmwareViews.ts';

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

export { MotorDraft } from './board/motorDraft.ts';
export { FirmwareTab } from './FirmwareViews.ts';
