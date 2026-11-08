/**
 * Which tool the 3D marker shows (docs/design/tool-sim.md, slice 1): the
 * active T number at a file line, from the preview's change-point table
 * (gcode `toolChanges`), looked up in the tool table (`ToolEntry.number`),
 * as a gcode-view `ToolShape`. Pure. Display only: it never changes or gates
 * anything sent to the machine.
 *
 * A T number not in the table, an M6 with no T, or no tool change before the
 * first cut draws the generic glyph with a note; a size is never guessed.
 * Before the first tool change, the tool the user chose in Analyze as
 * already in the spindle is shown (the same one the carve uses,
 * carveTools.ts): their statement, not a guess.
 */
import { activeToolAt, changeAt, type ToolChanges } from '@synthetos/gcode';
import type { ToolShape, ToolTip } from '@synthetos/gcode-view';
import type { Tool, ToolType } from '@synthetos/library';

/** What the marker and the key show. */
export interface ActiveTool {
  /** The active T number, or null when it is unknown. */
  readonly number: number | null;
  /** The tool's shape at true size, or null for the generic glyph. */
  readonly shape: ToolShape | null;
  /** The tool table entry's name, when found. */
  readonly name: string | null;
  /** A short note for the key, or null. */
  readonly note: string | null;
  /** The T number to offer adding to the tool table, or null. */
  readonly missing: number | null;
}

/** The tool table's part this module reads. */
export interface ToolTableEntry {
  readonly number: number;
  readonly tool: Pick<Tool, 'name' | 'type' | 'geometry'>;
}

const TIP: Readonly<Record<ToolType, ToolTip>> = {
  flat: 'flat',
  surfacing: 'flat',
  'thread-mill': 'flat',
  'o-flute': 'flat',
  ball: 'ball',
  'bull-nose': 'bull-nose',
  'v-bit': 'v',
  engraver: 'v',
  chamfer: 'v',
  drill: 'drill',
};

/**
 * A tool record as a marker shape. The drawn length is the stickout when set, else the overall length. An
 * o-flute with a corner radius is drawn as a bull-nose; a V or drill with no angle uses the profile's default
 * (90° V, 118° drill).
 */
export function toolShapeOf(tool: Pick<Tool, 'type' | 'geometry'>): ToolShape {
  const g = tool.geometry;
  const corner = g.cornerRadius !== undefined && g.cornerRadius > 0;
  const tip: ToolTip = tool.type === 'o-flute' && corner ? 'bull-nose' : TIP[tool.type];
  return {
    tip,
    diameter: g.diameter,
    fluteLength: g.fluteLength,
    shank: g.shank,
    length: g.stickout ?? g.overallLength,
    ...(tip === 'bull-nose' && g.cornerRadius !== undefined ? { cornerRadius: g.cornerRadius } : {}),
    ...(tip === 'v' && g.vAngle !== undefined ? { vAngle: g.vAngle } : {}),
    ...(tip === 'v' && g.tipWidth !== undefined ? { tipWidth: g.tipWidth } : {}),
    ...(tip === 'drill' && g.pointAngle !== undefined ? { pointAngle: g.pointAngle } : {}),
  };
}

export const PLACEHOLDER_NOTE = 'No tool change before the first cut: the tool shown is a placeholder.';
export const notInTable = (t: number): string => `T${String(t)} is not in your tool table`;
export const noToolNamed = (line: number): string => `The tool change at line ${String(line)} names no tool: the tool shown is a placeholder.`;

/**
 * The line whose tool the marker shows in the preview: the last scrubbed file line, or with nothing
 * scrubbed the first cut (the tool the job starts cutting with), or 0 for a file that never cuts.
 */
export function previewToolLine(scrubFileLine: number, changes: Pick<ToolChanges, 'firstCut'>): number {
  return scrubFileLine > 0 ? scrubFileLine : changes.firstCut;
}

/**
 * The job's own tool change, reconciled into the file's table: while the job stands at a tool change it
 * knows the tool from the lines it is sending (sanitised against the live board). Where the two disagree
 * at that change's line, the job's tool wins.
 */
export function withJobChange(changes: ToolChanges, job: { readonly line: number; readonly tool: number | null } | null): ToolChanges {
  if (job === null || job.tool === null) return changes;
  const i = changeAt(changes, job.line);
  if (i < 0 || changes.lines[i] !== job.line || changes.tools[i] === job.tool) return changes;
  const tools = changes.tools.slice();
  tools[i] = job.tool;
  return { ...changes, tools };
}

/** A T number looked up in the tool table: its shape, or the generic glyph and a note offering to add it. */
export function toolNumbered(number: number, table: readonly ToolTableEntry[]): ActiveTool {
  const entry = table.find((e) => e.number === number);
  if (entry !== undefined) return { number, shape: toolShapeOf(entry.tool), name: entry.tool.name, note: null, missing: null };
  return { number, shape: null, name: null, note: notInTable(number), missing: number >= 1 ? number : null };
}

/**
 * The tool active at a file line, looked up in the tool table. Before the first tool change, `spindleTool` (the T
 * number the user chose as already in the spindle), when there is one.
 */
export function activeTool(changes: ToolChanges, fileLine: number, table: readonly ToolTableEntry[], spindleTool: number | null = null): ActiveTool {
  const number = activeToolAt(changes, fileLine);
  if (number !== null) return toolNumbered(number, table);
  const i = changeAt(changes, fileLine);
  if (i >= 0) return { number: null, shape: null, name: null, note: noToolNamed(changes.lines[i] as number), missing: null };
  if (spindleTool !== null) return toolNumbered(spindleTool, table);
  const first = changes.lines[0];
  const cutsFirst = changes.firstCut > 0 && (first === undefined || changes.firstCut < first);
  return { number: null, shape: null, name: null, note: cutsFirst ? PLACEHOLDER_NOTE : null, missing: null };
}
