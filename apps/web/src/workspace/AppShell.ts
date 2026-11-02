/**
 * The workspace shell (Stage 1; WORKSPACE_TENETS 1, WORKSPACE_SPEC): one
 * page that never reloads or scrolls.
 *
 * - Top: W1 (the safety bar, safety tokens only), the top bar (brand,
 *   breadcrumb, theme toggle, account menu with its sync badge), and the
 *   machine strip (state, readouts, Pause and Stop job in a fixed place).
 * - Left rail: Run, Setup, Tools, Materials, Board, Machines, Projects,
 *   Analyze, Settings, Safety. Switching views only toggles `hidden`: every
 *   view stays mounted, so the worker, the connection, the preview and the
 *   reads are never torn down, and nothing navigates.
 * - The LOST and STALE banners (W3, W4), the observer panel (another tab
 *   controls a machine) and the advisory banner sit above every view.
 *
 * Prerendered into index.html (no model, no worker: Pause and Stop job are
 * disabled and say why) and hydrated by the workspace entry.
 */
import { h, type ComponentChild } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { STOP_TEXT, w29 } from '@synthetos/safety';
import { type BuildInfo, versionLabel } from '../build-info/buildInfo.ts';
import type { WorkerLike } from '../gcode-worker/client.ts';
import { OverlayBanners } from '../machine-ui/OverlayBanners.ts';
import type { LiveMarkerView } from '../preview/PreviewPanel.ts';
import { machineLabel, SafetyBar, type StopBarView } from '../shell/SafetyBar.ts';
import { signalText } from '../shell/signal.ts';
import { THEME_TOGGLE_ATTR } from '../shell/SiteHeader.ts';
import type { TabRole } from '../live/tabStop.ts';
import { Icon, type IconName } from './icons.ts';
import { selectedMachine } from './library.ts';
import { MachineStrip } from './MachineStrip.ts';
import { INITIAL_LIVE_VIEW, portOpen, type WorkspaceModel } from './model.ts';
import { stripStatus } from './status.ts';
import { BoardView } from './views/BoardView.ts';
import { MaterialsView, ToolsView } from './views/LibraryViews.ts';
import { MachinesView } from './views/MachinesView.ts';
import { AnalyzeView, PreferencesView, SafetyView } from './views/OtherViews.ts';
import { ProjectsView } from '../projects/ProjectsView.ts';
import { RunView } from './views/RunView.ts';
import { eventNotice } from '../report/notice.ts';
import { ReportDialog } from '../report/ReportDialog.ts';
import { openReport } from '../report/state.ts';
import { SetupView } from './views/SetupView.ts';

export type ViewId = 'run' | 'setup' | 'tools' | 'materials' | 'board' | 'machines' | 'projects' | 'analyze' | 'settings' | 'safety';

export const VIEWS: readonly { readonly id: ViewId; readonly label: string; readonly icon: IconName; readonly bottom?: boolean }[] = [
  { id: 'run', label: 'Run', icon: 'run' },
  { id: 'setup', label: 'Setup', icon: 'setup' },
  { id: 'tools', label: 'Tools', icon: 'tools' },
  { id: 'materials', label: 'Materials', icon: 'materials' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'machines', label: 'Machines', icon: 'machines' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'analyze', label: 'Analyze', icon: 'analyze' },
  { id: 'settings', label: 'Settings', icon: 'settings', bottom: true },
  { id: 'safety', label: 'Safety', icon: 'safety' },
];

export interface AppShellProps {
  readonly build: BuildInfo;
  readonly model?: WorkspaceModel;
  readonly previousSession?: ReadonlySignal<boolean>;
  /** P1-06: the stop controls' state. Absent in the prerendered page (Pause and Stop job stay disabled). */
  readonly stop?: ReadonlySignal<StopBarView>;
  readonly onPause?: () => void;
  readonly onStopJob?: () => void;
  /** The observer role of this tab (another tab controls a machine), and its requests. */
  readonly role?: ReadonlySignal<TabRole>;
  readonly liveTab?: ReadonlySignal<boolean>;
  readonly onPauseRequest?: () => void;
  readonly onStopJobRequest?: () => void;
  readonly onDismissReleased?: () => void;
  /** Starts `gcode.worker` for the preview; null in the prerendered page. */
  readonly spawn?: (() => WorkerLike) | null;
  readonly marker?: ReadonlySignal<LiveMarkerView | null>;
}

function Strip(props: AppShellProps): ComponentChild {
  const view = props.model?.live.value ?? INITIAL_LIVE_VIEW;
  const status = stripStatus(view, selectedMachine.value?.name ?? null);
  const actions = props.model?.actions.value ?? null;
  const connection = actions !== null && portOpen(view) ? { onDisconnect: actions.disconnect, refused: view.disconnectRefused } : null;
  return h(MachineStrip, {
    connection,
    status,
    stop: props.stop?.value ?? null,
    previousSession: props.previousSession?.value === true,
    ...(props.onPause === undefined ? {} : { onPause: props.onPause }),
    ...(props.onStopJob === undefined ? {} : { onStopJob: props.onStopJob }),
  });
}

function AccountMenu(): ComponentChild {
  const [open, setOpen] = useState(false);
  return h(
    'div',
    { class: 'account' },
    h(
      'button',
      { type: 'button', class: 'account-button', 'aria-haspopup': 'true', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'account-menu', 'aria-label': 'Account: not signed in. Changes are kept in this browser', onClick: () => setOpen(!open) },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, Icon('cloud', 16)),
      h('span', { class: 'sync-badge', 'data-sync': 'local', 'aria-hidden': 'true' }),
    ),
    open
      ? h(
          'div',
          { class: 'account-menu', id: 'account-menu', role: 'menu' },
          h('div', { class: 'account-id' }, h('span', { class: 'avatar large', 'aria-hidden': 'true' }, Icon('cloud', 18)), h('div', null, h('strong', null, 'Not signed in'), h('small', null, 'Synthetos accounts arrive soon'))),
          h('div', { class: 'sync-row', 'data-sync': 'local' }, h('div', null, h('strong', null, 'Kept in this browser'), h('small', null, 'Machines, tools, materials and setup are saved here. Account sync comes later.'))),
          h('button', { type: 'button', class: 'menu-item', role: 'menuitem', disabled: true }, 'Sign in with GitHub'),
          h(
            'button',
            {
              type: 'button',
              class: 'menu-item',
              role: 'menuitem',
              'data-action': 'report-problem',
              onClick: () => {
                setOpen(false);
                openReport({ origin: 'menu' });
              },
            },
            Icon('flag', 15),
            'Report a problem',
          ),
          h('p', { class: 'menu-foot' }, 'Pause, Stop job and the other stop controls never need you to be signed in.'),
        )
      : null,
  );
}

function Banners(props: AppShellProps): ComponentChild {
  const view = props.model?.live.value ?? null;
  const snapshot = view?.message?.snapshot ?? null;
  const role = props.role?.value ?? null;
  const live = props.liveTab?.value === true;
  const notice = eventNotice(snapshot);
  return h(
    'div',
    { class: 'banners', 'data-region': 'overlay-banners' },
    h(OverlayBanners, { snapshot, staleElapsedMs: view?.staleSince === null || view?.staleSince === undefined ? 0 : Date.now() - view.staleSince }),
    notice === null
      ? null
      : h(
          'div',
          { class: 'event-notice', role: 'status', 'data-event-notice': notice.kind },
          h('span', { class: 'event-icon', 'aria-hidden': 'true' }, Icon('hazard', 16)),
          h('p', null, h('strong', null, notice.title), ' ', notice.detail),
          h('button', { type: 'button', class: 'small', 'data-action': 'report-event', onClick: () => openReport({ origin: 'notice', event: notice.event }) }, Icon('flag', 14), 'Report this'),
        ),
    role === null || live || (!role.observing && role.released.length === 0)
      ? null
      : h(
          'div',
          { class: 'observer', 'data-region': 'observer' },
          role.released.length > 0
            ? h(
                'div',
                { class: 'overlay-banner overlay-banner-warn', 'data-safety': 'W29', role: 'alert' },
                h('p', null, ...signalText(w29())),
                h('p', { 'data-machines': '' }, role.released.map(machineLabel).join(', ')),
                h('button', { type: 'button', class: 'small', 'data-action': 'dismiss-w29', onClick: props.onDismissReleased }, 'OK'),
              )
            : null,
          role.observing
            ? h(
                'div',
                { class: 'observer-controls', 'data-observer': 'controlled' },
                h('p', { role: 'status' }, `${STOP_TEXT.controlledElsewhere}: ${role.held.map(machineLabel).join(', ')}`),
                h('button', { type: 'button', class: 'small', 'data-action': 'pause-request', onClick: props.onPauseRequest }, 'Pause request'),
                h('button', { type: 'button', class: 'small', 'data-action': 'stop-job-request', onClick: props.onStopJobRequest }, 'Stop job request'),
              )
            : null,
        ),
  );
}

export function AppShell(props: AppShellProps): ComponentChild {
  const [current, setCurrent] = useState<ViewId>('run');
  const onView = (v: string): void => {
    if (VIEWS.some((x) => x.id === v)) setCurrent(v as ViewId);
  };
  useEffect(() => {
    document.documentElement.dataset['view'] = current;
  }, [current]);
  const model = props.model ?? null;
  const machine = selectedMachine.value;
  const label = VIEWS.find((v) => v.id === current)?.label ?? 'Run';
  const rail = (v: (typeof VIEWS)[number]): ComponentChild =>
    h(
      'button',
      { type: 'button', key: v.id, class: v.bottom === true ? 'rail-bottom' : undefined, 'data-view': v.id, 'aria-current': current === v.id ? 'page' : undefined, onClick: () => setCurrent(v.id) },
      Icon(v.icon, 21),
      h('span', null, v.label),
    );
  const pane = (id: ViewId, child: ComponentChild): ComponentChild => h('section', { class: 'view', 'data-screen': id, hidden: current !== id, 'aria-label': VIEWS.find((v) => v.id === id)?.label, key: id }, child);
  return h(
    'div',
    { class: 'app', 'data-shell': 'workspace' },
    h(SafetyBar, { build: props.build, variant: 'workspace' }),
    h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'brand', href: '/' }, h('svg', { viewBox: '0 0 28 28', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'aria-hidden': 'true' }, h('circle', { cx: 14, cy: 14, r: 9 }), h('path', { d: 'M14 0v9m0 10v9M0 14h9m10 0h9' })), h('strong', null, 'Synthetos'), h('span', { class: 'brand-run' }, 'Run')),
      h(
        'nav',
        { class: 'context', 'aria-label': 'Breadcrumb' },
        h('button', { type: 'button', class: 'crumb', onClick: () => setCurrent('machines') }, machine?.name ?? 'Workshop'),
        h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
        h('span', { class: 'crumb current', 'aria-current': 'page' }, label),
      ),
      h(
        'div',
        { class: 'top-actions' },
        h('button', { type: 'button', class: 'icon-button quiet theme-toggle', [THEME_TOGGLE_ATTR]: '', 'aria-label': 'Toggle day/night mode', title: 'Toggle day/night mode' }, h('span', { class: 'theme-sun' }, Icon('sun', 18)), h('span', { class: 'theme-moon' }, Icon('moon', 18))),
        h(AccountMenu, null),
      ),
    ),
    h(Strip, props),
    h(
      'div',
      { class: 'body' },
      h('nav', { class: 'rail', 'data-region': 'rail', 'aria-label': 'Workspace' }, VIEWS.map(rail)),
      h(
        'div',
        { class: 'content-frame' },
        h(
          'main',
          { class: 'view-area', id: 'main', 'data-region': 'centre' },
          h(Banners, props),
          pane('run', h(RunView, { model, spawn: props.spawn ?? null, ...(props.marker === undefined ? {} : { marker: props.marker }), onView })),
          pane('setup', h(SetupView, null)),
          pane('tools', h(ToolsView, null)),
          pane('materials', h(MaterialsView, null)),
          pane('board', h(BoardView, { model })),
          pane('machines', h(MachinesView, { model, onView })),
          pane('projects', h(ProjectsView, { onView })),
          pane('analyze', h(AnalyzeView, null)),
          pane('settings', h(PreferencesView, { build: props.build })),
          pane('safety', h(SafetyView, null)),
        ),
      ),
      h(ReportDialog, { build: props.build, model, view: current }),
    ),
    h(
      'footer',
      { class: 'footer' },
      h('span', null, 'Phase 1 · read only: nothing is written to the board'),
      h('span', { class: 'footer-secondary' }, 'Machines, tools and setup are kept in this browser'),
      h('span', { class: 'mono', 'data-version': '', title: `Version ${props.build.version}, commit ${props.build.sha}` }, versionLabel(props.build)),
    ),
  );
}
