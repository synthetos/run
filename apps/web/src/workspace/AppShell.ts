import { DialogWrap } from './dialogs/DialogWrap.ts';
/**
 * The workspace shell (Stage 1; WORKSPACE_TENETS 1, WORKSPACE_SPEC): one
 * page that never reloads or scrolls.
 *
 * - Top: W1 (the safety bar, safety tokens only), the top bar (brand,
 *   breadcrumb, theme toggle, account menu with its sync badge), and the
 *   machine strip (state, readouts, Pause and Stop job in a fixed place).
 * - Left rail: Job, Library, Board, Projects,
 *   Analyze, Settings, Safety. Switching views only toggles `hidden`: every
 *   view stays mounted, so the worker, the connection, the preview and the
 *   reads are never torn down, and nothing navigates.
 * - The LOST and STALE banners (W3, W4), the observer panel (another tab
 *   controls a machine) and the advisory banner sit above every view.
 *
 * Prerendered into index.html (no model, no worker: Pause and Stop job are
 * disabled and say why) and hydrated by the workspace entry.
 */
import { LibrarySyncNotice } from './cloud/SyncNotice.ts';
import { h, type ComponentChild } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { STOP_TEXT, w29 } from '@synthetos/safety';
import { type BuildInfo, versionLabel } from '../build-info/buildInfo.ts';
import type { WorkerLike } from '../gcode-worker/client.ts';
import type { CarveWorkerLike } from '@synthetos/gcode-view';
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
import { resumeAction } from './resumeAction.ts';
import { FirmwareOffer } from './FirmwareOffer.ts';
import { BoardView } from './views/BoardView.ts';
import { boardTab, viewRequest } from './boardNavigation.ts';
import { observingElsewhere } from './tabControl.ts';
import { UnknownModal } from './unknownModal.ts';
import { LibraryView } from './views/LibraryView.ts';
import { jobStep, librarySection, uiLevel, type LibrarySection } from './jobWorkflow.ts';
import { AnalyzeView, PreferencesView, SafetyView } from './views/OtherViews.ts';
import { ProjectsView } from '../projects/ProjectsView.ts';
import { JobView } from './views/JobView.ts';
import { eventNotice } from '../report/notice.ts';
import { ReportDialog } from '../report/ReportDialog.ts';
import { openReport } from '../report/state.ts';
import { ReviewExits } from './reviewExits.ts';
import { belowStrip } from './ui.ts';
import { LevelSwitch } from './LevelSwitch.ts';
import { readStored, writeStored } from './storage.ts';
import { ConnectNotice } from './views/RunView.ts';
import { pressHandlers } from './pressAction.ts';

export type ViewId = 'job' | 'library' | 'board' | 'projects' | 'analyze' | 'settings' | 'safety';

export const VIEWS: readonly { readonly id: ViewId; readonly label: string; readonly icon: IconName; readonly bottom?: boolean }[] = [
  { id: 'job', label: 'Job', icon: 'setup' },
  { id: 'library', label: 'Library', icon: 'materials' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'analyze', label: 'Analyze', icon: 'analyze' },
  { id: 'settings', label: 'Preferences', icon: 'settings', bottom: true },
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
  /** NEEDS_REVIEW's "Review": opens the Board view's settings compare (OD-13 §5). Set by the shell itself. */
  readonly onReview?: () => void;
  readonly onDismissReleased?: () => void;
  /** Starts `gcode.worker` for the preview; null in the prerendered page. */
  readonly spawn?: (() => WorkerLike) | null;
  /** Starts the carve worker for the 3D preview's stock carving (carve-worker/spawn.ts); null or absent for none. */
  readonly spawnCarve?: (() => CarveWorkerLike) | null;
  readonly marker?: ReadonlySignal<LiveMarkerView | null>;
}

function Strip(props: AppShellProps): ComponentChild {
  const view = props.model?.live.value ?? INITIAL_LIVE_VIEW;
  const resume = resumeAction(props.model);
  const status = stripStatus(view, selectedMachine.value?.name ?? null);
  const actions = props.model?.actions.value ?? null;
  const connection = actions !== null && portOpen(view) ? { onDisconnect: actions.disconnect, refused: view.disconnectRefused } : null;
  return h(MachineStrip, {
    connection,
    // While no port is open the Connect flow sits here, beside the state (owner, 2026-11-03), not in the machine pane.
    ...(connection === null ? { connect: h(ConnectNotice, { model: props.model ?? null, compact: true }) } : {}),
    status,
    stop: props.stop?.value ?? null,
    previousSession: props.previousSession?.value === true,
    ...(props.onPause === undefined ? {} : { onPause: props.onPause }),
    ...(props.onStopJob === undefined ? {} : { onStopJob: props.onStopJob }),
    // Resume (`~`): a hold of this session's motion (SAFETY §4.5b) or a paused job (§4.4a); the terminal's `~` uses the same.
    ...(resume === null ? {} : { onResume: resume }),
    motion: view.message?.motion === true,
    holdOutputs: view.message?.snapshot.classification?.dialectId === 'tinyg-en' && (view.message.snapshot.identity?.fb ?? 0) >= 450.04,
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
          h('div', { class: 'sync-row', 'data-sync': 'local' }, h('div', null, h('strong', null, 'Saved in this browser'), h('small', null, 'Machines, tools and materials stay on this computer.'))),
          h('button', { type: 'button', class: 'menu-item', role: 'menuitem', disabled: true }, 'Sign in (coming soon)'),
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

function Banners(props: AppShellProps & { readonly view: ViewId }): ComponentChild {
  const view = props.model?.live.value ?? null;
  const snapshot = view?.message?.snapshot ?? null;
  const role = props.role?.value ?? null;
  const live = props.liveTab?.value === true;
  const notice = eventNotice(snapshot);
  const [seen, setSeen] = useState<string | null>(null);
  // "Don't show this again" for an informational notice, per kind, in this browser (owner, 2026-11-04).
  const [hidden, setHidden] = useState<readonly string[]>(() => readStored('notice-hidden', (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')) ?? []);
  const hide = (kind: string): void => {
    const next = [...new Set([...hidden, kind])];
    setHidden(next);
    writeStored('notice-hidden', next);
  };
  const noticeKey = notice === null ? null : `${notice.kind}:${notice.title}:${notice.detail}`;
  // Owner, 2026-11-04 (OD-16): messages that ask for action are one modal below the strip, not full-width bars.
  // W1, the strip and Pause and Stop job stay uncovered; the modal hides itself when it has nothing to say.
  const modal = h(
    DialogWrap,
    { class: 'dialog-wrap confirm-modal banner-modal', role: 'presentation', setup: belowStrip, onDismiss: () => {
      // Dismiss the existing OK notices only. Machine-state blockers remain until resolved.
      setSeen(noticeKey);
      if (role !== null && !live && role.released.length > 0) props.onDismissReleased?.();
    } },
    h(
      'div',
      { class: 'dialog banner-stack', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Machine message' },
      h(OverlayBanners, { snapshot, staleElapsedMs: view?.staleSince === null || view?.staleSince === undefined ? 0 : Date.now() - view.staleSince }),
      // Never a trap (amendment 2026-11-02): UNKNOWN comes with its ways out; so does NEEDS_REVIEW (OD-13 §5).
      h(ReviewExits, { model: props.model ?? null, onReview: props.onReview ?? (() => undefined) }),
      // After a reconnect: one question, in the Job view where motion happens (unknownModal.ts). Elsewhere (a firmware
      // update's reconnect in Board → Firmware) the strip says "Position not verified" and the question waits for Job.
      props.view === 'job' ? h(UnknownModal, { model: props.model ?? null }) : null,
      notice === null || noticeKey === seen || hidden.includes(notice.kind)
        ? null
        : h(
            'div',
            { class: 'event-notice', role: 'status', 'data-event-notice': notice.kind },
            h('span', { class: 'event-icon', 'aria-hidden': 'true' }, Icon('hazard', 16)),
            h('p', null, h('strong', null, notice.title), ' ', notice.detail),
            h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'small', 'data-action': 'report-event', onClick: () => openReport({ origin: 'notice', event: notice.event }) }, Icon('flag', 14), 'Report this'), h('label', { class: 'check notice-hide' }, h('input', { type: 'checkbox', 'data-action': 'hide-notice', onChange: (e: Event) => { if ((e.currentTarget as HTMLInputElement).checked) hide(notice.kind); } }), ' Don’t show this again'), h('button', { type: 'button', class: 'small primary', 'data-action': 'dismiss-notice', onClick: () => setSeen(noticeKey) }, 'OK')),
          ),
      role !== null && !live && role.released.length > 0
        ? h(
            'div',
            { class: 'overlay-banner overlay-banner-warn', 'data-safety': 'W29', role: 'alert' },
            h('p', null, ...signalText(w29())),
            h('p', { 'data-machines': '' }, role.released.map(machineLabel).join(', ')),
            h('button', { type: 'button', class: 'small primary', 'data-action': 'dismiss-w29', onClick: props.onDismissReleased }, 'OK'),
          )
        : null,
    ),
  );
  return h(
    'div',
    { class: 'banners', 'data-region': 'overlay-banners' },
    modal,
    role === null || live || (!role.observing && role.released.length === 0)
      ? null
      : h(
          'div',
          { class: 'observer', 'data-region': 'observer' },
          role.observing
            ? h(
                'div',
                { class: 'observer-controls', 'data-observer': 'controlled' },
                h('p', { role: 'status' }, `${STOP_TEXT.controlledElsewhere}: ${role.held.map(machineLabel).join(', ')}`),
                h('button', { type: 'button', class: 'small', 'data-action': 'pause-request', ...(props.onPauseRequest === undefined ? {} : pressHandlers('pause-request', props.onPauseRequest)) }, 'Pause request'),
                h('button', { type: 'button', class: 'small', 'data-action': 'stop-job-request', ...(props.onStopJobRequest === undefined ? {} : pressHandlers('stop-job-request', props.onStopJobRequest)) }, 'Stop job request'),
              )
            : null,
        ),
  );
}

export function AppShell(props: AppShellProps): ComponentChild {
  const [current, setCurrent] = useState<ViewId>('job');
  const onView = (v: string): void => {
    if (v === 'run' || v === 'setup') { jobStep.value = v === 'setup' ? 'stock' : 'run'; setCurrent('job'); }
    else if (v === 'machines' || v === 'tools' || v === 'materials') { librarySection.value = v as LibrarySection; setCurrent('library'); }
    else if (VIEWS.some((x) => x.id === v)) setCurrent(v as ViewId);
  };
  useEffect(() => {
    document.documentElement.dataset['view'] = current;
  }, [current]);
  // The Position panel says when another tab of this browser controls the machine (controlBlock.ts).
  const observing = props.role?.value.observing === true && props.liveTab?.value !== true;
  useEffect(() => {
    observingElsewhere.value = observing;
  }, [observing]);
  // A view asked for from elsewhere in the page (C17's "Set up homing").
  const requested = viewRequest.value;
  useEffect(() => {
    if (requested === null) return;
    viewRequest.value = null;
    onView(requested);
  }, [requested]);
  const model = props.model ?? null;
  const machine = selectedMachine.value;
  const label = VIEWS.find((v) => v.id === current)?.label ?? 'Job';
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
    { class: 'app', 'data-shell': 'workspace', 'data-level': uiLevel.value.value },
    h(SafetyBar, { build: props.build, variant: 'workspace' }),
    h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'brand', href: '/' }, h('svg', { viewBox: '0 0 28 28', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'aria-hidden': 'true' }, h('circle', { cx: 14, cy: 14, r: 9 }), h('path', { d: 'M14 0v9m0 10v9M0 14h9m10 0h9' })), h('strong', null, 'Synthetos'), h('span', { class: 'brand-run' }, 'Run')),
      h(
        'nav',
        { class: 'context', 'aria-label': 'Breadcrumb' },
        h('button', { type: 'button', class: 'crumb', onClick: () => onView('machines') }, machine?.name ?? 'Workshop'),
        h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
        h('span', { class: 'crumb current', 'aria-current': 'page' }, label),
      ),
      h(
        'div',
        { class: 'top-actions' },
        h(LevelSwitch, null),
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
          h(Banners, { ...props, view: current, onReview: () => { boardTab.value = 'settings'; onView('board'); } }),
          // After a connect: a newer signed release for this board (firmware/updateOffer.ts decides when).
          h(FirmwareOffer, { model: props.model ?? null, role: props.role?.value ?? null, live: props.liveTab?.value === true }),
          pane('job', h(JobView, { model, spawn: props.spawn ?? null, spawnCarve: props.spawnCarve ?? null, ...(props.marker === undefined ? {} : { marker: props.marker }), onView, ...(props.onPause === undefined ? {} : { onPause: props.onPause }), ...(props.onStopJob === undefined ? {} : { onStopJob: props.onStopJob }) })),
          pane('library', h(LibraryView, { model, onView })),
          pane('board', h(BoardView, { model })),
          pane('projects', h(ProjectsView, { onView })),
          pane('analyze', h(AnalyzeView, { model })),
          pane('settings', h(PreferencesView, { build: props.build, model: props.model ?? null })),
          pane('safety', h(SafetyView, { model: props.model ?? null })),
        ),
      ),
      h(LibrarySyncNotice, null),
      h(ReportDialog, { build: props.build, model, view: current }),
    ),
    h(
      'footer',
      { class: 'footer' },
      h('span', null, 'Review settings before applying'),
      h('span', { class: 'footer-secondary' }, 'Libraries saved in this browser'),
      h('span', { class: 'mono', 'data-version': '', title: `Version ${props.build.version}, commit ${props.build.sha}` }, versionLabel(props.build)),
    ),
  );
}
