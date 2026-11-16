import type { PreviewPanelProps } from '../../preview/PreviewPanel.ts';
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
import type { ReadonlySignal } from '@preact/signals';
import type { CarveWorkerLike, Vec3 } from '@synthetos/gcode-view';
import { DIALECTS } from '@synthetos/protocol';
import { h, type ComponentChild } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import type { WorkerLike } from '../../gcode-worker/client.ts';
import type { JobCommand } from '../../machine-worker/jobRpc.ts';
import { analysisDialect } from '../../preview/analysisDialect.ts';
import { sceneColors, tokenReader } from '../../preview/colors.ts';
import { playAllowedFor, playRapidOf } from '../../preview/playAllowed.ts';
import { PreviewPanel, type LiveMarkerView, type PreviewParts } from '../../preview/PreviewPanel.ts';
import { jobScene, type JobScene } from '../../preview/sceneModel.ts';
import { openSceneSettings, type ScenePart } from '../../preview/sceneSettings.ts';
import { spinDirection } from '../../preview/spinDirection.ts';
import { useLivePathFrame, useLivePlacement } from '../../preview/useLivePlacement.ts';
import { openReport } from '../../report/state.ts';
import { spindleToolChoice } from '../advisorState.ts';
import { scrubRequest } from '../analysisState.ts';
import { currentFile, executionLock } from '../fileBridge.ts';
import { activeJob, effectiveZero } from '../jobModel.ts';
import { jobUi, plannerRanges, starving, type JobUi } from '../jobUi.ts';
import { materialColor, selectedMachine } from '../library.ts';
import { useLiveWorkZero } from '../liveZero.ts';
import { connected, type WorkspaceModel } from '../model.ts';
import { useAutoZero } from '../useAutoZero.ts';
import { type StopHooks } from './JobViews.ts';
import { runLayout } from './run/layout.ts';
import { PHASE_LABEL } from './run/steps.ts';

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
  const { ui, live, reportedLine, job, starve } = previewSession({ model });
  const stops: StopHooks = { ...(onPause === undefined ? {} : { onPause }), ...(onStopJob === undefined ? {} : { onStopJob }) };
  const sendJob = model?.actions.value?.job;
  // The active-execution lock (FLOW_ANALYSIS §3): while the worker's job owns the machine nothing replaces the preview.
  useEffect(() => {
    executionLock.value = ui.active ? `${PHASE_LABEL(ui.job?.phase ?? 'running')}: the job owns the preview.` : null;
  }, [ui.active, ui.job?.phase]);
  const { scene, tool, snap } = usePreviewScene(live, ui);
  return h(PreviewPanel, previewProps({ ui, spawn, spawnCarve, marker, tool, reportedLine, job, starve, sendJob, scene, snap, onView, model, stops }));
}



export { resetSpindleConfirm } from '../spindleConfirm.ts';
export { ConnectNotice } from './run/connect.ts';
export { JogSection } from './run/jog.ts';
export { ZeroSection } from './run/offsets.ts';
export { OverridesSection } from './run/overrides.ts';
export { PositionPanel } from './run/position.ts';
export { SpindleSection } from './run/spindle.ts';

function previewProps({ ui, spawn, spawnCarve, marker, tool, reportedLine, job, starve, sendJob, scene, snap, onView, model, stops }: { readonly ui: JobUi; readonly spawn: (() => WorkerLike) | null; readonly spawnCarve: (() => CarveWorkerLike) | null; readonly marker: ReadonlySignal<LiveMarkerView | null> | undefined; readonly tool: Vec3 | null; readonly reportedLine: number | null; readonly job: JobView | null; readonly starve: boolean; readonly sendJob: ((command: JobCommand) => Promise<string | null>) | undefined; readonly scene: JobScene | null; readonly snap: SessionSnapshot | null; readonly onView: (view: string) => void; readonly model: WorkspaceModel | null; readonly stops: StopHooks }): PreviewPanelProps {
  return {
    analysisDialect: analysisDialect(ui.connected, ui.snapshot?.classification?.dialectId).dialect,
    analysisLocked: ui.active,
    spawn,
    spawnCarve,
    spindleTool: spindleToolChoice.value,
    ...(marker === undefined ? {} : { marker }),
    tool,
    reportedLine,
    job: previewJob({ job, ui }),
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
  };
}

function previewJob({ job, ui }: { readonly job: JobView | null; readonly ui: JobUi }): NonNullable<PreviewPanelProps['job']> | null {
  return job === null ? null : { executing: job.executing?.line ?? null, sentThrough: job.sentThrough, toolChange: job.toolChange, carve: { id: job.id, hash: job.hash, startedAt: job.startedAt, executing: job.executing?.line ?? null, active: ui.active } };
}

function previewSession({ model }: { readonly model: WorkspaceModel | null }) {
  const live = model?.live.value ?? null;
  const reportedLine = live !== null && connected(live) ? (live.message?.snapshot.live.line ?? null) : null;
  const ui = jobUi(live);
  const job = ui.job !== null && ui.job.startedAt !== null ? ui.job : null;
  const blocks = DIALECTS.find((d) => d.id === ui.snapshot?.classification?.dialectId)?.limits.plannerBlocks ?? null;
  const starve = starving(ui.snapshot, blocks);
  return { ui, live, reportedLine, job, starve };
}

function usePreviewScene(live: import('../model.ts').LiveView | null, ui: JobUi) {
  const active = activeJob.value;
  // The live machine (preview/livePlacement.ts): the job placed where the board is once its position is established, its work position mapped into the path's frame at the line it reports (pathFrame.ts).
  const snap = live !== null && connected(live) ? (live.message?.snapshot ?? null) : null;
  // The board's work zero while the position is established (OD-28): a job that uses it is planned there.
  const liveZero = useLiveWorkZero(snap === null ? null : { ...snap.live, overlays: snap.overlays });
  const zeroAt = active === null ? null : effectiveZero(active, liveZero);
  const planned = useMemo(() => (active === null || zeroAt === null ? null : jobScene(active, sceneColors(tokenReader()), materialColor(active.setup.stock.materialRef.id), zeroAt)), [active, zeroAt?.x, zeroAt?.y, zeroAt?.z]);
  useAutoZero(active);
  const { scene, tool } = useLivePlacement(planned, snap === null ? null : { ...snap.live, overlays: snap.overlays }, useLivePathFrame(currentFile.value?.preview ?? null, ui.job));
  return { scene, tool, snap };
}

type JobView = NonNullable<JobUi['job']>;
type SessionSnapshot = NonNullable<JobUi['snapshot']>;
