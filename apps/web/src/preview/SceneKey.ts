/**
 * The scene's key over the drawing (owner, 2026-11-09: "the viewer shows the picture"): only the colour-by-tool
 * legend, compact, and a missing tool's note with its link to the tool table (dismissable; it is a note too). The
 * bed, the parts' settings links and the carving detail are in the viewer's settings menu (ViewerMenu.ts); every
 * explanation is in the Notes tab (previewNotes.ts). The tool the marker shows stays for screen readers.
 */
import { h, type ComponentChild } from 'preact';
import type { ActiveTool } from './activeTool.ts';
import type { JobScene } from './sceneModel.ts';
import type { ScenePart } from './sceneSettings.ts';
import { Dismissable } from '../workspace/notes/Dismissable.ts';
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





export function SceneKey({ tool = null, onAddTool, markerPreview = false, carve = null, tools = null }: SceneKeyProps): ComponentChild {
  const toolNote = tool?.note == null ? null : h(ToolNote, { tool, ...(onAddTool === undefined ? {} : { onAddTool }) });
  const failed = carve !== null && carve.status.value.failed !== null;
  return h(
    'div',
    { class: 'scene-key', 'data-key-level': 'simple' },
    // A missing tool keeps its link to the tool table, and can be hidden (its text is a note too).
    toolNote === null ? null : h(Dismissable, { id: `tool-note:${tool?.missing ?? 'first'}`, label: 'the tool note', class: 'viewer-key scene-notes' }, h('div', { role: 'status', 'data-scene': 'notes' }, toolNote)),
    h(
      'div',
      { class: 'viewer-key scene-key-line' },
      // The colour legend is the key (owner, 2026-11-09): compact, over the drawing.
      tools === null || tools.entries.length < 2 ? null : h(ToolLegend, { entries: tools.entries, palette: tools.palette, focus: tools.focus, onFocus: tools.setFocus }),
      // For screen readers and tests: the tool the marker shows, and that it is the planned position. Not drawn.
      h('span', { class: 'sr-only' }, tool === null ? null : h(ToolLabel, { tool }), markerPreview ? h('span', { 'data-scene': 'tool-preview' }, ` ${PREVIEW_MARKER_NOTE}`) : null),
      // The carve's test hooks, hidden; a stopped carve says so.
      carve !== null ? h(CarveLabel, { carve, simple: !failed }) : null,
    ),
  );
}
