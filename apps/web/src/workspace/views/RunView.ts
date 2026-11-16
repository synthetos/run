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

import { w13 } from '@synthetos/safety';

import { DIALECTS } from '@synthetos/protocol';

import type { WorkerLike } from '../../gcode-worker/client.ts';

import { scrubRequest } from '../analysisState.ts';

import { analysisDialect } from '../../preview/analysisDialect.ts';

import { PreviewPanel, type LiveMarkerView, type PreviewParts } from '../../preview/PreviewPanel.ts';

import { on, progressText } from '../../preview/PreviewView.ts';









import { connected, type WorkspaceModel } from '../model.ts';














import { ContextHelp } from '../../shell/ContextHelp.ts';

import { sampleFile, SAMPLES } from '../samples.ts';

import { openReport } from '../../report/state.ts';

import { currentFile, executionLock, pendingOpen, reopening } from '../fileBridge.ts';

import { activeJob, effectiveZero } from '../jobModel.ts';

import { useLiveWorkZero } from '../liveZero.ts';

import { useAutoZero } from '../useAutoZero.ts';


import { materialColor, selectedMachine } from '../library.ts';

import { PlayControls, PlayNotice } from '../../preview/PlayControls.ts';


import { playAllowedFor, playRapidOf } from '../../preview/playAllowed.ts';

import { openToolNumber } from '../toolNumbers.ts';



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


import { feedDiagnosis, jobUi, plannerRanges, starving } from '../jobUi.ts';

import { spinDirection } from '../../preview/spinDirection.ts';

import { type StopHooks } from './JobViews.ts';


import { JOB_STEPS, jobStep, uiLevel } from '../jobWorkflow.ts';


import { JobFiles } from '../../projects/ProjectsView.ts';

import { Dock } from '../dock/Dock.ts';



import { ToolMismatchNotes } from '../ToolMismatchNotes.ts';

import type { FileTool } from '../../gcode-worker/camTools.ts';
import { RunBridge } from './run/bridge.ts';
import { JobCard } from './run/fileCard.ts';
import { RunInspector } from './run/inspector.ts';
import { JobWorkPanel, PHASE_LABEL, stepStatus } from './run/steps.ts';
import { TraverseToggle } from './run/traverses.ts';


// ---------------------------------------------------------------- inspector: motion (Phase 2)

// The page's own "don't ask again" for C24 lives in spindleConfirm.ts (shared with the terminal, H91).
export { resetSpindleConfirm } from '../spindleConfirm.ts';
export { ConnectNotice } from './run/connect.ts';
export { JogSection } from './run/jog.ts';
export { ZeroSection } from './run/offsets.ts';
export { OverridesSection } from './run/overrides.ts';
export { PositionPanel } from './run/position.ts';
export { SpindleSection } from './run/spindle.ts';



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
