/**
 * The 3D drawing (ROADMAP TB-03): a canvas driven by gcode-view's WebGL2
 * renderer. It renders on demand only and never animates. Without WebGL2 it
 * reports `onUnavailable` and the panel shows the 2D SVG drawing instead.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { attachViewControls, createRenderer, type Box3, type PreviewRenderer, type SegmentList, type Vec3 } from '@synthetos/gcode-view';
import { previewColors } from './colors.ts';

export interface Preview3DProps {
  readonly segments: SegmentList;
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
}

export function Preview3D(props: Preview3DProps): ComponentChild {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<PreviewRenderer | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    const gl = el.getContext('webgl2', { antialias: true });
    if (gl === null) {
      props.onUnavailable();
      return;
    }
    const style = getComputedStyle(el);
    const r = createRenderer(gl, { colors: previewColors((t) => style.getPropertyValue(t)) });
    renderer.current = r;
    const detach = attachViewControls(el, r);
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
      r.dispose();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    const r = renderer.current;
    if (r === null) return;
    const controller = new AbortController();
    r.setEnvelope(props.envelope);
    void r
      .load(props.segments, { signal: controller.signal, bounds: props.bounds, ...(props.onProgress === undefined ? {} : { onProgress: props.onProgress }) })
      .then(() => { r.setWcsOrigin(props.wcsOrigin); }, () => {});
    return () => { controller.abort(); };
  }, [props.segments]);

  useEffect(() => { renderer.current?.setRapidsVisible(props.showRapids); }, [props.showRapids]);
  useEffect(() => { renderer.current?.setHighlight(props.highlight); }, [props.highlight]);
  useEffect(() => { if (props.fitRequest > 0) renderer.current?.fit(); }, [props.fitRequest]);

  return h('canvas', {
    ref: canvas,
    class: 'preview-canvas',
    tabIndex: 0,
    role: 'img',
    'aria-label': 'Toolpath preview, 3D. Drag or use the arrow keys to turn it, shift to pan, plus and minus to zoom, 0 to fit.',
    'data-preview': 'canvas',
  });
}
