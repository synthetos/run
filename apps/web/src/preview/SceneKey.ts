/**
 * The scene's key, over the drawing: what the bed is, with links to the bed, fixture and stock settings (so
 * opening them from the scene is not mouse-only), and the live placement's notes (livePlacement.ts).
 */
import { h, type ComponentChild } from 'preact';
import type { JobScene } from './sceneModel.ts';
import { SCENE_PARTS, type ScenePart } from './sceneSettings.ts';

export interface SceneKeyProps {
  readonly scene: JobScene;
  /** Opens a part's settings; without it (a job owns the machine) there are no links. */
  readonly onOpen?: (part: ScenePart) => void;
}

export function SceneKey({ scene, onOpen }: SceneKeyProps): ComponentChild {
  const parts: ScenePart[] = ['bed', ...(scene.layers.solids.some((s) => s.tag === 'fixture') ? (['fixture'] as const) : []), 'stock'];
  const notes = scene.notes ?? [];
  return h(
    'div',
    { class: 'scene-key' },
    notes.length === 0 ? null : h('div', { class: 'viewer-key scene-notes', role: 'status', 'data-scene': 'notes' }, notes.map((n, i) => h('p', { key: String(i), 'data-scene': 'note' }, n))),
    h(
      'div',
      { class: 'viewer-key scene-key-line' },
      h('span', { 'data-scene': 'bed' }, scene.bedLabel),
      onOpen === undefined
        ? null
        : h(
            'nav',
            { class: 'scene-links', 'aria-label': 'Scene settings' },
            parts.map((p, i) => [i === 0 ? null : h('span', { key: `s${p}`, 'aria-hidden': 'true' }, '·'), h('button', { type: 'button', key: p, class: 'link', 'data-scene-link': p, onClick: () => onOpen(p) }, SCENE_PARTS[p].settings)]),
          ),
    ),
  );
}
