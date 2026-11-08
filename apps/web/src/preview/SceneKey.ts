/**
 * The scene's key, over the drawing: what the bed is, with links to the bed, fixture and stock settings (so
 * opening them from the scene is not mouse-only), the live placement's notes (livePlacement.ts), and the
 * tool the marker shows (ToolKey.ts). Without a job's scene it shows the tool alone.
 */
import { h, type ComponentChild } from 'preact';
import type { ActiveTool } from './activeTool.ts';
import type { JobScene } from './sceneModel.ts';
import { SCENE_PARTS, type ScenePart } from './sceneSettings.ts';
import { ToolLabel, ToolNote } from './ToolKey.ts';

export interface SceneKeyProps {
  readonly scene: JobScene | null;
  /** Opens a part's settings; without it (a job owns the machine) there are no links. */
  readonly onOpen?: (part: ScenePart) => void;
  /** The tool the marker shows, or null before a file is open. */
  readonly tool?: ActiveTool | null;
  /** Opens the tool table for a missing T number; without it there is no link. */
  readonly onAddTool?: (number: number) => void;
}

export function SceneKey({ scene, onOpen, tool = null, onAddTool }: SceneKeyProps): ComponentChild {
  const parts: ScenePart[] = scene === null ? [] : ['bed', ...(scene.layers.solids.some((s) => s.tag === 'fixture') ? (['fixture'] as const) : []), 'stock'];
  const notes = scene?.notes ?? [];
  const toolNote = tool?.note == null ? null : h(ToolNote, { tool, ...(onAddTool === undefined ? {} : { onAddTool }) });
  return h(
    'div',
    { class: 'scene-key' },
    notes.length === 0 && toolNote === null
      ? null
      : h('div', { class: 'viewer-key scene-notes', role: 'status', 'data-scene': 'notes' }, notes.map((n, i) => h('p', { key: String(i), 'data-scene': 'note' }, n)), toolNote),
    h(
      'div',
      { class: 'viewer-key scene-key-line' },
      scene === null ? null : h('span', { 'data-scene': 'bed' }, scene.bedLabel),
      tool === null ? null : [scene === null ? null : h('span', { 'aria-hidden': 'true' }, '·'), h(ToolLabel, { tool })],
      onOpen === undefined || parts.length === 0
        ? null
        : h(
            'nav',
            { class: 'scene-links', 'aria-label': 'Scene settings' },
            parts.map((p, i) => [i === 0 ? null : h('span', { key: `s${p}`, 'aria-hidden': 'true' }, '·'), h('button', { type: 'button', key: p, class: 'link', 'data-scene-link': p, onClick: () => onOpen(p) }, SCENE_PARTS[p].settings)]),
          ),
    ),
  );
}
