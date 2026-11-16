import { openFrom } from './openRunFile.ts';

import { OverrideControls } from './OverrideControls.ts';


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

import { c24, w13 } from '@synthetos/safety';

import { DIALECTS } from '@synthetos/protocol';

import type { WorkerLike } from '../../gcode-worker/client.ts';

import { scrubRequest } from '../analysisState.ts';

import { analysisDialect } from '../../preview/analysisDialect.ts';

import { PreviewPanel, type LiveMarkerView, type PreviewParts } from '../../preview/PreviewPanel.ts';

import { fileLevel, on, progressText } from '../../preview/PreviewView.ts';

import type { PreviewResult } from '../../gcode-worker/pipeline.ts';

import { routineChanges, shownCounts } from '../../preview/gcodeList.ts';




import { Icon } from '../icons.ts';

import { readStored, writeStored } from '../storage.ts';

import { CheckRow, ConfirmCard, TabBar, TabPane } from '../ui.ts';

import { connected, type WorkspaceModel } from '../model.ts';




import { motionUi } from '../motion.ts';

import { HomeQuick, HomeSection } from '../homing.ts';




import { currentBlock } from '../ControlBlockCard.ts';

import { outputsOff } from '../controlBlock.ts';


import { skipSpindleConfirm, spindleConfirmSkipped } from '../spindleConfirm.ts';

import type { MotionAxis, MotionCommand } from '../../machine-worker/rpc.ts';

import { ContextHelp } from '../../shell/ContextHelp.ts';

import { fileFacts, sampleFile, SAMPLES } from '../samples.ts';

import { openReport } from '../../report/state.ts';

import { closeJob, currentFile, executionLock, pendingOpen, reopening, saveDraftToProject } from '../fileBridge.ts';

import { activeJob, effectiveZero, jobSaved, type Job } from '../jobModel.ts';

import { useLiveWorkZero } from '../liveZero.ts';

import { useAutoZero } from '../useAutoZero.ts';

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

import { AnalysisWarning, ViewerOptions } from '../../preview/ViewerOptions.ts';

import { ExpandButton, previewExpanded } from '../../preview/expandPreview.ts';

import { openSceneSettings, type ScenePart } from '../../preview/sceneSettings.ts';

import { sceneColors, tokenReader } from '../../preview/colors.ts';

import { ViewButtons } from '../../preview/SceneView.ts';

import type { CarveWorkerLike, ViewPreset } from '@synthetos/gcode-view';

import { COOLANT_TITLE, coolantText, displayReadouts, num, SPINDLE_TITLE, spindleText, UNKNOWN } from '../status.ts';

import { feedDiagnosis, jobUi, PHASE_TEXT, plannerRanges, starving } from '../jobUi.ts';

import { spinDirection } from '../../preview/spinDirection.ts';

import { JobStatus, JobStopCard, type StopHooks } from './JobViews.ts';

import { RunPanel } from '../run/RunPanel.ts';

import { JOB_STEPS, jobStep, uiLevel } from '../jobWorkflow.ts';

import { JobSetupPanel } from './SetupView.ts';

import { JobFiles } from '../../projects/ProjectsView.ts';

import { Dock } from '../dock/Dock.ts';


import { MachineInsight } from '../insight/MachineInsight.ts';

import { ToolMismatchNotes } from '../ToolMismatchNotes.ts';

import type { FileTool } from '../../gcode-worker/camTools.ts';
import { RunBridge } from './run/bridge.ts';
import { JogSection } from './run/jog.ts';
import { isLive, LIVE_HOOKS, STATIC_HOOKS, type Hooks } from './run/motionHooks.ts';
import { ZeroSection } from './run/offsets.ts';
import { PositionPanel } from './run/position.ts';


// ---------------------------------------------------------------- inspector: motion (Phase 2)

// The page's own "don't ask again" for C24 lives in spindleConfirm.ts (shared with the terminal, H91).
export { resetSpindleConfirm } from '../spindleConfirm.ts';
export { ConnectNotice } from './run/connect.ts';
export { JogSection } from './run/jog.ts';
export { ZeroSection } from './run/offsets.ts';
export { PositionPanel } from './run/position.ts';



const PHASE_LABEL = (phase: string): string => PHASE_TEXT[phase] ?? phase;


/** No file, no described tools (one array, so the note's memo holds). */
const NO_FILE_TOOLS: readonly FileTool[] = Object.freeze([]);


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
  // The live machine (preview/livePlacement.ts): the job placed where the board is once its position is established, its work position mapped into the path's frame at the line it reports (pathFrame.ts).
  const snap = live !== null && connected(live) ? (live.message?.snapshot ?? null) : null;
  // The board's work zero while the position is established (OD-28): a job that uses it is planned there.
  const liveZero = useLiveWorkZero(snap === null ? null : { ...snap.live, overlays: snap.overlays });
  const zeroAt = active === null ? null : effectiveZero(active, liveZero);
  const planned = useMemo(() => (active === null || zeroAt === null ? null : jobScene(active, sceneColors(tokenReader()), materialColor(active.setup.stock.materialRef.id), zeroAt)), [active, zeroAt?.x, zeroAt?.y, zeroAt?.z]);
  useAutoZero(active);
  const { scene, tool } = useLivePlacement(planned, snap === null ? null : { ...snap.live, overlays: snap.overlays }, useLivePathFrame(currentFile.value?.preview ?? null, ui.job));
  return h(PreviewPanel, {
    analysisDialect: analysisDialect(ui.connected, ui.snapshot?.classification?.dialectId).dialect,
    analysisLocked: ui.active,
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
    // The spindle spins the bit in the drawing (owner, 2026-11-10), the way the board reports it turning.
    spin: spinDirection(snap?.live),
    // Play preview (OD-25): never while this tab's job runs or the board moves.
    playAllowed: playAllowedFor(ui.active, snap === null ? null : { base: snap.base, overlays: snap.overlays }),
    ...(playRapidOf(selectedMachine.value) === undefined ? {} : { playRapid: playRapidOf(selectedMachine.value) as number }),
    // Opening a part's settings is navigation only; not while a job owns the machine.
    ...(ui.active ? {} : { onScenePick: (part: ScenePart) => openSceneSettings(part, onView) }),
    layout: (parts: PreviewParts) => runLayout(parts, model, onView, stops),
    scrubTo: scrubRequest,
  });
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
    if (spindleConfirmSkipped()) run({ op: 'spindleOn', direction, rpm });
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
                if (skip) skipSpindleConfirm();
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
        h('span', { class: 'coolant-label' }, 'Coolant', h(ContextHelp, { id: 'spindle-help', label: 'About spindle and coolant readouts', end: true }, SPINDLE_TITLE, ' ', COOLANT_TITLE)),
        h(
          'span',
          { class: 'seg', role: 'group', 'aria-label': 'Coolant' },
          h('button', { type: 'button', class: mist ? 'selected' : undefined, 'aria-pressed': mist ? 'true' : 'false', 'data-machine-control': 'coolant', ...((mist ? off : on) ? { onClick: () => coolantToggle('mist', mist) } : { disabled: true }) }, 'Mist'),
          h('button', { type: 'button', class: flood ? 'selected' : undefined, 'aria-pressed': flood ? 'true' : 'false', 'data-machine-control': 'coolant', ...((flood ? off : on) ? { onClick: () => coolantToggle('flood', flood) } : { disabled: true }) }, 'Flood'),
        ),
      ),
    ),
    note === null ? null : h('p', { class: 'motion-note', role: 'status' }, note),
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
function RunInspector({ model, stops, fileTool = null }: { readonly model: WorkspaceModel | null; readonly stops: StopHooks; readonly fileTool?: number | null }): ComponentChild {
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
    // Advanced only (owner, 2026-11-09): the planner and the cutting numbers, read only, under the controls.
    h(MachineInsight, { model, fileTool }),
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
    case 'place': return job === null ? 'Choose datum' : job.placement.zeroFrom === 'machine' ? 'machine’s work zero' : `${job.placement.datum.corner.replaceAll('-', ' ')} · ${job.placement.datum.height}`;
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
    // The Run step is a column (owner, 2026-11-09): its list on top, the one tick and Start fixed under it, never scrolled away.
    h('div', { class: `job-panel-scroll${step === 'run' && !ui.active ? ' run-mode' : ''}`, tabindex: 0 },
      h(JobSetupPanel, { step, locked: ui.active, onView, travel: placeTravelText({ connected: ui.connected, homed: ui.snapshot?.live.home === 1, travel: ui.job?.report?.travel }) }),
      h('section', { hidden: step !== 'check', 'data-job-panel': 'check' }, h('h2', null, 'Check file'),
        h(AnalysisWarning, { connected: ui.connected, dialect: ui.snapshot?.classification?.dialectId }),
        result === null || facts === null ? h('p', null, 'Open G-code to check it.') : [
          h('ul', { class: 'job-checks', 'data-preview': 'summary', 'aria-label': 'The file check' }, jobChecks(result, facts)),
          h('details', null, h('summary', null, 'File details'), h(JobDetails, { result, facts })),
        ],
        h('button', { type: 'button', class: 'small', 'data-action': 'advisor-open', onClick: () => onView('analyze') }, 'Analyze feeds & speeds'),
        h('p', { class: 'fine' }, ui.connected ? 'Review the live board check in Run.' : 'Connect for the live board check.')),
      h('section', { hidden: step !== 'run', 'data-job-panel': 'run' }, h('h2', null, ui.active ? 'Run job' : 'Ready to start?'),
        h(RunPanel, { parts, model, onAnalyze: () => onView('analyze') }),
        h(JobStatus, { model, ...stops }))),
    // On the Run step its own footer carries Back beside Start (RunPanel.ts), so nothing pushes Start out of view.
    step === 'run' && !ui.active ? null : h('div', { class: 'job-step-actions' },
      index === 0 ? null : h('button', { type: 'button', class: 'small', 'data-action': 'job-step-back', onClick: () => { jobStep.value = JOB_STEPS[index - 1]?.id ?? 'machine'; } }, 'Back'),
      index === JOB_STEPS.length - 1 ? null : h('button', { type: 'button', class: 'small primary', 'data-action': 'job-step-next', onClick: () => { jobStep.value = JOB_STEPS[index + 1]?.id ?? 'run'; } }, `Next: ${JOB_STEPS[index + 1]?.label ?? 'Run'}`)));
}


// ---------------------------------------------------------------- layout

function runLayout(parts: PreviewParts, model: WorkspaceModel | null, onView: (view: string) => void, stops: StopHooks = {}): ComponentChild {
  return h(RunLayout, { parts, model, onView, stops });
}


function RunLayout({ parts, model, onView, stops }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly onView: (view: string) => void; readonly stops: StopHooks }): ComponentChild {
  const { state, actions, slots, scene } = parts;
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
    // The file's tools against the tool table (tool-mismatch): a note, its actions and their confirmation.
    h(ToolMismatchNotes, { fileTools: result?.fileTools ?? NO_FILE_TOOLS, onView }),
    // The machine pane is a rail beside everything (OD-13 §3): it gets the view's full height, so it fits 720 px without scrolling.
    h(
      'div',
      { class: 'job-main' },
    h('div', null, h(JobCard, { parts, model, onView, onFiles: () => setFiles(!files) }), h(OverrideControls, { model })),
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
          // The viewer's bar (settings menu, position chip, notes) and the legend; the live position is in the Position panel.
          h(ViewerOverlay, {
            // Play preview's notice stays in view for the whole session (OD-25).
            notice: h(PlayNotice, { play: parts.play }),
            sceneKey: (scene === null && parts.tool === null) || result?.lite ? null : { scene, tool: parts.tool, markerPreview: parts.markerPreview, carve: parts.carve, simple, tools: parts.tools, planner: parts.planner !== null, starved: parts.starved, feedDiagnosis: jobUi(model?.live.value ?? null).job?.phase === 'running' ? feedDiagnosis(jobUi(model?.live.value ?? null).job?.feedLimit ?? null) : null, spin: parts.spin, ...(active ? {} : { onOpen: (part: ScenePart) => openSceneSettings(part, onView), onAddTool: (n: number) => { openToolNumber(n); onView('tools'); } }) },
            // With no file open, the prompt to open one leads the stack, so the key never covers its buttons. While the
            // job's file is being reopened after a reload (or a chosen file waits for the preview), it says so instead of
            // offering the samples for a moment.
            prompt: result === null && !loading && (reopening.value || pendingOpen.value !== null)
              ? h('div', { class: `empty-prompt${scene === null ? '' : ' scene-empty-prompt'}`, 'data-preview': 'reopening' }, h('h2', null, 'Opening the file…'))
              : result === null && !loading && state.status !== 'error' && (step === 'machine' || step === 'stock')
              ? h('button', { type: 'button', class: 'small viewer-step-chip', 'data-action': 'job-step-place', onClick: () => { jobStep.value = 'place'; } }, 'Step 3 opens your file.')
              : result === null && !loading
              ? h(
                  'div',
                  { class: `empty-prompt${scene === null ? '' : ' scene-empty-prompt'}` },
                  h('h2', null, state.status === 'error' ? 'The file could not be checked' : 'Open a file to check and preview it'),
                  h('button', { type: 'button', class: 'primary', disabled, 'data-action': 'job-open-file', onClick: () => document.querySelector<HTMLInputElement>('[data-preview="file"]')?.click() }, 'Open a file'),
                  state.status === 'error'
                    ? h('p', { class: 'preview-error', role: 'alert', 'data-preview': 'error' }, state.error ?? 'The preview failed.')
                    : null,
                  h('div', { class: 'sample-row' }, SAMPLES.map((s) => h('button', { type: 'button', class: 'small', key: s.id, disabled, 'data-sample': s.id, ...on('onClick', actions.onFile, () => () => { openFrom(sampleFile(s), { kind: 'sample' }, () => undefined); }) }, `Open the ${s.title.toLowerCase()} sample`))),
                )
              : null,
          }),
          loading
            ? h(
                'div',
                { class: 'empty-prompt preview-progress', role: 'status', 'data-preview': 'progress' },
                h('h2', null, progressText(state.progress)),
                h('button', { type: 'button', class: 'small', 'data-preview': 'cancel', ...on('onClick', actions.onCancel, (f) => () => { f(); }) }, 'Cancel'),
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
        h(Dock, { parts, model, stops }),
      ),
    ),
    ),
    h(RunInspector, { model, stops, fileTool: parts.tool?.number ?? null }),
  );
}
