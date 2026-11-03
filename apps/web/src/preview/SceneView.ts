/**
 * The scene on its own (the Setup view's editing mode of the one scene): the
 * job's bed, stock, fixture and clamps with the open file's path, drawn by
 * the same renderer and fallback as the Run view, in machine coordinates.
 *
 * It mounts its canvas only while shown, so a hidden view never holds a
 * second GPU copy of a large path; the Run view's own drawing keeps its
 * camera and geometry through view switches.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import type { ViewPreset } from '@synthetos/gcode-view';
import type { CurrentPreview } from '../workspace/fileBridge.ts';
import { Preview3D } from './Preview3D.ts';
import { PreviewSvg } from './PreviewSvg.ts';
import type { JobScene } from './sceneModel.ts';

export interface SceneViewProps {
  readonly scene: JobScene;
  /** The open file's path, or null before a file is open. */
  readonly preview: CurrentPreview | null;
  /** False while the view is hidden: nothing is drawn or uploaded. */
  readonly active: boolean;
}

const PRESETS: readonly { readonly id: ViewPreset; readonly label: string }[] = [
  { id: 'iso', label: '3D' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
];

/** The camera buttons (3D, Top, Front) and Fit, shared by the Run and Setup viewers. */
export function ViewButtons({ current, onView, onFit }: { readonly current: ViewPreset; readonly onView?: (p: ViewPreset) => void; readonly onFit?: () => void }): ComponentChild {
  return h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Camera' },
    PRESETS.map((p) => h('button', { type: 'button', key: p.id, class: current === p.id ? 'selected' : undefined, 'aria-pressed': current === p.id ? 'true' : 'false', 'data-preview': `view-${p.id}`, ...(onView === undefined ? { disabled: true } : { onClick: () => onView(p.id) }) }, p.label)),
    h('button', { type: 'button', 'data-preview': 'fit', ...(onFit === undefined ? { disabled: true } : { onClick: onFit }) }, 'Fit'),
  );
}

export function SceneView({ scene, preview, active }: SceneViewProps): ComponentChild {
  const [drawing, setDrawing] = useState<'webgl' | 'svg'>('webgl');
  const [view, setView] = useState<{ readonly preset: ViewPreset; readonly seq: number }>({ preset: 'iso', seq: 0 });
  const [fit, setFit] = useState(0);
  const segments = preview?.segments ?? null;
  const label = 'Bed, fixture, clamps and stock with the toolpath, in machine coordinates. Drag to orbit, middle-drag or shift-drag to pan, scroll to zoom.';
  return h(
    'div',
    { class: 'scene-view', 'data-preview': 'scene', 'data-drawing': drawing },
    !active
      ? null
      : drawing === 'webgl'
        ? h(Preview3D, { segments, bounds: preview?.bounds ?? null, showRapids: true, highlight: -1, wcsOrigin: scene.zero, envelope: null, fitRequest: fit, view, scene: scene.layers, pathOffset: scene.pathOffset, label, onUnavailable: () => setDrawing('svg') })
        : h(PreviewSvg, { segments, showRapids: true, highlight: -1, envelope: null, scene: scene.layers, pathOffset: scene.pathOffset, zero: scene.zero, label }),
    h('div', { class: 'viewer-top' }, h('span', { class: 'viewer-label', 'data-scene': 'bed' }, scene.bedLabel), h(ViewButtons, { current: view.preset, onView: (preset) => setView((v) => ({ preset, seq: v.seq + 1 })), onFit: () => setFit((n) => n + 1) })),
  );
}
