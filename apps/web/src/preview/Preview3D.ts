/**
 * The 3D drawing (ROADMAP TB-03): a canvas driven by gcode-view's WebGL2
 * renderer. It renders on demand only and never animates. Without WebGL2 it
 * reports `onUnavailable` and the panel shows the 2D SVG drawing instead.
 *
 * With a scene (preview/sceneModel.ts) the bed, stock, fixture and clamps
 * are drawn under the path, in machine coordinates, and the path is moved
 * to the planned work zero by the renderer's offset uniform. With a carve
 * feed (useCarve.ts) the stock is drawn carved, uploaded as it changes.
 */
import { Fragment, h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { attachPicking, attachViewControls, createRenderer, type Box3, type CarveFeed, type ToolColors, type PlannerOverlay, type PreviewRenderer, type SceneLayers, type SegmentList, type ToolShape, type Vec3, type ViewPreset } from '@synthetos/gcode-view';
import { previewColors } from './colors.ts';

export interface Preview3DProps {
  /** The path, or null for a scene alone (the Setup view before a file is open). */
  readonly segments: SegmentList | null;
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
  /** Phase 3: the planner view of a running job (cut, executing, queued), or null. */
  readonly planner?: PlannerOverlay | null;
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
}

export function Preview3D(props: Preview3DProps): ComponentChild {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<PreviewRenderer | null>(null);
  const [hover, setHover] = useState<{ readonly text: string; readonly x: number; readonly y: number } | null>(null);
  // The latest handlers, read by the listeners attached once.
  const pickRef = useRef({ onPick: props.onPick, pickLabel: props.pickLabel });
  pickRef.current = { onPick: props.onPick, pickLabel: props.pickLabel };

  useEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    const gl = el.getContext('webgl2', { antialias: true });
    if (gl === null) {
      props.onUnavailable();
      return;
    }
    const style = getComputedStyle(el);
    // The bed/work grid is always drawn, so the drawing keeps its floor and scale once a file is loaded.
    const r = createRenderer(gl, { colors: previewColors((t) => style.getPropertyValue(t)), grid: true });
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
    const size = (): void => { r.resize(el.clientWidth, el.clientHeight, devicePixelRatio); };
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
      renderer.current = null;
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
      r.setWcsOrigin(props.wcsOrigin);
      return;
    }
    void r
      .load(props.segments, { signal: controller.signal, bounds: props.bounds, ...(props.onProgress === undefined ? {} : { onProgress: props.onProgress }) })
      .then(() => { r.setWcsOrigin(props.wcsOrigin); }, () => {});
    return () => { controller.abort(); };
  }, [props.segments]);

  useEffect(() => { renderer.current?.setWcsOrigin(props.wcsOrigin); }, [props.wcsOrigin[0], props.wcsOrigin[1], props.wcsOrigin[2]]);
  useEffect(() => { renderer.current?.setRapidsVisible(props.showRapids); }, [props.showRapids]);
  useEffect(() => { renderer.current?.setHighlight(props.highlight); }, [props.highlight]);
  useEffect(() => { if (props.fitRequest > 0) renderer.current?.fit(); }, [props.fitRequest]);
  const view = props.view;
  useEffect(() => { if (view !== undefined && view.seq > 0) renderer.current?.setView(view.preset); }, [view?.seq]);
  const plan = props.planner ?? null;
  useEffect(() => { renderer.current?.setPlanner(plan); }, [plan?.cutEnd, plan?.execEnd, plan?.queuedEnd, plan?.starving, plan === null]);
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
  const carve = props.carve ?? null;
  useEffect(() => {
    const r = renderer.current;
    if (r === null || carve === null) return;
    const off = carve.subscribe({ surface: (s) => { r.setCarve(s); }, patch: (rect) => { r.updateCarve(rect); } });
    return () => {
      off();
      r.setCarve(null);
    };
  }, [carve]);

  return h(Fragment, null, h('canvas', {
    ref: canvas,
    class: 'preview-canvas',
    style: hover === null ? undefined : { cursor: 'pointer' },
    tabIndex: 0,
    role: 'img',
    'aria-label': props.label ?? 'Toolpath preview, 3D. Drag or use the arrow keys to turn it, shift to pan, plus and minus to zoom, 0 to fit.',
    'data-preview': 'canvas',
  }), hover === null ? null : h('span', { class: 'scene-pick-label', 'data-preview': 'pick-label', 'aria-hidden': 'true', style: { left: `${hover.x + 14}px`, top: `${hover.y + 14}px` } }, hover.text));
}
