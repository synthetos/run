/**
 * The preview container (ROADMAP TB-03): owns the preview state and the
 * `gcode.worker` client, and fills the pure PreviewView with the drawing and
 * the list. Hydrates the idle sheet the build prerendered.
 *
 * Nothing here reaches a machine: the worker has no transport.
 */
import { h, type ComponentChild } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Finding } from '@synthetos/gcode';
import { createGcodePreviewClient, type GcodePreviewClient, type WorkerLike } from '../gcode-worker/client.ts';
import type { PreviewMode, PreviewResult } from '../gcode-worker/pipeline.ts';
import { executingFileLine, fileKey } from './gcodeList.ts';
import { LineList } from './LineList.ts';
import { Preview3D } from './Preview3D.ts';
import { PreviewSvg } from './PreviewSvg.ts';
import { IDLE_STATE, PreviewView, type PreviewSlots, type PreviewViewActions, type PreviewViewState } from './PreviewView.ts';
import type { JobScene } from './sceneModel.ts';
import { pickLabel, scenePart, type ScenePart } from './sceneSettings.ts';
import type { ActiveTool } from './activeTool.ts';
import { useActiveTool, type ActiveToolJob } from './useActiveTool.ts';
import type { Vec3, ViewPreset } from '@synthetos/gcode-view';

/** What a layout gets to arrange: the state, the actions and the rendered pieces. */
export interface PreviewParts {
  readonly state: PreviewViewState;
  readonly actions: PreviewViewActions;
  readonly slots: PreviewSlots;
  /** The live marker, for a layout that shows it elsewhere. */
  readonly live: LiveMarkerView | null;
  /** The job's scene drawn under the path, or null. */
  readonly scene: JobScene | null;
  /** The tool as handed to the drawing, in the path's frame (mm), or null: the layout exposes it as `data-tool`. */
  readonly toolInPath: Vec3 | null;
  /** The tool the 3D marker shows (activeTool.ts), or null before a file is open. */
  readonly tool: ActiveTool | null;
}

export interface PreviewPanelProps {
  /** Starts `gcode.worker`; null without Trusted Types (the panel stays disabled). */
  readonly spawn: (() => WorkerLike) | null;
  /** P1-07: the live position readout (the reported work position), read out under both views. */
  readonly marker?: ReadonlySignal<LiveMarkerView | null>;
  /**
   * The tool tip in the scene's machine coordinates (useLivePlacement), or in the path's own frame when there is
   * no scene; null draws no tool. It is drawn always, not only during a job, relative to the scene's path offset.
   */
  readonly tool?: Vec3 | null;
  /**
   * Arranges the pieces (the workspace Run view). Without it the panel is the TB-03 preview sheet
   * (PreviewView). Either way the state, the worker client and the drawing are the same.
   */
  readonly layout?: (parts: PreviewParts) => ComponentChild;
  /**
   * The line the controller reports executing (status report `line`), for the G-code list's Follow.
   * It is a host line number (Run renumbers every sent line), mapped to the file line through the
   * sent lines; null or 0 when nothing runs. Display only.
   */
  readonly reportedLine?: number | null;
  /** A G-code line's "Report a problem with this line" action (the workspace Run view). */
  readonly onReportLine?: (line: number) => void;
  /**
   * Phase 3 (SAFETY §4.4a): the running job's file lines, from the worker (which maps the reported line through its
   * own sanitised lines): the line executing and the last line sent. They take precedence over `reportedLine`.
   */
  readonly job?: (ActiveToolJob & { readonly sentThrough: number | null }) | null;
  /** Phase 3: the planner view for the 3D drawing, from the preview's line indices (jobUi.plannerRanges). */
  readonly planner?: (sourceLines: Uint32Array) => PlannerView | null;
  /** Phase 3: the G-code list's breakpoints changed (the job gets them at once). */
  readonly onBreakpoints?: (lines: readonly number[]) => void;
  /** The job's scene (bed, stock, fixture, clamps and the planned zero), drawn under the path; null for the path alone. */
  readonly scene?: JobScene | null;
  /** A click on the bed, fixture, stock or a clamp in the drawing (sceneSettings.ts); without it nothing is pickable. */
  readonly onScenePick?: (part: ScenePart) => void;
}

/** The planner view the 3D drawing shows during a job (gcode-view `PlannerOverlay`). */
export interface PlannerView {
  readonly cutEnd: number;
  readonly execEnd: number;
  readonly queuedEnd: number;
  readonly starving: boolean;
}

/**
 * The live work position as the board reports it (`posx`..: the coordinates the G-code is written in, a G92
 * offset included, in the board's units), with where it came from. Read out only: the drawing places the tool
 * from `tool`, mapped into the path's frame at the line the board reports (pathFrame.ts).
 */
export interface LiveMarkerView {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The board's units; null or absent when not known (shown without a unit, as millimetres are). */
  readonly units?: 'mm' | 'in' | null;
  /** The position includes a G92 offset now. */
  readonly g92?: boolean;
  /** Age of the reported position when the window received it, ms. */
  readonly ageMs: number;
  readonly lag: 'none' | 'fresh' | 'amber' | 'red';
}

/** A coordinate with three decimals and a true minus sign. */
function c3(n: number): string {
  return `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(3)}`;
}

/**
 * The live tool position in plain words (WORKSPACE_TENETS 4): "Tool at X 1.000 Y 2.000 Z 3.000 · live",
 * or "· 1.5 s old" once the position is late. The work position the board reports, so it matches the G-code
 * line it runs; " in" after it in inches, and "· G92 offset active" while a temporary offset is part of it.
 */
export function markerText(m: LiveMarkerView): string {
  const age = m.lag === 'fresh' ? 'live' : `${(m.ageMs / 1000).toFixed(1)} s old`;
  return `Tool at X ${c3(m.x)} Y ${c3(m.y)} Z ${c3(m.z)}${m.units === 'in' ? ' in' : ''}${m.g92 === true ? ' · G92 offset active' : ''} · ${age}`;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function PreviewPanel({ spawn, marker, tool = null, layout, reportedLine = null, onReportLine, job = null, planner, onBreakpoints, scene = null, onScenePick }: PreviewPanelProps): ComponentChild {
  const live = marker?.value ?? null;
  const [state, setState] = useState<PreviewViewState>(IDLE_STATE);
  const [fitRequest, setFitRequest] = useState(0);
  const [view, setView] = useState<{ readonly preset: ViewPreset; readonly seq: number }>({ preset: 'iso', seq: 0 });
  const client = useRef<GcodePreviewClient | null>(null);
  const lastFile = useRef<File | null>(null);

  useEffect(() => {
    if (spawn === null) return;
    client.current = createGcodePreviewClient(spawn);
    setState((s) => ({ ...s, ready: true }));
    return () => {
      client.current?.dispose();
      client.current = null;
    };
  }, [spawn]);

  const load = useCallback((file: File, dialect: PreviewViewState['dialect'], mode: PreviewMode) => {
    const c = client.current;
    if (c === null) return;
    lastFile.current = file;
    setState((s) => ({ ...s, status: 'loading', progress: null, fileName: file.name, error: null, result: null, scrub: 0, dialect, mode }));
    c.load(file, { dialect, mode }, (progress) => { setState((s) => (s.status === 'loading' ? { ...s, progress } : s)); }).then(
      (result: PreviewResult) => { setState((s) => ({ ...s, status: 'ready', result, progress: null })); },
      (e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState((s) => ({ ...s, status: 'error', error: message(e), progress: null }));
      },
    );
  }, []);

  const fetchFindings = useCallback((from: number, to: number): Promise<readonly Finding[]> => client.current?.findings(from, to) ?? Promise.resolve([]), []);

  const result = state.status === 'ready' ? state.result : null;
  const segments = result?.segments ?? null;
  const highlight = state.scrub - 1;
  const highlightLine = state.scrub > 0 && result !== null ? (result.sourceLines[state.scrub - 1] ?? 0) : 0;
  const listData = useMemo(() => (result === null ? null : { bytes: result.bytes, spans: result.spans, verdicts: result.verdicts }), [result]);
  const listKey = useMemo(() => (result === null || state.fileName === null ? null : fileKey(state.fileName, result.bytes)), [result, state.fileName]);
  const executingLine = result === null ? null : job !== null ? job.executing : executingFileLine(reportedLine, result.sourceLines);
  const plannerView = result === null || planner === undefined ? null : planner(result.sourceLines);
  const activeTool = useActiveTool(result, state.scrub, job);

  // The tool is drawn only from `tool` (machine coordinates, or the path's frame without a scene): never from the
  // readout, whose work position is in the program's frame and units, not the drawing's.
  const offset = scene?.pathOffset ?? [0, 0, 0];
  const toolInPath: Vec3 | null = tool === null ? null : [tool[0] - offset[0], tool[1] - offset[1], tool[2] - offset[2]];
  const svgMarker = toolInPath === null ? null : { x: toolInPath[0], y: toolInPath[1], lag: live?.lag ?? 'fresh' };
  const pick = onScenePick === undefined ? {} : {
    onPick: (tag: string) => { const part = scenePart(tag); if (part !== null) onScenePick(part); },
    pickLabel: (tag: string) => { const part = scenePart(tag); return part === null ? null : pickLabel(part); },
  };
  const drawing =
    (segments === null || result === null) && scene === null
      ? undefined
      : state.drawing === 'webgl'
        ? h(Preview3D, {
            segments,
            bounds: result?.summary.bounds ?? null,
            showRapids: state.showRapids,
            highlight,
            wcsOrigin: scene === null ? result?.summary.wcsOrigin ?? [0, 0, 0] : scene.zero,
            envelope: result?.summary.envelope ?? null,
            fitRequest,
            toolShape: activeTool?.shape ?? null,
            view,
            planner: plannerView,
            toolMarker: toolInPath,
            scene: scene?.layers ?? null,
            pathOffset: scene?.pathOffset ?? [0, 0, 0],
            ...pick,
            onUnavailable: () => { setState((s) => ({ ...s, drawing: 'svg' })); },
          })
        : h(PreviewSvg, { segments, showRapids: state.showRapids, highlight, envelope: result?.summary.envelope ?? null, marker: svgMarker, scene: scene?.layers ?? null, pathOffset: scene?.pathOffset ?? [0, 0, 0], ...(scene === null ? {} : { zero: scene.zero }), ...pick });
  const readout = live === null ? undefined : h('p', { class: `pv-marker-readout lag-${live.lag}`, 'data-preview': 'marker-readout', role: 'status' }, markerText(live));

  const actions: PreviewViewActions = {
      onFile: (file) => { load(file, state.dialect, state.mode); },
      onDialect: (dialect) => {
        if (lastFile.current !== null) load(lastFile.current, dialect, state.mode);
        else setState((s) => ({ ...s, dialect }));
      },
      onMode: (mode) => {
        if (lastFile.current !== null) load(lastFile.current, state.dialect, mode);
        else setState((s) => ({ ...s, mode }));
      },
      onCancel: () => {
        client.current?.cancel();
        lastFile.current = null;
        setState((s) => ({ ...s, status: 'idle', progress: null, fileName: null, result: null, error: null, scrub: 0 }));
      },
      onRapids: (showRapids) => { setState((s) => ({ ...s, showRapids })); },
      onScrub: (scrub) => { setState((s) => ({ ...s, scrub })); },
      onFit: () => { setFitRequest((n) => n + 1); },
      onView: (preset) => { setView((v) => ({ preset, seq: v.seq + 1 })); },
  };
  const slots: PreviewSlots = {
    ...(drawing === undefined ? {} : { drawing }),
    ...(readout === undefined ? {} : { marker: readout }),
    ...(listData === null ? {} : { list: h(LineList, { data: listData, highlightLine, revealLine: highlightLine, fetchFindings, fileKey: listKey, executingLine, sentThrough: job?.sentThrough ?? null, ...(onReportLine === undefined ? {} : { onReportLine }), ...(onBreakpoints === undefined ? {} : { onBreakpoints }) }) }),
  };
  return layout === undefined ? h(PreviewView, { state, actions, slots }) : layout({ state, actions, slots, live, scene, toolInPath, tool: activeTool });
}
