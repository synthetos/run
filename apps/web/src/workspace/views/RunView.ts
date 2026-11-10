/**
 * The Job workspace: machine, stock, placement, checks and execution share
 * one preview and live session. The existing machine controls and execution
 * gates stay mounted as the user moves between preparation steps.
 *
 * The preview is the TB-03 PreviewPanel (gcode.worker, Preview3D, LineList)
 * arranged by `runLayout`. The timeline scrubs and highlights lines. Play
 * preview (owner, 2026-11-09; SAFETY H15 and T-S41 amended, OD-25) moves a
 * labelled preview tool along the moves at programmed speeds, offered only
 * when no job of this tab runs and the board is not moving
 * (preview/playAllowed.ts). There is no Simulate or Animate control.
 */
import { h, type ComponentChild } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { c24, c25, c25HandSet, c27, c28, c29, w13 } from '@synthetos/safety';
import { DIALECTS } from '@synthetos/protocol';
import { LITE_THRESHOLD_LINES } from '../../gcode-worker/pipeline.ts';
import type { WorkerLike } from '../../gcode-worker/client.ts';
import { PreviewPanel, markerText, type LiveMarkerView, type PreviewParts } from '../../preview/PreviewPanel.ts';
import { fileLevel, on, progressText } from '../../preview/PreviewView.ts';
import type { PreviewResult } from '../../gcode-worker/pipeline.ts';
import { routineChanges, shownCounts } from '../../preview/gcodeList.ts';
import { ConnectPanel, refusedTitle } from '../../live/ConnectPanel.ts';
import { settingsOf } from '../boardFacts.ts';
import { Icon, type IconName } from '../icons.ts';
import { readStored, writeStored } from '../storage.ts';
import { belowStrip, CheckRow, ConfirmCard, IconButton, TabBar, TabPane } from '../ui.ts';
import { connected, type LiveView, type WorkspaceModel } from '../model.ts';
import { goToZeroSafeZ } from '../safeZ.ts';
import { TC_GO_REASON, TC_OFFSET_REASON, atToolChange, jogBlocked, zeroBlocked } from '../toolChangeControls.ts';
import { JOG_FEED, JogController, MM_PER_IN, STEPS_IN, STEPS_MM, axesText, goToZeroPath, jogKey, machineAxes, machineZ, motionUi, offsetsView, type JogTimers, type MotionUi } from '../motion.ts';
import { HomeSection, HomeQuick, UnknownExits } from '../homing.ts';
import { ProbeZ } from '../probe/ProbeZ.ts';
import { PositionStatus } from '../positionStatus.ts';
import { ControlBlockCard, currentBlock } from '../ControlBlockCard.ts';
import { outputsOff } from '../controlBlock.ts';
import { WorkZeroConfirm } from '../workZeroConfirm.ts';
import type { MotionAxis, MotionCommand } from '../../machine-worker/rpc.ts';
import { ContextHelp } from '../../shell/ContextHelp.ts';
import { fileFacts, sampleFile, SAMPLES } from '../samples.ts';
import { openReport } from '../../report/state.ts';
import { closeJob, currentFile, currentPreview, executionLock, openJob, pendingOpen, reopenActiveJob, reopening, saveDraftToProject, type OpenSource } from '../fileBridge.ts';
import { activeJob, jobSaved, type Job } from '../jobModel.ts';
import { bedSizeText, jobStateText, machineText } from '../revisionWords.ts';
import { materialColor, selectedMachine } from '../library.ts';
import { PlayControls, PlayNotice } from '../../preview/PlayControls.ts';
import { placeTravelText } from '../placeTravel.ts';
import { playAllowedFor, playRapidOf } from '../../preview/playAllowed.ts';
import { openToolNumber } from '../toolNumbers.ts';
import { projectsState } from '../../projects/store.ts';
import { projectStore } from '../../projects/browserStore.ts';
import { jobScene } from '../../preview/sceneModel.ts';
import { spindleToolChoice } from '../advisorState.ts';
import { useLivePathFrame, useLivePlacement } from '../../preview/useLivePlacement.ts';
import { ViewerOverlay } from '../../preview/ViewerOverlay.ts';
import { ViewerOptions } from '../../preview/ViewerOptions.ts';
import { ExpandButton, previewExpanded } from '../../preview/expandPreview.ts';
import { openSceneSettings, type ScenePart } from '../../preview/sceneSettings.ts';
import { sceneColors, tokenReader } from '../../preview/colors.ts';
import { ViewButtons } from '../../preview/SceneView.ts';
import type { CarveWorkerLike, ViewPreset } from '@synthetos/gcode-view';
import { COOLANT_TITLE, coolantText, coord, displayReadouts, num, SPINDLE_TITLE, spindleText, UNKNOWN } from '../status.ts';
import { jobUi, PHASE_TEXT, plannerRanges, starving } from '../jobUi.ts';

const PHASE_LABEL = (phase: string): string => PHASE_TEXT[phase] ?? phase;
import { JobStatus, JobSteps, JobStopCard, type StopHooks } from './JobViews.ts';
import { JOB_STEPS, jobStep, uiLevel } from '../jobWorkflow.ts';
import { JobSetupPanel } from './SetupView.ts';
import { JobFiles } from '../../projects/ProjectsView.ts';
import { Dock } from '../dock/Dock.ts';
import { reportsNotice } from '../reportsNotice.ts';

export interface RunViewProps {
  readonly model: WorkspaceModel | null;
  readonly spawn: (() => WorkerLike) | null;
  /** Starts the carve worker for the stock carving; null or absent for none. */
  readonly spawnCarve?: (() => CarveWorkerLike) | null;
  readonly marker?: ReadonlySignal<LiveMarkerView | null>;
  readonly onView: (view: string) => void;
  /** Pause and Stop job: the machine strip's own calls (never gated; absent in the prerendered page). */
  readonly onPause?: () => void;
  readonly onStopJob?: () => void;
}

export function RunView({ model, spawn, spawnCarve = null, marker, onView, onPause, onStopJob }: RunViewProps): ComponentChild {
  const live = model?.live.value ?? null;
  const reportedLine = live !== null && connected(live) ? (live.message?.snapshot.live.line ?? null) : null;
  const ui = jobUi(live);
  const job = ui.job !== null && ui.job.startedAt !== null ? ui.job : null;
  const blocks = DIALECTS.find((d) => d.id === ui.snapshot?.classification?.dialectId)?.limits.plannerBlocks ?? null;
  const starve = starving(ui.snapshot, blocks);
  const stops: StopHooks = { ...(onPause === undefined ? {} : { onPause }), ...(onStopJob === undefined ? {} : { onStopJob }) };
  const sendJob = model?.actions.value?.job;
  // The active-execution lock (FLOW_ANALYSIS §3): while the worker's job owns the machine nothing replaces the preview.
  useEffect(() => {
    executionLock.value = ui.active ? `${PHASE_LABEL(ui.job?.phase ?? 'running')}: the job owns the preview.` : null;
  }, [ui.active, ui.job?.phase]);
  const active = activeJob.value;
  const planned = useMemo(() => (active === null ? null : jobScene(active, sceneColors(tokenReader()), materialColor(active.setup.stock.materialRef.id))), [active]);
  // The live machine (preview/livePlacement.ts): the job placed where the board is once its position is established, its work position mapped into the path's frame at the line it reports (pathFrame.ts).
  const snap = live !== null && connected(live) ? (live.message?.snapshot ?? null) : null;
  const { scene, tool } = useLivePlacement(planned, snap === null ? null : { ...snap.live, overlays: snap.overlays }, useLivePathFrame(currentFile.value?.preview ?? null, ui.job));
  return h(PreviewPanel, {
    spawn,
    spawnCarve,
    spindleTool: spindleToolChoice.value,
    ...(marker === undefined ? {} : { marker }),
    tool,
    reportedLine,
    job: job === null ? null : { executing: job.executing?.line ?? null, sentThrough: job.sentThrough, toolChange: job.toolChange, carve: { id: job.id, hash: job.hash, startedAt: job.startedAt, executing: job.executing?.line ?? null, active: ui.active } },
    planner: (sourceLines: Uint32Array) => plannerRanges(job, sourceLines, starve),
    ...(sendJob === undefined ? {} : { onBreakpoints: (lines: readonly number[]) => void sendJob({ op: 'breakpoints', lines: [...lines] }) }),
    onReportLine: (line: number) => openReport({ origin: 'line', line }),
    scene,
    boardTool: snap?.live.tool ?? null,
    // Play preview (OD-25): never while this tab's job runs or the board moves.
    playAllowed: playAllowedFor(ui.active, snap === null ? null : { base: snap.base, overlays: snap.overlays }),
    ...(playRapidOf(selectedMachine.value) === undefined ? {} : { playRapid: playRapidOf(selectedMachine.value) as number }),
    // Opening a part's settings is navigation only; not while a job owns the machine.
    ...(ui.active ? {} : { onScenePick: (part: ScenePart) => openSceneSettings(part, onView) }),
    layout: (parts: PreviewParts) => runLayout(parts, model, onView, stops),
  });
}

/** Opens a file through the one job opener and reports a refusal in the job card. */
function openFrom(file: File, source: OpenSource, setNote: (n: string | null) => void): void {
  setNote(null);
  void openJob(file, source).then((r) => {
    if (!r.ok) setNote(r.reason);
  });
}

/**
 * Publishes the open file for a report's excerpt and its path for the Setup view's scene
 * (workspace/fileBridge.ts), loads the file the job opener resolved, and reopens the active job's file
 * once after a reload. Renders nothing.
 */
function RunBridge({ parts }: { readonly parts: PreviewParts }): ComponentChild {
  const { state, actions } = parts;
  const result = state.status === 'ready' ? state.result : null;
  useEffect(() => {
    currentFile.value = result === null || state.fileName === null ? null : { name: state.fileName, bytes: result.bytes, preview: result };
    currentPreview.value = result === null || state.fileName === null ? null : { name: state.fileName, segments: result.segments, bounds: result.summary.bounds };
  }, [result, state.fileName]);
  const pending = pendingOpen.value;
  const onFile = actions.onFile;
  useEffect(() => {
    if (pending === null || !state.ready || onFile === undefined) return;
    pendingOpen.value = null;
    onFile(pending.file);
  }, [pending, state.ready, onFile]);
  useEffect(() => {
    if (!state.ready || onFile === undefined) return;
    void reopenActiveJob();
  }, [state.ready, onFile === undefined]);
  return null;
}

// ---------------------------------------------------------------- connect

/** The Connect card: the existing LIVE entry flow (live/ConnectPanel.ts), restyled. C1 opens as a dialog. */
export function ConnectNotice({ model, onView, compact = false }: { readonly model: WorkspaceModel | null; readonly onView?: (view: string) => void; readonly compact?: boolean }): ComponentChild {
  const view = model?.live.value ?? null;
  const actions = model?.actions.value ?? null;
  const step = view?.entry.step ?? 'idle';
  const isConnected = view !== null && connected(view);
  const panel = h(ConnectPanel, {
    state: view?.entry ?? { step: 'idle' },
    advisoryBlocked: view?.advisoryBlocked ?? null,
    onConnect: () => actions?.connect(),
    onConfirm: (ticked) => actions?.confirm(ticked),
    onCancel: () => actions?.cancel(),
    onDisconnect: () => actions?.disconnect(),
  });
  const heading = isConnected
    ? 'Connected'
    : step === 'refused'
      ? 'Not connected'
      : 'Connect your TinyG';
  const copy = isConnected
    ? view?.message?.motion === true
      ? 'Controls follow the machine’s current state.'
      : view?.message?.settingsWrites === true
        ? 'Review and apply settings in Board.'
        : 'Read-only connection.'
    : 'Connect by USB to read your board and check its setup.';
  if (compact) {
    // In the machine strip (owner, 2026-11-03): the Connect flow beside the state, nothing said twice.
    return h(
      'div',
      { class: 'connect-notice compact', 'data-region': 'connect' },
      step === 'c1' || step === 'refused' ? (step === 'refused' ? h(ConnectPanel, { state: { step: 'idle' }, advisoryBlocked: view?.advisoryBlocked ?? null, onConnect: () => actions?.connect(), onConfirm: () => undefined, onCancel: () => undefined, onDisconnect: () => undefined }) : null) : panel,
      // A refusal is a modal below the strip (OD-16), not text squeezed into it.
      step === 'refused'
        ? h('div', { class: 'dialog-wrap confirm-modal', role: 'presentation', ref: belowStrip }, h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'refused-title' }, h('div', { class: 'dialog-head' }, h('h2', { id: 'refused-title' }, refusedTitle(view?.entry ?? null))), panel))
        : null,
      step === 'c1'
        ? h(
            'div',
            {
              class: 'dialog-wrap strip-dialog',
              role: 'presentation',
              // In the strip the dialog would be cut to the strip's height: it covers the page below the strip instead,
              // never the stop controls (SAFETY §4.1 UI rules).
              ref: (el: HTMLElement | null) => {
                const bottom = el?.closest('.statebar')?.getBoundingClientRect().bottom;
                if (el !== null && bottom !== undefined) el.style.setProperty('--strip-bottom', `${Math.round(bottom)}px`);
              },
            },
            h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'c1-title' }, h('div', { class: 'dialog-head' }, h('h2', { id: 'c1-title' }, 'Before you connect')), panel),
          )
        : null,
    );
  }
  return h(
    'div',
    { class: `scenario-notice connect-notice${isConnected ? ' is-connected' : ''}`, 'data-region': 'connect' },
    h('div', { class: 'notice-text' }, h('strong', null, heading), h(ContextHelp, { id: 'connect-help', label: 'About connecting', below: true, end: true }, copy), reportsNotice(view)),
    h(
      'div',
      { class: 'notice-actions' },
      step === 'c1' ? null : panel,
      // The port is open or opening but LIVE entry has not finished (or ended elsewhere): Disconnect still applies.
      isConnected && step !== 'live' && step !== 'c1' ? h('button', { type: 'button', class: 'button', 'data-action': 'disconnect', onClick: () => actions?.disconnect() }, 'Disconnect') : null,
      isConnected && onView !== undefined ? h('button', { type: 'button', class: 'small', onClick: () => onView('board') }, 'Open the board') : null,
    ),
    step === 'c1'
      ? h(
          'div',
          { class: 'dialog-wrap', role: 'presentation' },
          h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'c1-title' }, h('div', { class: 'dialog-head' }, h('h2', { id: 'c1-title' }, 'Before you connect')), panel),
        )
      : null,
  );
}

// ---------------------------------------------------------------- position

function ageText(view: LiveView): { readonly text: string; readonly lag: string } {
  const m = view.message;
  if (m === null || m.snapshot.base === 'NOT_CONNECTED') return { text: 'Not connected', lag: 'none' };
  const base = m.dro.machineSource.ageMs;
  if (base === null) return { text: 'Waiting for position', lag: 'none' };
  const age = base + Math.max(0, view.now - view.receivedAt);
  const lag = m.snapshot.overlays.includes('STALE') || age >= m.lag.redMs ? 'red' : age >= m.lag.amberMs ? 'amber' : 'fresh';
  return { text: `${lag === 'fresh' ? 'Live' : lag === 'amber' ? 'Lagging' : 'Stale'} · ${(age / 1000).toFixed(2)} s`, lag };
}

/**
 * The Position readout with the hobbyist's two actions on each axis row (OD-13): Zero here (G10 L20 in the active
 * system, C16) and Go to zero (Z rises first, C25), plus Zero all and Go to zero for X, Y and Z in the same column,
 * on the status line's row. Only the machine's axes are shown. While a block holds (controlBlock.ts: read only,
 * UNKNOWN, alarm, another tab, ...) one card at the top says why and offers the way out, and the actions are not
 * drawn at all (owner, 2026-11-09); a passing gate (a move or a job running) leaves them in place, disabled.
 */
function positionBody({ model }: PositionProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const m = view !== null && connected(view) ? view.message : null;
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const enabled = ui.enabled && send !== undefined;
  const settings = settingsOf(view);
  const axes = machineAxes(settings);
  const dro = m?.dro.axes ?? [];
  const row = (a: MotionAxis): { readonly work: number | null; readonly machine: number | null; readonly homed: boolean | null } => dro.find((d) => d.axis === a) ?? { work: null, machine: null, homed: null };
  const age = view === null ? { text: 'Not connected', lag: 'none' } : ageText(view);
  const wcs = m?.dro.wcs ?? null;
  // `home` as read at connect (the jog gate's view of it), else what the per-axis reports say.
  const homedRows = axes.map(row).filter((d) => d.homed !== null);
  const homed: boolean | null = ui.homed ?? (homedRows.length === 0 ? null : homedRows.every((d) => d.homed === true));
  const tool = m?.snapshot.live.tool;
  const units = m?.dro.units ?? null;
  const system = offsetsView(view).system ?? 'G54';
  const zNow = machineZ(view);
  const ztm = typeof settings['ztm'] === 'number' ? (settings['ztm'] as number) : null;
  // OD-23: lift to ztm − 1 only after a homing seen in this connection (safeZ.ts).
  const { safe, handSet } = goToZeroSafeZ({ homed: ui.homed, zHomedHere: (m?.snapshot.notices.homedAxes ?? []).includes('z'), ztm, zNow });
  type Confirm = { readonly kind: 'set' | 'go'; readonly axes: readonly MotionAxis[] } | null;
  const [confirm, setConfirm] = hk.state<Confirm>(null);
  const [note, setNote] = hk.state<string | null>(null);
  const run = (command: MotionCommand): void => {
    setConfirm(null);
    setNote(null);
    void send?.(command).then(setNote);
  };
  // H74 (2026-11-08): at a tool change only the Z re-zero (toolChangeControls.ts).
  const snap = m?.snapshot ?? null;
  const act = (icon: IconName, label: string, onClick: () => void, blocked: string | null = null): ComponentChild =>
    h(IconButton, { icon, label, why: blocked ?? ui.reason ?? null, attrs: { 'data-machine-control': 'zero' }, ...(enabled && blocked === null ? { onClick } : { disabled: true }) });
  const card =
    confirm === null || !enabled
      ? null
      : confirm.kind === 'set'
        ? h(WorkZeroConfirm, { axes: confirm.axes, system, machine: (a: MotionAxis) => row(a).machine, advanced: uiLevel.value.value === 'advanced', onCancel: () => setConfirm(null), onConfirm: () => run({ op: 'setZero', axes: confirm.axes }) })
        : h(ConfirmCard, { text: `${c25({ axes: axesText(confirm.axes), path: goToZeroPath(confirm.axes, safe, zNow) })}${handSet ? ` ${c25HandSet()}` : ''}`, confirm: 'Go to zero', safety: 'C25', onCancel: () => setConfirm(null), onConfirm: () => run({ op: 'goToZero', axes: confirm.axes, safeZ: safe }) });
  const xyz: readonly MotionAxis[] = ['x', 'y', 'z'];
  const block = currentBlock(model);
  const actions = block === null;
  const advanced = uiLevel.value.value === 'advanced';
  return h(
    'section',
    { class: 'insp sec-position', 'data-region': 'position', 'aria-labelledby': 'position-title' },
    h(
      'header',
      null,
      h('h2', { id: 'position-title' }, 'Position'),
      h(
        'span',
        { class: 'pos-head-right' },
        m === null ? null : h('span', { class: `source lag-${age.lag}`, 'data-position': 'freshness', title: `${age.text}. The age is the time since the controller last said anything.` }, age.lag === 'none' ? age.text : age.text.slice(age.text.indexOf('·') + 2)),
      ),
    ),
    // UNKNOWN's exits also under another card: "I've checked the machine" clears it without motion (T-S105).
    block === null || block.kind === 'unknown' ? null : h(ControlBlockCard, { block, model: model ?? null }),
    block === null ? null : h(UnknownExits, { model: model ?? null }),
    h(
      'div',
      { class: `dro-grid${actions ? '' : ' no-actions'}`, role: 'table', 'aria-label': 'Position' },
      // The actions' column heads name the icons (Zero, Go) at both levels; Simple hides the other heads.
      h(
        'div',
        { class: `dro-head${advanced || actions ? '' : ' sr-only'}`, role: 'row' },
        h('span', { role: 'columnheader' }, h('span', { class: 'sr-only' }, 'Axis')),
        h('span', { role: 'columnheader' }, h('span', { class: advanced ? undefined : 'sr-only' }, units === null ? 'Work' : `Work, ${units}`)),
        h('span', { role: 'columnheader' }, h('span', { class: advanced ? undefined : 'sr-only' }, 'Machine, mm')),
        actions ? h('span', { role: 'columnheader', class: 'dro-act-heads' }, h('span', { 'aria-hidden': 'true' }, 'Zero'), h('span', { 'aria-hidden': 'true' }, 'Go'), h('span', { class: 'sr-only' }, 'Actions')) : null,
      ),
      axes.map((a) => {
        const d = row(a);
        return h(
          'div',
          { class: 'dro-row', role: 'row', key: a, 'data-position-axis': a },
          h('span', { class: 'axis', role: 'rowheader' }, a.toUpperCase()),
          h('strong', { role: 'cell', 'data-position': 'work' }, coord(d.work)),
          h('span', { role: 'cell', 'data-position': 'machine' }, coord(d.machine)),
          actions ? h('span', { class: 'dro-actions', role: 'cell' }, act('zeroHere', `Set ${a.toUpperCase()} work zero here`, () => setConfirm({ kind: 'set', axes: [a] }), zeroBlocked(snap, [a])), act('goZero', `Go to ${a.toUpperCase()} zero`, () => setConfirm({ kind: 'go', axes: [a] }), atToolChange(snap) ? TC_GO_REASON : null)) : null,
        );
      }),
      // The status line on the grid's last row, with the X, Y and Z actions in the per-axis actions' column.
      m === null && !actions
        ? null
        : h(
            'div',
            { class: 'dro-row pos-status-row', role: 'row' },
            h('span', { class: 'pos-status-cell', role: 'cell' }, m === null ? null : h(PositionStatus, { wcs: wcs?.code ?? null, homed, by: m.snapshot.notices.position?.by, tool: typeof tool === 'number' ? tool : null, units: advanced || units === null ? null : `Work in ${units}` })),
            actions ? h('span', { class: 'dro-actions pos-all', role: 'cell' }, act('zeroHere', `Set ${axesText(xyz)} work zero here`, () => setConfirm({ kind: 'set', axes: xyz }), zeroBlocked(snap, xyz)), act('goZero', `Go to ${axesText(xyz)} zero`, () => setConfirm({ kind: 'go', axes: xyz }), atToolChange(snap) ? TC_GO_REASON : null)) : null,
          ),
    ),
    actions ? h(ProbeZ, { model: model ?? null }) : null,
    card,
    note === null ? null : h('p', { class: 'motion-note', role: 'status', 'data-position': 'note' }, note),
  );
}



type PositionProps = { readonly model?: WorkspaceModel | null };

function PositionLive(props: PositionProps): ComponentChild {
  return positionBody(props, LIVE_HOOKS);
}

export function PositionPanel(props: PositionProps = {}): ComponentChild {
  return isLive(props.model) ? h(PositionLive, props) : positionBody(props, STATIC_HOOKS);
}

// ---------------------------------------------------------------- inspector: motion (Phase 2)

/** The page's own "don't ask again" for C24, for this page load only: never stored (SAFETY §4.5b, H52). */
let spindleConfirmSkipped = false;

/** Tests only: forget the session's "don't ask again" for C24. */
export function resetSpindleConfirm(): void {
  spindleConfirmSkipped = false;
}

/**
 * The hooks a motion section uses. A section renders with real hooks only while a LIVE motion session can act
 * (the model has the motion action); otherwise it renders once, statically, with every control disabled and no
 * handler (the prerendered page, and the shell tests' tree expansion).
 */
interface Hooks {
  state<T>(initial: T): [T, (v: T) => void];
  memo<T>(make: () => T, deps: readonly unknown[]): T;
  effect(run: () => void | (() => void), deps: readonly unknown[]): void;
}
const LIVE_HOOKS: Hooks = {
  state: <T,>(initial: T) => useState<T>(initial) as [T, (v: T) => void],
  memo: (make, deps) => useMemo(make, deps as unknown[]),
  effect: (run, deps) => useEffect(run, deps as unknown[]),
};
const STATIC_HOOKS: Hooks = { state: <T,>(initial: T): [T, (v: T) => void] => [initial, () => undefined], memo: (make) => make(), effect: () => undefined };

function isLive(model: WorkspaceModel | null | undefined): boolean {
  return model?.actions.value?.motion !== undefined;
}

function motionNote(ui: MotionUi, note: string | null): ComponentChild {
  // Only what an action answered: a block is the Position panel's card, a passing gate each disabled control's title.
  const text = note ?? ui.notice;
  if (text === null) return null;
  return h('p', { class: 'motion-note', 'data-jog': 'note', role: 'status' }, text);
}

const PAD: readonly { readonly label: string; readonly text: string; readonly axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>> | null }[] = [
  { label: 'X−, Y+', text: '↖', axes: { x: -1, y: 1 } },
  { label: 'Y+', text: 'Y+', axes: { y: 1 } },
  { label: 'X+, Y+', text: '↗', axes: { x: 1, y: 1 } },
  { label: 'X−', text: 'X−', axes: { x: -1 } },
  { label: 'Go to X0 Y0', text: '⌖', axes: null },
  { label: 'X+', text: 'X+', axes: { x: 1 } },
  { label: 'X−, Y−', text: '↙', axes: { x: -1, y: -1 } },
  { label: 'Y−', text: 'Y−', axes: { y: -1 } },
  { label: 'X+, Y−', text: '↘', axes: { x: 1, y: -1 } },
];

const realTimers: JogTimers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) };

/**
 * The jog panel (SAFETY §4.5b, H50, H51): the XY pad and Z, step sizes in mm or inches or Hold, the jog speed,
 * and keyboard jog while the panel has focus. Without a LIVE motion session every control is disabled and
 * carries no handler.
 */
function jogBody({ model, onGoToZero }: JogProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const enabled = ui.enabled && send !== undefined;
  const [units, setUnits] = hk.state<'mm' | 'in'>('mm');
  const [stepIndex, setStepIndex] = hk.state<number | null>(2);
  const [feed, setFeed] = hk.state<number>(JOG_FEED.default);
  const [note, setNote] = hk.state<string | null>(null);
  const controller = hk.memo(
    () =>
      new JogController((c) => {
        void send?.(c).then((reason) => {
          if (c.op === 'jog') setNote(reason);
        });
      }, realTimers),
    [send],
  );
  hk.effect(() => {
    // Any held jog stops when the window loses focus or the page is hidden, or on any pointer-up (H50).
    const release = (): void => controller.release();
    const hidden = (): void => {
      if (document.visibilityState !== 'visible') controller.release();
    };
    addEventListener('blur', release);
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      controller.release();
      removeEventListener('blur', release);
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [controller]);
  const steps = units === 'mm' ? STEPS_MM : STEPS_IN;
  const settings = (): { stepMm: number | null; feed: number } => ({ stepMm: stepIndex === null ? null : (steps[stepIndex] as number) * (units === 'in' ? MM_PER_IN : 1), feed });
  // A held jog keeps its buttons live so the release always arrives (a disabled button gets no pointer-up).
  const live = send !== undefined && (ui.enabled || ui.busy || controller.holding);
  const press = (axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>) => (e: PointerEvent) => {
    if (!enabled) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setNote(null);
    controller.press(axes, settings());
  };
  const jogButton = (label: string, text: string, axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>, cls: string): ComponentChild =>
    h(
      'button',
      {
        type: 'button',
        class: cls,
        'aria-label': label,
        key: label,
        'data-machine-control': 'jog',
        ...(jogBlocked(view?.message?.snapshot, axes) === null ? {} : { title: jogBlocked(view?.message?.snapshot, axes) as string }),
        ...(live && jogBlocked(view?.message?.snapshot, axes) === null ? { onPointerDown: press(axes), onPointerUp: () => controller.release(), onLostPointerCapture: () => controller.release() } : { disabled: true }),
      },
      text,
    );
  const onKeyDown = (e: KeyboardEvent): void => {
    const axes = jogKey(e.key);
    if (axes === null || !live || !document.hasFocus()) return;
    e.preventDefault();
    if (e.repeat || !enabled) return;
    setNote(null);
    controller.press(axes, settings());
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (jogKey(e.key) !== null) controller.release();
  };
  return h(
    'section',
    { class: 'insp sec-jog', 'aria-labelledby': 'jog-title' },
    h('header', null, h('h2', { id: 'jog-title' }, 'Jog')),
    h(
      'div',
      {
        class: 'jog',
        'aria-disabled': live ? 'false' : 'true',
        tabindex: live ? 0 : -1,
        'data-jog': 'panel',
        'aria-label': 'Jog pad. Arrow keys jog X and Y, Page Up and Page Down jog Z, while this panel has focus.',
        ...(live ? {} : { title: ui.reason ?? undefined }),
        ...(live
          ? {
              onKeyDown,
              onKeyUp,
              // Focus leaving the panel (not moving between its own buttons) ends a held keyboard jog.
              onFocusOut: (e: FocusEvent) => {
                if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) controller.release();
              },
            }
          : {}),
      },
      h(
        'div',
        { class: 'jog-pads' },
        h(
          'div',
          { class: 'jog-pad', role: 'group', 'aria-label': 'X and Y' },
          PAD.map((p, i) =>
            p.axes === null
              ? h('button', { type: 'button', class: 'j', 'aria-label': p.label, key: p.label, 'data-machine-control': 'zero', ...(enabled && onGoToZero !== undefined ? { onClick: () => onGoToZero(['x', 'y']) } : { disabled: true }) }, p.text)
              : jogButton(p.label, p.text, p.axes, `j${i % 2 === 0 ? ' diag' : ''}`),
          ),
        ),
        h('div', { class: 'jog-z', role: 'group', 'aria-label': 'Z' }, jogButton('Z up', 'Z+', { z: 1 }, 'j'), jogButton('Z down', 'Z−', { z: -1 }, 'j')),
      ),
      h(
        'div',
        { class: 'seg full', role: 'group', 'aria-label': 'Step size' },
        steps.map((v, i) =>
          h('button', { type: 'button', key: `${units}${v}`, class: stepIndex === i ? 'selected' : undefined, 'aria-pressed': stepIndex === i ? 'true' : 'false', 'data-machine-control': 'jog', ...(enabled ? { onClick: () => setStepIndex(i) } : { disabled: true }) }, String(v)),
        ),
        h('button', { type: 'button', class: stepIndex === null ? 'selected' : undefined, 'aria-pressed': stepIndex === null ? 'true' : 'false', 'data-machine-control': 'jog', title: 'Jog while the button or key is held', ...(enabled ? { onClick: () => setStepIndex(null) } : { disabled: true }) }, 'Hold'),
      ),
      h(
        'div',
        { class: 'jog-settings' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Step units' }, (['mm', 'in'] as const).map((u) => h('button', { type: 'button', key: u, class: units === u ? 'selected' : undefined, 'aria-pressed': units === u ? 'true' : 'false', 'data-machine-control': 'jog', ...(enabled ? { onClick: () => setUnits(u) } : { disabled: true }) }, u))),
        uiLevel.value.value !== 'advanced' ? null : h(
          'label',
          { class: 'jog-feed' },
          h('span', null, 'Jog speed'),
          h('input', {
            type: 'number',
            min: JOG_FEED.min,
            max: JOG_FEED.max,
            step: 10,
            value: feed,
            ...(enabled ? { onInput: (e: Event) => setFeed(Math.min(JOG_FEED.max, Math.max(JOG_FEED.min, Number((e.currentTarget as HTMLInputElement).value) || JOG_FEED.default))) } : { disabled: true }),
            'aria-label': 'Jog speed, mm per minute',
            'data-machine-control': 'jog',
          }),
          h('small', null, 'mm/min'),
        ),
      ),
    ),
    motionNote(ui, note),
  );
}

type JogProps = { readonly model?: WorkspaceModel | null; readonly onGoToZero?: (axes: readonly MotionAxis[]) => void };

function JogLive(props: JogProps): ComponentChild {
  return jogBody(props, LIVE_HOOKS);
}

export function JogSection(props: JogProps = {}): ComponentChild {
  return isLive(props.model) ? h(JogLive, props) : jogBody(props, STATIC_HOOKS);
}

/**
 * Offsets (amendment 2026-11-02; SAFETY §4.5b, H53, H68, C16, C25, C27-C29): the work coordinate system (G54..G59),
 * Set work zero per axis and for all (G10 L20 in the active system, saved on the controller), Go to zero (Z rises in
 * machine coordinates first), the temporary offset (G92, not saved; cleared with G92.1), and the active offsets as the
 * board reported them. Every change is read back by the session.
 */
function zeroBody({ model, ask, goOnly = false }: ZeroProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const settings = settingsOf(view);
  const zNow = machineZ(view);
  const ztm = typeof settings['ztm'] === 'number' ? (settings['ztm'] as number) : null;
  const [safeZ, setSafeZ] = hk.state<number | null>(null);
  // OD-23: lift to ztm − 1 only after a homing seen in this connection (safeZ.ts).
  const planned = goToZeroSafeZ({ homed: ui.homed, zHomedHere: (view?.message?.snapshot.notices.homedAxes ?? []).includes('z'), ztm, zNow });
  const safe = safeZ ?? planned.safe;
  const handSet = safeZ === null && planned.handSet;
  type Confirm = { readonly kind: 'set' | 'go' | 'temp'; readonly axes: readonly MotionAxis[] } | { readonly kind: 'clear' } | { readonly kind: 'system'; readonly n: number } | null;
  const [confirm, setConfirm] = hk.state<Confirm>(null);
  const [note, setNote] = hk.state<string | null>(null);
  hk.effect(() => {
    if (ask !== null && ask !== undefined && ui.enabled) setConfirm({ kind: 'go', axes: ask.axes });
  }, [ask?.at]);
  const off = offsetsView(view);
  const system = off.system ?? 'G54';
  const dro = view?.message?.dro.axes ?? [];
  const work = (a: MotionAxis): number | null => dro.find((d) => d.axis === a)?.work ?? null;
  const machine = (a: MotionAxis): number | null => dro.find((d) => d.axis === a)?.machine ?? null;
  const enabled = ui.enabled && send !== undefined;
  const run = (command: MotionCommand): void => {
    setConfirm(null);
    setNote(null);
    void send?.(command).then(setNote);
  };
  // H74 (2026-11-08): at a tool change only the Z re-zero (toolChangeControls.ts); a blocked button says why.
  const snap = view?.message?.snapshot ?? null;
  const tc = atToolChange(snap);
  const button = (label: string, aria: string, onClick: () => void, control = 'zero', ok = true, blocked: string | null = null): ComponentChild =>
    h('button', { type: 'button', class: 'small', 'aria-label': aria, 'data-machine-control': control, ...(blocked === null ? {} : { title: blocked, 'data-blocked': 'tool-change' }), ...(enabled && ok && blocked === null ? { onClick } : { disabled: true }) }, label);
  const confirmCard = (): ComponentChild => {
    if (confirm === null || !enabled) return null;
    const cancel = (): void => setConfirm(null);
    switch (confirm.kind) {
      case 'set': {
        return h(WorkZeroConfirm, { axes: confirm.axes, system, machine: (a: MotionAxis) => machine(a) ?? null, advanced: uiLevel.value.value === 'advanced', onCancel: cancel, onConfirm: () => run({ op: 'setZero', axes: confirm.axes }) });
      }
      case 'go':
        return h(ConfirmCard, { text: `${c25({ axes: axesText(confirm.axes), path: goToZeroPath(confirm.axes, safe, zNow) })}${handSet ? ` ${c25HandSet()}` : ''}`, confirm: 'Go to zero', safety: 'C25', onCancel: cancel, onConfirm: () => run({ op: 'goToZero', axes: confirm.axes, safeZ: safe }) });
      case 'temp':
        return h(ConfirmCard, { text: c27({ axes: axesText(confirm.axes), system }), confirm: 'Set temporary offset', safety: 'C27', onCancel: cancel, onConfirm: () => run({ op: 'tempOffset', axes: confirm.axes }) });
      case 'clear':
        return h(ConfirmCard, { text: c28({ system }), confirm: 'Clear temporary offset', safety: 'C28', onCancel: cancel, onConfirm: () => run({ op: 'clearTempOffset' }) });
      default:
        return h(ConfirmCard, { text: c29({ system: `G${53 + confirm.n}` }), confirm: `Use G${53 + confirm.n}`, safety: 'C29', onCancel: cancel, onConfirm: () => run({ op: 'selectCoord', system: confirm.n }) });
    }
  };
  const offsetLine = (o: Readonly<Partial<Record<MotionAxis, number>>> | null): string =>
    o === null ? UNKNOWN : machineAxes(settings).map((a) => `${a.toUpperCase()} ${coord(o[a])}`).join(', ');
  // Simple: only the Go-to-zero confirmation the jog pad asked for (C25), in place; nothing else of the Offsets tab.
  if (goOnly) return confirm === null ? null : h('div', { class: 'insp sec-zero go-only' }, confirmCard(), motionNote(ui, note));
  return h(
    'section',
    { class: 'insp sec-zero', 'aria-labelledby': 'zero-title' },
    h('header', null, h('h2', { id: 'zero-title' }, 'Offsets'), h('span', { class: 'tag', 'data-offsets': 'system' }, off.system ?? 'G54–G59')),
    h(
      'div',
      { class: 'seg full wcs-seg', role: 'group', 'aria-label': 'Work coordinate system' },
      [1, 2, 3, 4, 5, 6].map((n) =>
        h(
          'button',
          { type: 'button', key: n, class: off.system === `G${53 + n}` ? 'selected' : undefined, 'aria-pressed': off.system === `G${53 + n}` ? 'true' : 'false', 'data-machine-control': 'offset', ...(tc ? { title: TC_OFFSET_REASON } : {}), ...(enabled && !tc && off.system !== `G${53 + n}` ? { onClick: () => setConfirm({ kind: 'system', n }) } : { disabled: true }) },
          `G${53 + n}`,
        ),
      ),
    ),
    // Plain headings (owner, 2026-11-09): the heading word itself opens its help, no round "?".
    h('h3', { class: 'tan-label' }, h(ContextHelp, { id: 'work-zero-help', label: 'Work zero: what Zero and Go do', trigger: 'Work zero', below: true }, `Zero sets the ${system} offset so the axis reads 0 here (G10 L20, saved on the controller). Go moves there, Z rising to Safe Z first.`)),
    h(
      'table',
      { class: 'zero-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), h('th', { scope: 'col' }, 'Work'), h('th', { scope: 'col' }, `${system} offset`), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h(
        'tbody',
        null,
        machineAxes(settings).map((a) =>
          h(
            'tr',
            { key: a, 'data-zero-axis': a },
            h('th', { scope: 'row' }, a.toUpperCase()),
            h('td', { class: 'num' }, coord(work(a))),
            h('td', { class: 'num', 'data-zero-offset': a }, coord(off.saved?.[a])),
            h('td', { class: 'zero-actions' }, button('Zero', `Set work zero for ${a.toUpperCase()} here, saved in ${system}`, () => setConfirm({ kind: 'set', axes: [a] }), 'zero', true, zeroBlocked(snap, [a])), button('Go', `Go to ${a.toUpperCase()} zero`, () => setConfirm({ kind: 'go', axes: [a] }), 'zero', true, tc ? TC_GO_REASON : null)),
          ),
        ),
      ),
    ),
    h(
      'label',
      { class: 'jog-feed' },
      h('span', null, 'Safe Z'),
      h('input', {
        type: 'number',
        step: 1,
        value: safe,
        ...(enabled ? { onInput: (e: Event) => setSafeZ(Number((e.currentTarget as HTMLInputElement).value)) } : { disabled: true }),
        'aria-label': 'Safe Z height in machine coordinates, mm',
        'data-machine-control': 'zero',
        title: 'Machine Z that Go rises to before X and Y move; never lower than Z is now.',
      }),
      h('small', null, 'mm'),
    ),
    h('h3', { class: 'tan-label' }, h(ContextHelp, { id: 'g92-help', label: 'Temporary offset: what it does', trigger: 'Temporary offset', below: true }, `G92 shifts work positions so the axes read 0 here without changing the saved ${system} offset. It is not saved: a reset or a program end clears it; Clear sends G92.1.`)),
    // One row per kind, in even columns: each axis, then All and Clear.
    h(
      'div',
      { class: 'temp-offset' },
      h('div', { class: 'temp-axes' }, machineAxes(settings).map((a) => button(`${a.toUpperCase()} = 0`, `Temporary offset: ${a.toUpperCase()} reads 0 here`, () => setConfirm({ kind: 'temp', axes: [a] }), 'offset', true, tc ? TC_OFFSET_REASON : null))),
      h(
        'div',
        { class: 'temp-all' },
        button('All = 0', 'Temporary offset: X, Y and Z read 0 here', () => setConfirm({ kind: 'temp', axes: ['x', 'y', 'z'] }), 'offset', true, tc ? TC_OFFSET_REASON : null),
        button('Clear', 'Clear the temporary offset (G92.1)', () => setConfirm({ kind: 'clear' }), 'offset', off.temporaryInForce, tc ? TC_OFFSET_REASON : null),
      ),
    ),
    off.temporaryInForce ? h('p', { class: 'fine', 'data-offsets': 'temporary' }, `G92 ${offsetLine(off.temporary)} · in force, not saved`) : null,
    confirmCard(),
    motionNote(ui, note ?? (enabled ? (view?.message?.snapshot.notices.change?.text ?? null) : null)),
  );
}

type ZeroProps = { readonly model?: WorkspaceModel | null; readonly ask?: { readonly axes: readonly MotionAxis[]; readonly at: number } | null; readonly goOnly?: boolean };

function ZeroLive(props: ZeroProps): ComponentChild {
  return zeroBody(props, LIVE_HOOKS);
}

export function ZeroSection(props: ZeroProps = {}): ComponentChild {
  return isLive(props.model) ? h(ZeroLive, props) : zeroBody(props, STATIC_HOOKS);
}

/**
 * Spindle and coolant (SAFETY §4.5b, H52). The readouts are what the board reports (edge-next `spe`, `spc`,
 * `spd`, `sps`, `cof`, `com`), from its status list or the GETs Run asks about once a second, labelled
 * commanded: TinyG measures nothing. Nothing that pauses or stops reads them. In a motion session the controls
 * send M3/M4 with S, M5, M7, M8 and M9; Spindle on asks C24 first unless the user turned that off for this page.
 */
function spindleBody({ model, compact = false }: SpindleProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const snapshot = view !== null && connected(view) ? view.message?.snapshot : undefined;
  const r = displayReadouts(snapshot);
  const spindle = spindleText(r);
  const spindleLine = snapshot === undefined ? 'Not connected' : spindle === UNKNOWN ? 'Unknown' : spindle;
  const coolant = coolantText(r);
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const [rpm, setRpm] = hk.state(10000);
  const [asking, setAsking] = hk.state<'cw' | 'ccw' | null>(null);
  const [skip, setSkip] = hk.state(false);
  const [note, setNote] = hk.state<string | null>(null);
  const on = ui.enabled && send !== undefined;
  // Spindle and coolant off are stop-class: offered whenever a motion session is connected, never gated.
  const off = send !== undefined && ui.flag && ui.connected;
  const run = (command: MotionCommand): void => {
    setNote(null);
    void send?.(command).then(setNote);
  };
  const start = (direction: 'cw' | 'ccw'): void => {
    if (spindleConfirmSkipped) run({ op: 'spindleOn', direction, rpm });
    else setAsking(direction);
  };
  const mist = r?.com === 1;
  const flood = r?.cof === 1;
  const coolantToggle = (which: 'mist' | 'flood', pressed: boolean): void => {
    if (!pressed) {
      run({ op: 'coolantOn', which });
      return;
    }
    // TinyG has one off command for both outputs (M9): turn the other one back on if it was on.
    run({ op: 'coolantOff' });
    const other = which === 'mist' ? flood : mist;
    if (other) run({ op: 'coolantOn', which: which === 'mist' ? 'flood' : 'mist' });
  };
  return h(
    'section',
    { class: `insp sec-spindle${compact ? ' compact' : ''}`, 'aria-labelledby': 'spindle-title' },
    h('header', null, h('h2', { id: 'spindle-title' }, 'Spindle and coolant'), h('span', { class: 'tag' }, 'Commanded')),
    compact ? null : h(
      'div',
      { class: 'spindle-state' },
      h('span', { class: `spindle-mark${spindle.startsWith('On') ? ' on' : ''}`, 'aria-hidden': 'true' }, Icon('spindle', 26)),
      h(
        'div',
        { class: 'spindle-text' },
        h('strong', { 'data-spindle': 'spindle', title: SPINDLE_TITLE }, spindleLine),
        h('small', { 'data-spindle': 'coolant', title: COOLANT_TITLE }, `Coolant: ${snapshot === undefined ? 'not connected' : coolant === UNKNOWN ? 'unknown' : coolant === 'Off' ? 'off' : coolant}`),
      ),
    ),
    h(
      'div',
      { class: 'spindle-controls', title: ui.reason ?? undefined },
      h(
        'div',
        { class: 'seg full', role: 'group', 'aria-label': 'Spindle direction' },
        h('button', { type: 'button', key: 'off', 'data-machine-control': 'spindle', ...(off ? { onClick: () => run({ op: 'spindleOff' }) } : { disabled: true }) }, 'Off'),
        h('button', { type: 'button', key: 'cw', 'data-machine-control': 'spindle', ...(on ? { onClick: () => start('cw') } : { disabled: true }) }, 'CW'),
        h('button', { type: 'button', key: 'ccw', 'data-machine-control': 'spindle', ...(on ? { onClick: () => start('ccw') } : { disabled: true }) }, 'CCW'),
      ),
      h(
        'label',
        { class: 'spindle-speed' },
        h('span', { class: 'sr-only' }, 'Speed'),
        h('input', {
          type: 'number',
          min: 1,
          max: 100000,
          step: 100,
          value: rpm,
          ...(on ? { onInput: (e: Event) => setRpm(Math.max(1, Math.round(Number((e.currentTarget as HTMLInputElement).value) || 1))) } : { disabled: true }),
          'aria-label': 'Spindle speed, rpm (commanded)',
          'data-machine-control': 'spindle',
        }),
        h('small', null, 'rpm'),
      ),
      asking === null || !on
        ? null
        : h(
            ConfirmCard,
            {
              text: c24({ direction: asking === 'cw' ? 'CW' : 'CCW', rpm }),
              confirm: 'Start spindle',
              safety: 'C24',
              onCancel: () => setAsking(null),
              onConfirm: () => {
                if (skip) spindleConfirmSkipped = true;
                const direction = asking;
                setAsking(null);
                run({ op: 'spindleOn', direction, rpm });
              },
            },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-action': 'skip-spindle-confirm', checked: skip, onChange: (e: Event) => setSkip((e.currentTarget as HTMLInputElement).checked) }), ' Don’t ask again until I reload this page'),
          ),
      h(
        'div',
        { class: 'inline-field' },
        h('span', null, 'Coolant'),
        h(
          'span',
          { class: 'toggles' },
          h('button', { type: 'button', class: 'toggle', 'aria-pressed': mist ? 'true' : 'false', 'data-machine-control': 'coolant', ...((mist ? off : on) ? { onClick: () => coolantToggle('mist', mist) } : { disabled: true }) }, 'Mist'),
          h('button', { type: 'button', class: 'toggle', 'aria-pressed': flood ? 'true' : 'false', 'data-machine-control': 'coolant', ...((flood ? off : on) ? { onClick: () => coolantToggle('flood', flood) } : { disabled: true }) }, 'Flood'),
        ),
      ),
    ),
    note === null ? null : h('p', { class: 'motion-note', role: 'status' }, note),
    compact ? null : h('div', { class: 'spindle-help', 'data-spindle': 'note' }, h(ContextHelp, { id: 'spindle-help', label: 'About spindle and coolant readouts', end: true }, SPINDLE_TITLE, ' ', COOLANT_TITLE)),
  );
}

type SpindleProps = { readonly model?: WorkspaceModel | null; readonly compact?: boolean };

function SpindleLive(props: SpindleProps): ComponentChild {
  return spindleBody(props, LIVE_HOOKS);
}

export function SpindleSection(props: SpindleProps = {}): ComponentChild {
  return isLive(props.model) ? h(SpindleLive, props) : spindleBody(props, STATIC_HOOKS);
}

export function OverridesSection(): ComponentChild {
  const row = (label: string, id: string): ComponentChild =>
    h(
      'div',
      { class: 'ovr', key: id },
      h('div', { class: 'ovr-head' }, h('span', null, label), h('output', null, '100 %')),
      h('div', { class: 'ovr-row' }, h('button', { type: 'button', class: 'small step', disabled: true, 'aria-label': `${label} minus 10 percent`, 'data-machine-control': 'override' }, '−10'), h('input', { type: 'range', min: 10, max: 200, value: 100, disabled: true, 'aria-label': `${label} override`, 'data-machine-control': 'override' }), h('button', { type: 'button', class: 'small step', disabled: true, 'aria-label': `${label} plus 10 percent`, 'data-machine-control': 'override' }, '+10')),
    );
  return h(
    'section',
    { class: 'insp sec-overrides', 'aria-labelledby': 'ovr-title' },
    h('header', null, h('h2', { id: 'ovr-title' }, 'Overrides'), h('span', { class: 'tag mock' }, 'Needs firmware support')),
    row('Feed', 'feed'),
    row('Spindle speed', 'spindle'),
    h('p', { class: 'fine' }, 'Overrides are unavailable on this firmware.'),
  );
}

type InspTab = 'jog' | 'home' | 'zero' | 'spindle';

/** The Run inspector: position always on top, the rest as tabs so nothing needs a long scroll. */
function RunInspector({ model, stops }: { readonly model: WorkspaceModel | null; readonly stops: StopHooks }): ComponentChild {
  const [tab, setTab] = useState<InspTab>('jog');
  const [ask, setAsk] = useState<{ readonly axes: readonly MotionAxis[]; readonly at: number } | null>(null);
  const simple = uiLevel.value.value !== 'advanced';
  // While a block holds, the Position panel's card says why and nothing that cannot work is drawn (owner, 2026-11-09):
  // no jog, home or offsets. The spindle shows only while it or the coolant may be on, for its Off (never gated).
  if (currentBlock(model) !== null) {
    return h(
      'aside',
      { class: `inspector run-inspector blocked${simple ? ' simple' : ''}`, 'aria-label': 'Machine', 'data-ui-level': simple ? 'simple' : 'advanced', 'data-blocked': 'true' },
      h(JobStopCard, { model, ...stops }),
      h(PositionPanel, { model }),
      outputsOff(model?.live.value ?? null) ? null : h('div', { class: simple ? 'simple-pane' : 'insp-pane' }, h(SpindleSection, { model, compact: simple })),
    );
  }
  if (simple) {
    // Simple (OD-13): one screen, no tabs. Position with Zero/Go, the jog pad, Home all / Set machine zero here, the spindle row.
    return h(
      'aside',
      { class: 'inspector run-inspector simple', 'aria-label': 'Machine', 'data-ui-level': 'simple' },
      h(JobStopCard, { model, ...stops }),
      h(PositionPanel, { model }),
      h('div', { class: 'simple-pane' }, h(JogSection, { model, onGoToZero: (axes) => setAsk({ axes, at: Date.now() }) }), h(HomeQuick, { model }), h(SpindleSection, { model, compact: true })),
      ask === null ? null : h(ZeroSection, { model, ask, goOnly: true }),
    );
  }
  return h(
    'aside',
    { class: 'inspector run-inspector', 'aria-label': 'Machine', 'data-ui-level': 'advanced' },
    h(JobStopCard, { model, ...stops, onZeroZ: () => setTab('zero') }),
    h(PositionPanel, { model }),
    h(
      'div',
      { class: 'insp-tabs' },
      h(TabBar<InspTab>, {
        label: 'Machine controls',
        prefix: 'insp',
        variant: 'underline',
        current: tab,
        onSelect: setTab,
        tabs: [
          { id: 'jog', label: 'Jog' },
          { id: 'home', label: 'Home' },
          { id: 'zero', label: 'Offsets' },
          { id: 'spindle', label: 'Spindle' },
        ],
      }),
    ),
    h(TabPane, { prefix: 'insp', id: 'spindle', current: tab, class: 'tpane insp-pane' }, h(SpindleSection, { model })),
    h(
      TabPane,
      { prefix: 'insp', id: 'jog', current: tab, class: 'tpane insp-pane' },
      h(JogSection, {
        model,
        onGoToZero: (axes) => {
          setAsk({ axes, at: Date.now() });
          setTab('zero');
        },
      }),
    ),
    h(TabPane, { prefix: 'insp', id: 'home', current: tab, class: 'tpane insp-pane' }, h(HomeSection, { model })),
    h(TabPane, { prefix: 'insp', id: 'zero', current: tab, class: 'tpane insp-pane' }, h(ZeroSection, { model, ask })),
  );
}

// ---------------------------------------------------------------- job card

const fmtMm = (n: number): string => String(Math.round(n * 100) / 100);

/** The job's checks as a compact list: icon, short label, value. Details sit behind the expander. */
function jobChecks(result: PreviewResult, facts: ReturnType<typeof fileFacts>): ComponentChild[] {
  const s = result.summary;
  const b = s.bounds;
  const routine = routineChanges(result);
  const counts = shownCounts(result);
  const changes = counts.change;
  const rows: ComponentChild[] = [
    s.blocked
      ? h(CheckRow, { key: 'v', tone: 'danger', label: `Blocked: ${num(Math.max(1, s.counts.block))} ${s.counts.block === 1 ? 'finding stops' : 'findings stop'} this file`, attr: 'verdict' })
      : h(CheckRow, { key: 'v', tone: 'ok', label: 'No blocking findings', attr: 'verdict' }),
  ];
  if (s.counts.warn > 0) rows.push(h(CheckRow, { key: 'w', tone: 'warn', label: `${num(s.counts.warn)} ${s.counts.warn === 1 ? 'warning' : 'warnings'}`, attr: 'warn' }));
  if (changes > 0) rows.push(h(CheckRow, { key: 'c', tone: 'warn', label: `${num(changes)} ${changes === 1 ? 'change' : 'changes'}`, attr: 'change' }));
  if (routine.total > 0) {
    const parts = [routine.comments > 0 ? 'comments removed' : null, routine.renumbered > 0 ? 'line numbers' : null, routine.empty > 0 ? 'empty lines' : null].filter((x): x is string => x !== null);
    rows.push(h('li', { key: 'n', class: 'check-row tone-info', 'data-check': 'routine', title: `Run's routine clean-up, not listed line by line: ${parts.join(', ')}` }, h('span', { class: 'check-icon' }, Icon('lines', 15)), h('span', { class: 'check-label' }, 'Clean-up by Run'), h('strong', { class: 'check-value' }, `${num(routine.total)} lines`)));
  }
  rows.push(h(CheckRow, { key: 'e', tone: 'info', icon: 'ruler', label: 'Extent', value: b === null ? 'nothing drawn' : `${fmtMm(b.max[0] - b.min[0])} × ${fmtMm(b.max[1] - b.min[1])} × ${fmtMm(b.max[2] - b.min[2])} mm`, attr: 'extent' }));
  rows.push(h(CheckRow, { key: 'l', tone: 'info', icon: 'lines', label: 'Lines', value: num(result.sourceLines.length), attr: 'lines' }));
  const tools = facts.tools.length === 0 ? 'none named' : facts.tools.map((t) => `T${t}`).join(', ');
  rows.push(h(CheckRow, { key: 't', tone: 'info', icon: 'tools', label: 'Tools', value: facts.spindle.length === 0 ? tools : `${tools} · ${facts.spindle.map((x) => num(x)).join(', ')} rpm`, attr: 'tools' }));
  return rows;
}

function JobDetails({ result, facts }: { readonly result: PreviewResult; readonly facts: ReturnType<typeof fileFacts> }): ComponentChild {
  const s = result.summary;
  const b = s.bounds;
  return h(
    'div',
    { class: 'job-details' },
    facts.operations.length === 0
      ? null
      : h(
          'section',
          null,
          h('h3', null, 'Operations'),
          h('ol', { class: 'job-ops' }, facts.operations.slice(0, 8).map((op, i) => h('li', { key: String(op.line) }, h('span', { class: `op-swatch op-${i < 3 ? i + 1 : 4}`, 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'name' }, op.name, h('small', null, `from line ${num(op.line)}`))))),
        ),
    h(
      'section',
      null,
      h('h3', null, 'The check'),
      h(
        'dl',
        { class: 'job-facts', 'data-preview': 'summary-detail' },
        h('dt', null, 'Findings'),
        h('dd', null, `${num(s.counts.block)} block, ${num(s.counts.warn)} warn, ${num(s.counts.change)} change, ${num(s.counts.info)} info`),
        h('dt', null, 'Lines'),
        h('dd', null, `${num(result.fileLines)} in the file, ${num(result.sourceLines.length)} to send`),
        h('dt', null, 'Extent'),
        h('dd', null, b === null ? 'nothing drawn' : `X ${fmtMm(b.min[0])} to ${fmtMm(b.max[0])}, Y ${fmtMm(b.min[1])} to ${fmtMm(b.max[1])}, Z ${fmtMm(b.min[2])} to ${fmtMm(b.max[2])} mm`),
        h('dt', null, 'Distance'),
        h('dd', null, `${fmtMm(s.stats.feedMm)} mm cutting, ${fmtMm(s.stats.rapidMm)} mm traverse, ${num(s.stats.arcs)} arcs`),
        h('dt', null, 'Envelope'),
        h('dd', null, 'From the board’s travel settings, once a board is connected.'),
        h('dt', null, 'Start'),
        h('dd', null, 'Assumed machine at 0, 0, 0 in G54 with zero offsets, G21 G90 G17.'),
        h('dt', null, 'Time'),
        h('dd', null, 'Available after checking with the connected board.'),
      ),
      fileLevel(s.fileLevel),
    ),
  );
}

/** The job's identity under the title: its name, project, machine and bed, and Save to project for the draft. */
function JobIdentity({ job, fileOpen, onNote }: { readonly job: Job | null; readonly fileOpen: boolean; readonly onNote: (n: string | null) => void }): ComponentChild {
  const projects = projectsState.value;
  const [target, setTarget] = useState('');
  useEffect(() => {
    if (job?.projectId === null && !projects.loaded) void projectStore();
  }, [job?.projectId, projects.loaded]);
  if (job === null) return null;
  const project = job.projectId === null ? null : (projects.list.find((p) => p.id === job.projectId) ?? null);
  const bed = job.setup.bed;
  const advanced = uiLevel.value.value === 'advanced';
  return h(
    'p',
    { class: 'job-identity', 'data-job': 'identity' },
    h('span', { 'data-job': 'name' }, job.name),
    ' · ',
    job.projectId === null ? h('span', { 'data-job': 'project' }, 'local draft') : h('span', { 'data-job': 'project' }, project === null ? 'project' : project.name),
    ' · ',
    h('span', { 'data-job': 'machine' }, job.machine === null ? 'no machine' : machineText(job.machine.name, job.machine.revision, advanced)),
    ' · ',
    h('span', { 'data-job': 'bed', 'data-bed': bed.source.kind }, `bed ${bedSizeText(bed)}${advanced && bed.source.kind !== 'placeholder' && job.setup.bedFrom === 'machine' ? `, revision ${bed.revision}` : ''}`),
    ' · ',
    h('span', { 'data-job': 'state' }, jobStateText(job.revision, jobSaved.value, advanced)),
    job.projectId !== null || !fileOpen
      ? null
      : h(
          'span',
          { class: 'job-save', 'data-job': 'save' },
          h(
            'select',
            { 'aria-label': 'Project to save the draft to', value: target, 'data-job': 'save-target', onChange: (e: Event) => setTarget((e.currentTarget as HTMLSelectElement).value) },
            h('option', { value: '' }, projects.list.length === 0 ? 'No projects yet' : 'Choose a project'),
            projects.list.map((p) => h('option', { key: p.id, value: p.id }, p.name)),
          ),
          h('button', { type: 'button', class: 'small', 'data-action': 'job-save-to-project', disabled: target === '', onClick: () => void saveDraftToProject(target).then((r) => onNote(r.ok ? `Saved to the project as “${r.job.name}”.` : r.reason)) }, 'Save to project'),
        ),
  );
}

/** The job: a card at the top of the Run view with the file, its checks, and the Check → Set zero → Start steps. */
function JobCard({ parts, model, onView, onFiles }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly onView: (view: string) => void; readonly onFiles: () => void }): ComponentChild {
  const { state, actions } = parts;
  const loading = state.status === 'loading';
  const disabled = !state.ready || loading || jobUi(model?.live.value ?? null).active;
  const result = state.status === 'ready' ? state.result : null;
  const title = state.fileName === null ? 'No file open' : state.fileName.replace(/\.[^.]+$/, '');
  const [note, setNote] = useState<string | null>(null);
  return h(
    'section',
    { class: `job-card${result === null ? ' empty' : ''}`, 'data-region': 'job', 'aria-labelledby': 'run-title' },
    h(
      'div',
      { class: 'job-id' },
      h('span', { class: 'job-icon', 'aria-hidden': 'true' }, Icon('file', 22)),
      h(
        'div',
        { class: 'job-name' },
        h('h1', { id: 'run-title' }, title),
        h(
          'p',
          null,
          h('span', { class: state.fileName === null ? 'sr-only' : 'mono', 'data-preview': 'file-name' }, state.fileName ?? 'none'),
          state.fileName === null ? (loading ? 'Checking the file…' : reopening.value || pendingOpen.value !== null ? 'Opening the file…' : 'Open a G-code file or a sample to check it.') : result === null ? (loading ? ' · checking…' : '') : ` · ${num(result.fileLines)} lines`,
        ),
        h(JobIdentity, { job: activeJob.value, fileOpen: result !== null, onNote: setNote }),
        note === null ? null : h('p', { class: 'fine tone-warn', role: 'status', 'data-job': 'note' }, note),
      ),
    ),
    h(
      'div',
      { class: 'job-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'job-files', onClick: onFiles }, 'Files'),
      h('button', { type: 'button', class: 'small', 'data-action': 'job-projects', onClick: () => onView('projects') }, 'Open project'),
      state.fileName === null ? null : h('button', { type: 'button', class: 'small', 'data-action': 'job-close', disabled: jobUi(model?.live.value ?? null).active || actions.onCancel === undefined, onClick: () => {
        const result = closeJob();
        if (!result.ok) { setNote(result.reason); return; }
        actions.onCancel?.();
        setNote(null);
        jobStep.value = 'machine';
      } }, 'Close job'),
      executionLock.value === null ? null : h(ContextHelp, { id: 'job-file-lock-help', label: 'Why closing or replacing the job is unavailable' }, `${executionLock.value} Stop the current job before closing it or opening another file.`),
      h(
        'label',
        { class: `file-button${disabled ? ' is-disabled' : ''}` },
        h('input', {
          type: 'file',
          accept: '.nc,.gcode,.ngc,.tap,.txt,.cnc,text/plain',
          disabled,
          'data-preview': 'file',
          ...on('onChange', actions.onFile, () => (e: Event) => {
            const input = e.currentTarget as HTMLInputElement;
            const file = input.files?.[0];
            if (file !== undefined) openFrom(file, { kind: 'picker' }, setNote);
            input.value = '';
          }),
        }),
        Icon('upload', 15),
        result === null ? 'Open a file' : 'Open another',
      ),
    ),

  );
}

/** Traverses (G0) on or off: a toolbar toggle, remembered in this browser. */
function TraverseToggle({ parts }: { readonly parts: PreviewParts }): ComponentChild {
  const { state, actions } = parts;
  const onRapids = actions.onRapids;
  useEffect(() => {
    const stored = readStored('preview-traverses', (v: unknown): v is boolean => typeof v === 'boolean');
    if (stored !== null && stored !== state.showRapids) onRapids?.(stored);
    // Once, when the actions arrive.
  }, [onRapids === undefined]);
  return h(
    'button',
    {
      type: 'button',
      class: 'tool-toggle',
      'aria-pressed': state.showRapids ? 'true' : 'false',
      disabled: !state.ready,
      'data-preview': 'rapids',
      title: state.showRapids ? 'Hide traverses (G0 moves)' : 'Show traverses (G0 moves)',
      ...on('onClick', onRapids, (f) => () => {
        const next = !state.showRapids;
        writeStored('preview-traverses', next);
        f(next);
      }),
    },
    h('span', { class: 'toggle-dash', 'aria-hidden': 'true' }),
    'Traverses',
  );
}

function stepStatus(step: typeof JOB_STEPS[number]['id'], parts: PreviewParts, model: WorkspaceModel | null): string {
  const job = activeJob.value;
  const result = parts.state.status === 'ready' ? parts.state.result : null;
  const ui = jobUi(model?.live.value ?? null);
  switch (step) {
    case 'machine': return job?.machine?.name ?? 'Choose machine';
    case 'stock': return job === null ? 'Define stock' : `${job.setup.stock.width} × ${job.setup.stock.depth} × ${job.setup.stock.thickness} mm`;
    case 'place': return job === null ? 'Choose datum' : `${job.placement.datum.corner.replaceAll('-', ' ')} · ${job.placement.datum.height}`;
    case 'check': return result === null ? 'Open a file' : result.summary.blocked ? 'Blocked' : result.summary.counts.warn > 0 ? 'Review findings' : 'File checked';
    case 'run': return ui.active ? PHASE_LABEL(ui.job?.phase ?? 'running') : ui.connected ? 'Review & start' : 'Connect machine';
  }
}

function JobWorkPanel({ parts, model, stops, onView }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly stops: StopHooks; readonly onView: (view: string) => void }): ComponentChild {
  const step = jobStep.value;
  const result = parts.state.status === 'ready' ? parts.state.result : null;
  const facts = useMemo(() => result === null ? null : fileFacts(result.bytes), [result]);
  const ui = jobUi(model?.live.value ?? null);
  const index = JOB_STEPS.findIndex((s) => s.id === step);
  return h('aside', { class: 'job-work-panel', id: 'job-work-panel', 'aria-label': 'Job preparation' },
    h('div', { class: 'job-panel-scroll', tabindex: 0 },
      h(JobSetupPanel, { step, locked: ui.active, onView, travel: placeTravelText({ connected: ui.connected, homed: ui.snapshot?.live.home === 1, travel: ui.job?.report?.travel }) }),
      h('section', { hidden: step !== 'check', 'data-job-panel': 'check' }, h('h2', null, 'Check file'),
        result === null || facts === null ? h('p', null, 'Open G-code to check it.') : [
          h('ul', { class: 'job-checks', 'data-preview': 'summary', 'aria-label': 'The file check' }, jobChecks(result, facts)),
          h('details', null, h('summary', null, 'File details'), h(JobDetails, { result, facts })),
        ],
        h('button', { type: 'button', class: 'small', 'data-action': 'advisor-open', onClick: () => onView('analyze') }, 'Analyze feeds & speeds'),
        h('p', { class: 'fine' }, ui.connected ? 'Review the live board check in Run.' : 'Connect for the live board check.')),
      h('section', { hidden: step !== 'run', 'data-job-panel': 'run' }, h('h2', null, 'Run job'),
        h(JobSteps, { parts, model, onAnalyze: () => onView('analyze') }),
        h(JobStatus, { model, ...stops }))),
    h('div', { class: 'job-step-actions' },
      index === 0 ? null : h('button', { type: 'button', class: 'small', 'data-action': 'job-step-back', onClick: () => { jobStep.value = JOB_STEPS[index - 1]?.id ?? 'machine'; } }, 'Back'),
      index === JOB_STEPS.length - 1 ? null : h('button', { type: 'button', class: 'small primary', 'data-action': 'job-step-next', onClick: () => { jobStep.value = JOB_STEPS[index + 1]?.id ?? 'run'; } }, `Next: ${JOB_STEPS[index + 1]?.label ?? 'Run'}`)));
}

// ---------------------------------------------------------------- layout

function runLayout(parts: PreviewParts, model: WorkspaceModel | null, onView: (view: string) => void, stops: StopHooks = {}): ComponentChild {
  return h(RunLayout, { parts, model, onView, stops });
}

function RunLayout({ parts, model, onView, stops }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly onView: (view: string) => void; readonly stops: StopHooks }): ComponentChild {
  const { state, actions, slots, live, scene } = parts;
  const simple = uiLevel.value.value !== 'advanced';
  const [preset, setPreset] = useState<ViewPreset>('iso');
  const [files, setFiles] = useState(false);
  const step = jobStep.value;
  const active = jobUi(model?.live.value ?? null).active;
  useEffect(() => { if (active) jobStep.value = 'run'; }, [active]);
  const loading = state.status === 'loading';
  const disabled = !state.ready || loading || jobUi(model?.live.value ?? null).active;
  const result = state.status === 'ready' ? state.result : null;
  const sent = result?.sourceLines.length ?? 0;
  const scrubLine = state.scrub > 0 && result !== null ? (result.sourceLines[state.scrub - 1] ?? 0) : 0;
  return h(
    'div',
    { class: 'run-view job-view', 'data-region': 'preview', 'data-job-stage': step, 'data-preview-expanded': previewExpanded.value ? 'true' : 'false' },
    h(RunBridge, { parts }),
    // The machine pane is a rail beside everything (OD-13 §3): it gets the view's full height, so it fits 720 px without scrolling.
    h(
      'div',
      { class: 'job-main' },
    h(JobCard, { parts, model, onView, onFiles: () => setFiles(!files) }),
    h('nav', { class: 'job-step-bar', 'aria-label': 'Job steps' }, JOB_STEPS.map((item, i) => h('button', { type: 'button', key: item.id, 'data-action': `job-step-${item.id}`, 'data-job-step': item.id, 'aria-current': step === item.id ? 'step' : undefined, 'aria-controls': 'job-work-panel', onClick: () => { jobStep.value = item.id; } }, h('span', { class: 'step-number' }, String(i + 1)), h('span', null, h('strong', null, item.label), h('small', null, stepStatus(item.id, parts, model)))))),
    h('div', { class: 'job-files-drawer', hidden: !files, 'aria-label': 'Job files' }, files ? h(JobFiles, { onView: (view) => { if (view === 'job') setFiles(false); onView(view); } }) : null, h('button', { type: 'button', class: 'small', 'data-action': 'job-files-close', onClick: () => setFiles(false) }, 'Close files')),
    h(
      'div',
      { class: 'workspace-grid run-grid job-grid' },
      h(JobWorkPanel, { parts, model, stops, onView }),
      h(
        'div',
        { class: 'canvas-column' },
        h(
          'div',
          { class: 'viewer', ...(result === null ? {} : { 'data-lite': result.lite ? 'true' : 'false' }) },
          (scene !== null || result !== null) && !result?.lite ? h('div', { class: 'preview-drawing', 'data-preview': 'drawing', 'data-drawing': state.drawing, 'data-tool': parts.toolInPath?.map((v) => v.toFixed(3)).join(' ') }, slots.drawing ?? null) : null,
          h(
            'div',
            { class: 'viewer-top' },
            // How the file is read and drawn: Advanced only (Simple keeps the defaults, Auto included), in plain words.
            simple ? null : h(ViewerOptions, { parts, disabled }),
            h(
              'div',
              { class: 'viewer-tools', role: 'group', 'aria-label': 'View' },
              h(TraverseToggle, { parts }),
              h(ExpandButton, null),
              (scene !== null || result !== null) && !result?.lite && state.drawing === 'webgl' ? h(ViewButtons, { current: preset, ...(actions.onView === undefined ? {} : { onView: (p: ViewPreset) => { setPreset(p); actions.onView?.(p); } }), ...(actions.onFit === undefined ? {} : { onFit: () => actions.onFit?.() }) }) : null,
            ),
          ),
          // The key and the live readout, stacked in one overlay that never runs over itself (B4, C18).
          h(ViewerOverlay, {
            // Play preview's notice stays in view for the whole session (OD-25).
            notice: h(PlayNotice, { play: parts.play }),
            sceneKey: (scene === null && parts.tool === null) || result?.lite ? null : { scene, tool: parts.tool, markerPreview: parts.markerPreview, carve: parts.carve, simple, tools: parts.tools, ...(active ? {} : { onOpen: (part: ScenePart) => openSceneSettings(part, onView), onAddTool: (n: number) => { openToolNumber(n); onView('tools'); } }) },
            // With no file open, the prompt to open one leads the stack, so the key never covers its buttons. While the
            // job's file is being reopened after a reload (or a chosen file waits for the preview), it says so instead of
            // offering the samples for a moment.
            prompt: result === null && !loading && (reopening.value || pendingOpen.value !== null)
              ? h('div', { class: `empty-prompt${scene === null ? '' : ' scene-empty-prompt'}`, 'data-preview': 'reopening' }, h('h2', null, 'Opening the file…'))
              : result === null && !loading
              ? h(
                  'div',
                  { class: `empty-prompt${scene === null ? '' : ' scene-empty-prompt'}` },
                  h('h2', null, state.status === 'error' ? 'The file could not be checked' : 'Open a file to check and preview it'),
                  state.status === 'error'
                    ? h('p', { class: 'preview-error', role: 'alert', 'data-preview': 'error' }, state.error ?? 'The preview failed.')
                    : null,
                  h('div', { class: 'sample-row' }, SAMPLES.map((s) => h('button', { type: 'button', class: 'small', key: s.id, disabled, 'data-sample': s.id, ...on('onClick', actions.onFile, () => () => { openFrom(sampleFile(s), { kind: 'sample' }, () => undefined); }) }, `Open the ${s.title.toLowerCase()} sample`))),
                )
              : null,
            readout: live === null ? null : h('p', { class: `viewer-key pv-marker-readout lag-${live.lag}`, 'data-preview': 'marker-readout', role: 'status' }, markerText(live)),
          }),
          loading
            ? h(
                'div',
                { class: 'empty-prompt preview-progress', role: 'status', 'data-preview': 'progress' },
                h('h2', null, progressText(state.progress)),
                h('button', { type: 'button', class: 'small', 'data-preview': 'cancel', ...on('onClick', actions.onCancel, (f) => () => { f(); }) }, 'Cancel'),
              )
            : null,
          result !== null && result.lite
            ? h(
                'p',
                { class: 'empty-prompt preview-lite', 'data-preview': 'lite' },
                result.liteBySize
                  ? `Lite mode: this file has more than ${LITE_THRESHOLD_LINES.toLocaleString('en-US')} lines, so it is not drawn. Choose Full to draw it anyway.`
                  : 'Lite mode: the list and summary only, no drawing.',
              )
            : null,
          h('div', { class: 'viewer-notice viewer-help' }, h(ContextHelp, { id: 'run-preview-help', label: 'About the preview', safety: 'W13', end: true }, w13())),
        ),
        h(
          'div',
          { class: 'timeline', 'aria-label': 'Line scrubber' },
          h(PlayControls, { play: parts.play }),
          h(
            'div',
            { class: 'track-wrap' },
            h('label', { class: 'sr-only', for: 'preview-scrub' }, 'Highlight lines up to'),
            h('input', {
              id: 'preview-scrub',
              type: 'range',
              min: 0,
              max: sent,
              step: 1,
              value: state.scrub,
              disabled: result === null,
              'data-preview': 'scrubber',
              'aria-valuetext': state.scrub === 0 ? 'no lines highlighted' : `highlighting up to file line ${String(scrubLine)}`,
              ...on('onInput', actions.onScrub, (f) => (e: Event) => { f(Number((e.currentTarget as HTMLInputElement).value)); }),
            }),
          ),
          h('output', { class: 'time', for: 'preview-scrub', 'data-preview': 'scrub-line' }, state.scrub === 0 ? 'none' : `file line ${String(scrubLine)}`),
        ),
        h(Dock, { parts, model }),
      ),
    ),
    ),
    h(RunInspector, { model, stops }),
  );
}
