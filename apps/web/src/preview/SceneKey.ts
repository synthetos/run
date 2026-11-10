/**
 * The scene's key, over the drawing. Simple (the default level) shows what a hobbyist needs: the tool the
 * marker shows by its library name (ToolKey.ts), "Bed 750 × 750 mm (not measured yet)" for a placeholder bed (a link to its
 * settings), a tool missing from the tool table (the other notes are in the Notes tab, previewNotes.ts) and a quiet hint that clicking the bed, fixture or stock opens its settings. Advanced adds what
 * the bed is, the carving detail and links to the bed, fixture and stock settings (so opening them is not
 * mouse-only there). The live placement's notes (livePlacement.ts) show at both levels. Without a job's scene
 * it shows the tool alone.
 */
import { h, type ComponentChild } from 'preact';
import type { ActiveTool } from './activeTool.ts';
import type { JobScene } from './sceneModel.ts';
import { SCENE_PARTS, type ScenePart } from './sceneSettings.ts';
import { ToolLabel, ToolNote } from './ToolKey.ts';
import { PREVIEW_MARKER_NOTE } from './previewMarker.ts';
import { CarveLabel } from './CarveKey.ts';
import type { CarveInfo } from './useCarve.ts';
import { ToolLegend } from './ToolLegend.ts';
import type { ToolColorView } from './useToolColors.ts';

export interface SceneKeyProps {
  readonly scene: JobScene | null;
  /** Opens a part's settings; without it (a job owns the machine) there are no links. */
  readonly onOpen?: (part: ScenePart) => void;
  /** The tool the marker shows, or null before a file is open. */
  readonly tool?: ActiveTool | null;
  /** Opens the tool table for a missing T number; without it there is no link. */
  readonly onAddTool?: (number: number) => void;
  /** The marker is the planned position at the scrubbed line, not the machine: the key says so. */
  readonly markerPreview?: boolean;
  /** The stock carving (useCarve.ts), or null when nothing is carved. */
  readonly carve?: CarveInfo | null;
  /** The Simple level: the tool in plain words and the notes that matter, no bed name, carving detail or links. */
  readonly simple?: boolean;
  /** Colour by tool: the legend's entries, colours and pick (useToolColors.ts), or null. */
  readonly tools?: ToolColorView | null;
}

/** Simple's bed words for a placeholder bed (C2): its size and that it is not measured yet, never "not set". */
export function bedNotMeasured(scene: JobScene): string {
  return `Bed ${scene.bedSize ?? ''}`.trim();
}

/** Items joined by a quiet middle dot. */
function joined(items: readonly ComponentChild[]): ComponentChild[] {
  return items.filter((i) => i !== null && i !== false).flatMap((item, k) => (k === 0 ? [item] : [h('span', { 'aria-hidden': 'true' }, '·'), item]));
}

/** One row of the key, or nothing when it is empty. */
function row(items: ComponentChild[]): ComponentChild {
  return items.length === 0 ? null : h('span', { class: 'scene-key-row' }, items);
}

/** "Click the bed, fixture or stock to change it", naming the parts the scene has. */
export function pickHint(parts: readonly ScenePart[]): string {
  const names = parts.map((p) => (p === 'bed' ? 'the bed' : p));
  const list = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1] as string}`;
  return `Click ${list} to change it`;
}

export function SceneKey({ scene, onOpen, tool = null, onAddTool, markerPreview = false, carve = null, simple = false, tools = null }: SceneKeyProps): ComponentChild {
  const parts: ScenePart[] = scene === null ? [] : ['bed', ...(scene.layers.solids.some((s) => s.tag === 'fixture') ? (['fixture'] as const) : []), 'stock'];
  const toolNote = tool?.note == null ? null : h(ToolNote, { tool, ...(onAddTool === undefined ? {} : { onAddTool }) });
  const bed = scene === null
    ? null
    : !simple
      ? h('span', { 'data-scene': 'bed' }, scene.bedLabel)
      : !scene.bedPlaceholder
        ? null
        : onOpen === undefined
          ? h('span', { 'data-scene': 'bed' }, bedNotMeasured(scene))
          : h('button', { type: 'button', class: 'link', 'data-scene': 'bed', 'data-scene-link': 'bed', onClick: () => onOpen('bed') }, bedNotMeasured(scene));
  const links = simple || onOpen === undefined || parts.length === 0
    ? null
    : h('nav', { class: 'scene-links', 'aria-label': 'Scene settings' }, joined(parts.map((p) => h('button', { type: 'button', key: p, class: 'link', 'data-scene-link': p, onClick: () => onOpen(p) }, SCENE_PARTS[p].settings))));
  const failed = carve !== null && carve.status.value.failed !== null;
  const hint = simple && onOpen !== undefined && parts.length > 0 ? h('span', { class: 'scene-pick-hint', 'data-scene': 'pick-hint' }, pickHint(parts)) : null;
  return h(
    'div',
    { class: 'scene-key', 'data-key-level': simple ? 'simple' : 'advanced' },
    // The scene's notes, a cut below the stock and lines not carved are in the Notes tab (previewNotes.ts); the key
    // keeps only a missing tool, with its link to the tool table.
    toolNote === null ? null : h('div', { class: 'viewer-key scene-notes', role: 'status', 'data-scene': 'notes' }, toolNote),
    h(
      'div',
      { class: 'viewer-key scene-key-line' },
      // The carve line carries the test hooks at both levels; in Simple it shows nothing unless the carve stopped.
      carve !== null && simple && !failed ? h(CarveLabel, { carve, simple }) : null,
      row(joined([
        simple ? null : bed,
        tool === null ? null : h(ToolLabel, { tool, simple }),
        markerPreview ? h('span', { 'data-scene': 'tool-preview' }, PREVIEW_MARKER_NOTE) : null,
        carve !== null && (!simple || failed) ? h(CarveLabel, { carve, simple }) : null,
        simple ? bed : null,
      ])),
      tools === null || tools.entries.length < 2 ? null : row([h(ToolLegend, { entries: tools.entries, palette: tools.palette, focus: tools.focus, onFocus: tools.setFocus })]),
      row(joined([links, hint])),
    ),
  );
}
