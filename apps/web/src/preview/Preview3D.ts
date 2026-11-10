/**
 * The 3D drawing (ROADMAP TB-03): a canvas driven by gcode-view's WebGL2
 * renderer. It renders on demand only, through the frame budget (frameBudget.ts): capped during a job, and light
 * (2 fps, fewer pixels, the carve brought up to date every 2 s) on a software or slow renderer, so Pause and Stop
 * job never wait behind a frame. Without WebGL2 it
 * reports `onUnavailable` and the panel shows the 2D SVG drawing instead.
 *
 * With a scene (preview/sceneModel.ts) the bed, stock, fixture and clamps
 * are drawn under the path, in machine coordinates, and the path is moved
 * to the planned work zero by the renderer's offset uniform. With a carve
 * feed (useCarve.ts) the stock is drawn carved, uploaded as it changes.
 */
import { Fragment, h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { bitTurns } from './bitTurns.ts';
import { attachPicking, attachViewControls, createRenderer, unionRect, type Box3, type CarveFeed, type CellRect, type ToolColors, type PlannerOverlay, type PreviewRenderer, type SceneLayers, type SegmentList, type SpinDirection, type ToolShape, type Vec3, type ViewPreset } from '@synthetos/gcode-view';
import { previewColors } from './colors.ts';
import { browserFrameClock, FrameBudget, type BudgetState } from './frameBudget.ts';
import { isSoftwareRenderer, LIGHT_CARVE_MESH_MAX, probeRendererName } from './rendererKind.ts';
import { loadDetail, toolVertices, type DetailStage } from './detail.ts';
import type { PlayFeed } from './usePlay.ts';

export interface Preview3DProps {
  /** The path, or null for a scene alone (the Setup view before a file is open). */
  readonly segments: SegmentList | null;
  readonly detail?: 'auto' | 'lite' | 'full';
  readonly coarseFirst?: boolean;
  readonly toolChanges?: Uint32Array | undefined;
  readonly sourceLines?: Uint32Array | undefined;
  readonly bounds: Box3 | null;
  readonly showRapids: boolean;
  /** Highlight sent lines 0..this; -1 for none. */
  readonly highlight: number;
  readonly wcsOrigin: Vec3;
  readonly envelope: Box3 | null;
  /** Changes when the user asks to fit the view. */
  readonly fitRequest: number;
  readonly onUnavailable: () => void;
  readonly onProgress?: (fraction: number) => void;
  /** Phase 3: the planner view of a running job (done, executing, in the planner, waiting for the ack), or null. */
  readonly planner?: PlannerOverlay | null;
  /** The spindle as the board reports it: the live marker turns while it is on (gcode-view markerSpin.ts). */
  readonly toolSpin?: SpinDirection;
  /** Phase 3: the tool position the board reports during a job (work coordinates, as drawn), or null. */
  readonly toolMarker?: Vec3 | null;
  /** With no `toolMarker`: the planned tool position (previewMarker.ts), drawn dimmed as a preview, or null. */
  readonly previewMarker?: Vec3 | null;
  /** The marker's tool at true size (preview/activeTool.ts), or null for the generic glyph. */
  readonly toolShape?: ToolShape | null;
  /** The scene solids under the path (machine coordinates), or null. */
  readonly scene?: SceneLayers | null;
  /** Where the path's origin sits in the scene (the planned work zero); [0, 0, 0] without a scene. */
  readonly pathOffset?: Vec3;
  /** A named view asked for: changes when the user picks one. */
  readonly view?: { readonly preset: ViewPreset; readonly seq: number };
  readonly label?: string;
  /** A click on a scene solid, with its tag; without it nothing is pickable. */
  readonly onPick?: (tag: string) => void;
  /** The hover label of a tag ("Fixture: open settings"), or null for a solid that opens nothing. */
  readonly pickLabel?: (tag: string) => string | null;
  /** The carved stock (useCarve.ts), drawn in place of the flat stock; null or absent for none. */
  readonly carve?: CarveFeed | null;
  /** Colour by tool (useToolColors.ts): a slot per line and the colours; null or absent for colour by move type. */
  readonly toolColors?: ToolColors | null;
  /** The legend's pick: that tool's lines stand out; null for all. */
  readonly toolFocus?: number | null;
  /** Play preview's tool position (usePlay.ts), drawn as its own marker in the highlight colour; null or absent for none. */
  readonly play?: PlayFeed | null;
}

/** Light mode during a job: the carved stock is brought up to date at most this often (frameBudget.ts). */
export const LIGHT_CARVE_MS = 2000;

/** The chip shown in light mode. */
export function lightText(state: BudgetState | null): string | null {
  if (state === null || state.light === null) return null;
  return state.light === 'software' ? 'Light preview: this computer has no 3D acceleration' : 'Light preview: 3D drawing is slow on this computer';
}

export function Preview3D(props: Preview3DProps): ComponentChild {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<PreviewRenderer | null>(null);
  // The frame budget (frameBudget.ts): on demand, capped during a job, light on a software or slow renderer.
  const budget = useRef<FrameBudget | null>(null);
  const [budgetState, setBudgetState] = useState<BudgetState | null>(null);
  const [detailState, setDetailState] = useState<{ stage: DetailStage; fraction: number } | null>(null);
  const drawnList = useRef<SegmentList | null>(null);
  const plan = props.planner ?? null;
  // A job is running while the planner view is shown (Phase 3).
  const jobRunning = useRef(false);
  jobRunning.current = plan !== null;
  const [hover, setHover] = useState<{ readonly text: string; readonly x: number; readonly y: number } | null>(null);
  // The latest handlers, read by the listeners attached once.
  const pickRef = useRef({ onPick: props.onPick, pickLabel: props.pickLabel });
  pickRef.current = { onPick: props.onPick, pickLabel: props.pickLabel };

  useEffect(() => {
    const found = canvas.current;
    if (found === null) return;
    const el: HTMLCanvasElement = found;
    // A software renderer draws on this thread: no multisampling and the smallest carve mesh keep each frame short.
    const software = isSoftwareRenderer(probeRendererName());
    const gl = el.getContext('webgl2', { antialias: !software });
    if (gl === null) {
      props.onUnavailable();
      return;
    }
    const style = getComputedStyle(el);
    const frames = new FrameBudget(browserFrameClock(), {
      software,
      onChange: (state) => {
        size();
        setBudgetState(state);
      },
      // Diagnostics on the canvas (no re-render): the last frame's cost and the drawing scale.
      onFrame: (cost) => {
        el.dataset['frameMs'] = cost.toFixed(1);
        el.dataset['frameScale'] = String(frames.state.scale);
        if (r.chunkCount > 0) {
          el.dataset['firstDrawAt'] ??= String(performance.now());
          if (el.dataset['detail'] === 'full') el.dataset['fullDrawAt'] ??= String(performance.now());
        }
      },
    });
    frames.setJobRunning(jobRunning.current);
    budget.current = frames;
    setBudgetState(frames.state);
    // The bed/work grid is always drawn, so the drawing keeps its floor and scale once a file is loaded.
    const r = createRenderer(gl, { colors: previewColors((t) => style.getPropertyValue(t)), grid: true, requestFrame: frames.requestFrame, ...(software ? { carveMeshMax: LIGHT_CARVE_MESH_MAX } : {}) });
    bitTurns.value = r.turnsBit;
    renderer.current = r;
    const detach = attachViewControls(el, r);
    const detachPick = attachPicking(el, r, {
      onPick: (tag) => {
        const { onPick, pickLabel } = pickRef.current;
        if (onPick !== undefined && pickLabel?.(tag) != null) onPick(tag);
      },
      onHover: (hit) => {
        const { onPick, pickLabel } = pickRef.current;
        const text = hit === null || onPick === undefined ? null : (pickLabel?.(hit.tag) ?? null);
        setHover(text === null || hit === null ? null : { text, x: hit.x, y: hit.y });
      },
    });
    // Light mode draws fewer pixels (the browser scales the canvas up): each frame then costs less.
    function size(): void { r.resize(el.clientWidth, el.clientHeight, devicePixelRatio * frames.state.scale); }
    size();
    const observer = new ResizeObserver(size);
    observer.observe(el);
    const theme = new MutationObserver(() => { r.setColors(previewColors((t) => getComputedStyle(el).getPropertyValue(t))); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      theme.disconnect();
      detach();
      detachPick();
      r.dispose();
      frames.dispose();
      renderer.current = null;
      budget.current = null;
    };
  }, []);

  const scene = props.scene ?? null;
  const offset = props.pathOffset ?? null;
  useEffect(() => { renderer.current?.setScene(scene); }, [scene]);
  useEffect(() => { renderer.current?.setPathOffset(offset ?? [0, 0, 0]); }, [offset?.[0], offset?.[1], offset?.[2], offset === null]);

  useEffect(() => {
    const r = renderer.current;
    if (r === null) return;
    const controller = new AbortController();
    r.setEnvelope(props.envelope);
    if (props.segments === null) {
      r.clear();
      drawnList.current = null;
      setDetailState(null);
      r.setWcsOrigin(props.wcsOrigin);
      return;
    }
    const sameFile = drawnList.current === props.segments;
    drawnList.current = props.segments;
    if (canvas.current !== null) {
      delete canvas.current.dataset['fullDrawAt'];
      delete canvas.current.dataset['detail'];
      if (!sameFile) delete canvas.current.dataset['firstDrawAt'];
    }
    setDetailState(null);
    void loadDetail(r, props.segments, {
      signal: controller.signal,
      coarseFirst: props.coarseFirst === true || props.segments.kinds.length > 300_000,
      stayCoarse: props.detail === 'lite' || budget.current?.state.light != null,
      keepVertices: toolVertices(props.segments, props.toolChanges, props.sourceLines),
      bounds: props.bounds,
      retain: sameFile,
      painted: () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      onProgress: (stage, fraction) => {
        if (controller.signal.aborted) return;
        setDetailState({ stage, fraction });
        props.onProgress?.(fraction);
        if (canvas.current !== null) {
          canvas.current.dataset['detail'] = stage;
          canvas.current.dataset['detailAt'] = String(performance.now());
        }
      },
    }).then(() => { if (!controller.signal.aborted) r.setWcsOrigin(props.wcsOrigin); }, () => {});
    return () => { controller.abort(); };
  }, [props.segments, props.detail, budgetState?.light]);

  useEffect(() => { renderer.current?.setWcsOrigin(props.wcsOrigin); }, [props.wcsOrigin[0], props.wcsOrigin[1], props.wcsOrigin[2]]);
  useEffect(() => { renderer.current?.setRapidsVisible(props.showRapids); }, [props.showRapids]);
  useEffect(() => { renderer.current?.setHighlight(props.highlight); }, [props.highlight]);
  useEffect(() => { if (props.fitRequest > 0) renderer.current?.fit(); }, [props.fitRequest]);
  const view = props.view;
  useEffect(() => { if (view !== undefined && view.seq > 0) renderer.current?.setView(view.preset); }, [view?.seq]);
  useEffect(() => { budget.current?.setJobRunning(plan !== null); }, [plan === null]);
  useEffect(() => { renderer.current?.setPlanner(plan); }, [plan?.cutEnd, plan?.execEnd, plan?.queuedEnd, plan?.sentEnd, plan?.starving, plan === null]);
  const spin = props.toolSpin ?? 0;
  useEffect(() => { renderer.current?.setToolSpin(spin); }, [spin]);
  const live = props.toolMarker ?? null;
  const tool = live ?? props.previewMarker ?? null;
  const preview = live === null && tool !== null;
  useEffect(() => { renderer.current?.setToolMarker(tool, preview); }, [tool?.[0], tool?.[1], tool?.[2], tool === null, preview]);
  const shape = props.toolShape ?? null;
  useEffect(() => { renderer.current?.setToolShape(shape); }, [shape]);
  const toolColors = props.toolColors ?? null;
  useEffect(() => { renderer.current?.setToolColors(toolColors); }, [toolColors]);
  const toolFocus = props.toolFocus ?? null;
  useEffect(() => { renderer.current?.setToolFocus(toolFocus); }, [toolFocus]);
  const play = props.play ?? null;
  useEffect(() => {
    const r = renderer.current;
    if (r === null || play === null) return;
    const off = play.subscribe((pos) => { r.setPlayMarker(pos); });
    return () => {
      off();
      r.setPlayMarker(null);
    };
  }, [play]);
  const carve = props.carve ?? null;
  useEffect(() => {
    const r = renderer.current;
    if (r === null || carve === null) return;
    // Light mode during a job: patches are gathered and the carve brought up to date every LIGHT_CARVE_MS.
    let held: CellRect | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      timer = null;
      const rect = held;
      held = null;
      if (rect !== null) r.updateCarve(rect);
    };
    const off = carve.subscribe({
      surface: (s) => {
        held = null;
        r.setCarve(s);
      },
      patch: (rect) => {
        if (budget.current?.state.light == null || !jobRunning.current) {
          r.updateCarve(rect);
          return;
        }
        held = unionRect(held, rect);
        timer ??= setTimeout(flush, LIGHT_CARVE_MS);
      },
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
      r.setCarve(null);
    };
  }, [carve]);

  const lightBase = lightText(budgetState);
  const coarse = detailState?.stage === 'coarse';
  const light = lightBase === null ? null : `${lightBase}${coarse ? ' · Coarse detail' : ''}`;
  const progress = detailState?.stage === 'refining' ? `Drawing full detail… ${Math.floor(detailState.fraction * 100)}%` : null;
  return h(Fragment, null, h('canvas', {
    ref: canvas,
    class: 'preview-canvas',
    style: hover === null ? undefined : { cursor: 'pointer' },
    tabIndex: 0,
    role: 'img',
    'aria-label': props.label ?? 'Toolpath preview, 3D. Drag or use the arrow keys to turn it, shift to pan, plus and minus to zoom, 0 to fit.',
    'data-preview': 'canvas',
  }), progress === null ? null : h('span', { class: 'preview-light-chip', role: 'status', 'data-preview': 'detail-progress' }, progress), light === null ? null : h('span', { class: 'preview-light-chip', role: 'status', 'data-preview': 'light', 'data-light': budgetState?.light ?? '' }, light), hover === null ? null : h('span', { class: 'scene-pick-label', 'data-preview': 'pick-label', 'aria-hidden': 'true', style: { left: `${hover.x + 14}px`, top: `${hover.y + 14}px` } }, hover.text));
}
