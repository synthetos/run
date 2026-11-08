/**
 * The tool part of the scene's key (docs/design/tool-sim.md, slice 1): which tool the 3D marker shows, and
 * a note when it is a placeholder ("T1 is not in your tool table", with a link to the tool table).
 * `data-active-tool` and `data-tool-shape` say what is drawn, for tests.
 */
import { h, type ComponentChild } from 'preact';
import type { ActiveTool } from './activeTool.ts';

export interface ToolKeyProps {
  readonly tool: ActiveTool;
  /** Opens the tool table; without it (a job owns the machine) there is no link. */
  readonly onAddTool?: (number: number) => void;
}

/** The marker's tool on the key line: "T1 · 3.175 mm 2-flute up-cut", or "Tool unknown". */
export function ToolLabel({ tool }: { readonly tool: ActiveTool }): ComponentChild {
  const text = tool.number === null ? 'Tool unknown' : tool.name === null ? `T${String(tool.number)}` : `T${String(tool.number)} · ${tool.name}`;
  return h('span', { 'data-scene': 'tool', 'data-active-tool': tool.number === null ? 'unknown' : `T${String(tool.number)}`, 'data-tool-shape': tool.shape?.tip ?? 'generic' }, text);
}

/** The placeholder note, with the link to add the missing T number. */
export function ToolNote({ tool, onAddTool }: ToolKeyProps): ComponentChild {
  if (tool.note === null) return null;
  const missing = tool.missing;
  return h(
    'p',
    { 'data-scene': 'tool-note' },
    tool.note,
    missing === null || onAddTool === undefined ? null : [' ', h('button', { type: 'button', class: 'link', 'data-action': 'add-tool-number', onClick: () => onAddTool(missing) }, `Add T${String(missing)} to your tool table`)],
  );
}
