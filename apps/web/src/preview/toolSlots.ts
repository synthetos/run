/**
 * Colour by tool (owner, 2026-11-09): which colour slot each line of the file is drawn in, and the legend the
 * key shows, built from the tools the file uses, in the order it first uses them. Slot 0 is neutral: a tool
 * that is not known (no tool chosen before the first tool change, a tool change that names no tool, a T number
 * not in the tool table), named as such in the legend. Known tools get slots 1 to 8 by first use and keep
 * them; a ninth and later share slot 8 (never cycled). Pure. Display only.
 */
import { NO_TOOL, type ToolChanges } from '@synthetos/gcode';
import { SEGMENT, type SegmentList } from '@synthetos/gcode-view';
import { notInTable, toolNumbered, type ToolTableEntry } from './activeTool.ts';
import { TOOL_COLOURS } from './toolPalette.ts';

export interface LegendEntry {
  readonly slot: number;
  /** The T number, or null for "no tool". */
  readonly number: number | null;
  readonly known: boolean;
  /** "T1 · 3.175 mm 2-flute up-cut": the tool library's name, as the rest of the key says it; or what is unknown. */
  readonly label: string;
}

export interface ToolLegend {
  /** The colour slot of each list line. */
  readonly lineSlots: Uint8Array;
  readonly entries: readonly LegendEntry[];
}

export const NO_TOOL_CHOSEN = 'No tool chosen';
export const NO_TOOL_NAMED = 'Tool change names no tool';

/** True when list lines [from, to) draw a feed or arc. */
function cutsIn(segments: Pick<SegmentList, 'kinds' | 'lineToVertex'>, from: number, to: number): boolean {
  const { kinds, lineToVertex } = segments;
  for (let v = lineToVertex[from] ?? 0; v < (lineToVertex[to] ?? 0); v++) {
    const k = (kinds[v] as number) & ~SEGMENT.UNCERTAIN;
    if (k === SEGMENT.FEED || k === SEGMENT.ARC) return true;
  }
  return false;
}

/** The first sent-line index at or after a file line. */
function firstSentAt(sourceLines: Uint32Array, fileLine: number): number {
  let lo = 0;
  let hi = sourceLines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sourceLines[mid] as number) < fileLine) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The legend and line slots for a file's tool changes, the tool table and the tool the user chose as already
 * in the spindle (for the lines before the first tool change), or null.
 */
export function toolLegend(changes: Pick<ToolChanges, 'lines' | 'tools'>, sourceLines: Uint32Array, segments: Pick<SegmentList, 'kinds' | 'lineToVertex'>, table: readonly ToolTableEntry[], spindleTool: number | null = null): ToolLegend {
  const lines = segments.lineToVertex.length - 1;
  const lineSlots = new Uint8Array(Math.max(0, lines));
  // Spans: [start, tool) where tool is a T number, NO_TOOL, or null before the first change.
  const spans: { start: number; tool: number | null }[] = [{ start: 0, tool: spindleTool }];
  for (let k = 0; k < changes.lines.length; k++) {
    const start = firstSentAt(sourceLines, changes.lines[k] as number);
    const tool = changes.tools[k] as number;
    if ((spans[spans.length - 1] as { start: number }).start === start) spans[spans.length - 1] = { start, tool };
    else spans.push({ start, tool });
  }
  const slots = new Map<number, number>();
  const entries: LegendEntry[] = [];
  const listed = new Set<string>();
  for (let s = 0; s < spans.length; s++) {
    const { start, tool } = spans[s] as { start: number; tool: number | null };
    const end = Math.min(lines, (spans[s + 1] as { start: number } | undefined)?.start ?? lines);
    if (end <= start) continue;
    const found = tool === null || tool === NO_TOOL ? null : toolNumbered(tool, table);
    const known = found?.shape != null;
    let slot = 0;
    if (known && tool !== null) {
      slot = slots.get(tool) ?? Math.min(TOOL_COLOURS, slots.size + 1);
      slots.set(tool, slot);
    }
    lineSlots.fill(slot, start, end);
    if (!cutsIn(segments, start, end)) continue;
    const key = tool === null ? 'none' : String(tool);
    if (listed.has(key)) continue;
    listed.add(key);
    const t = tool === null || tool === NO_TOOL ? null : tool;
    const what = tool === null ? NO_TOOL_CHOSEN : tool === NO_TOOL ? NO_TOOL_NAMED : null;
    const label = what ?? (known ? `T${String(t)} · ${found?.name ?? ''}` : `T${String(t)} · ${notInTable(t as number).replace(/^T\d+ is /, '')}`);
    entries.push({ slot, number: t, known, label });
  }
  return { lineSlots, entries };
}
