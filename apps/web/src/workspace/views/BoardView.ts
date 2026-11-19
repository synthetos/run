/**
 * The Board view: the board's configuration as it was read, organised in
 * tabs so nothing needs a long scroll (Board settings spec §5).
 *
 * - Overview: the OD-5 board drawing, where every screw terminal and pin is
 *   its own target (name, function, current setting), and what the board
 *   reported about itself.
 * - Motors, Axes, Inputs, Spindle and coolant, Communications: every value is
 *   the real settings read, named and spelled out from the dialect's settings
 *   file. Controls sit in place wherever Run may write; changes collect as
 *   pending changes.
 * - All settings, Backups and Firmware.
 *
 * A read-only board gets one notice above the tabs. Settings writes (SAFETY
 * §4.6, amendment 2026-11-02): the sticky pending bar opens the review panel
 * (workspace/settings/ReviewPanel.ts), which shows the diff, asks C5 and is
 * the only place that writes, through the model's `applySettings`, behind the
 * phase switch and the idle gate. Every value shown is what the board answered to a GET
 * through the read allowlist; strings from the board go through `boardText`
 * (T-S85). Pin names come from the generated board definition (RUN_PLAN
 * rule 6).
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { boardTab, openFirmwareUpdate, type BoardTab as Tab } from '../boardNavigation.ts';
import { type WorkspaceModel } from '../model.ts';
import { BoardNotices } from '../settings/BoardNotices.ts';
import { PendingBar } from '../settings/PendingBar.ts';
import { pendingByTab } from '../settings/pendingTabs.ts';
import { ReviewPanel } from '../settings/ReviewPanel.ts';
import { TabBar, TabPane } from '../ui.ts';
import { AxesTab } from './board/axes.ts';
import { InputsTab } from './board/inputs.ts';
import { MotorsTab } from './board/motors.ts';
import { OutputsTab } from './board/outputs.ts';
import { OverviewTab } from './board/overview.ts';
import { BackupsSection } from './board/backups.ts';
import { SettingsTab } from './board/settings.ts';
import { FirmwareSection } from './board/firmwareTabs.ts';

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
    openFirmwareUpdate();
  }
  const pending = pendingByTab(view);
  const badge = (id: Tab): { badge?: string } => (pending[id] === undefined ? {} : { badge: String(pending[id]) });
  const tabs: readonly { id: Tab; label: string; badge?: string }[] = [
    { id: 'overview', label: 'Overview', ...badge('overview') },
    { id: 'motors', label: 'Motors', ...badge('motors') },
    { id: 'axes', label: 'Axes', ...badge('axes') },
    { id: 'inputs', label: 'Inputs', ...badge('inputs') },
    { id: 'io', label: 'Spindle and coolant', ...badge('io') },
    { id: 'settings', label: 'All settings', ...badge('settings') },
    { id: 'firmware', label: 'Firmware', ...(old === null ? {} : { badge: 'Update' }) },
    { id: 'backups', label: 'Backups' },
  ];
  const pane = (id: Tab, child: ComponentChild): ComponentChild => h(TabPane, { prefix: 'board', id, current: tab, class: 'cpane' }, child);
  return h(
    'div',
    { class: 'board-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Board')), h('div', { class: 'view-actions board-tabs' }, h(TabBar<Tab>, { label: 'Board', prefix: 'board', attr: 'data-board-tab', current: tab, onSelect: setTab, tabs }))),
    h(BoardNotices, { model, onUpdate: openFirmwareUpdate }),
    pane('overview', h(OverviewTab, { view })),
    pane('motors', h(MotorsTab, { view })),
    pane('axes', h(AxesTab, { view })),
    pane('inputs', h(InputsTab, { view })),
    pane('io', h(OutputsTab, { view })),
    pane('settings', h(SettingsTab, { model })),
    pane('firmware', h(FirmwareSection, { model })),
    pane('backups', h(BackupsSection, { model })),
    h('div', { class: 'pending-dock' }, h(ReviewPanel, { model }), h(PendingBar, { model })),
  );
}

export { FirmwareTab } from './FirmwareViews.ts';
