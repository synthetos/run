/**
 * Which tool carves each line (docs/design/tool-sim.md, slice 2): the
 * file's tool changes (gcode `toolChanges`), looked up in the tool table,
 * as the carve worker's per-change-point list in sent-line indices, and the
 * lines that will not be carved, with why, for the key ("Lines 12–340 not
 * carved: T3 is not in your tool table"). Pure. Display only.
 *
 * A line whose tool is unknown (no tool change before it, an M6 with no T,
 * a T number not in the tool table) carves nothing: a size is never
 * guessed. Only feeds and arcs count for the note; a rapid alone is not
 * called an uncarved cut.
 */
import { NO_TOOL, type ToolChanges } from '@synthetos/gcode';
import { SEGMENT, type CarveToolTable, type SegmentList, type ToolShape } from '@synthetos/gcode-view';
import { notInTable, toolNumbered, type ToolTableEntry } from './activeTool.ts';

export interface CarvePlan {
  readonly tools: CarveToolTable;
  /** Plain notes for the key, one per run of uncarved cutting lines. */
  readonly uncarved: readonly string[];
}

/** Most uncarved runs named in the key; the rest are counted. */
export const MAX_UNCARVED_NOTES = 3;

export const NO_CHANGE_REASON = 'no tool change before them';
export const NO_T_REASON = 'the tool change names no tool';

/** The first sent-line index whose file line is at or after `fileLine` (sent lines are in file order). */
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

/** True when sent line `i` draws a feed or arc segment that is not uncertain. */
function cuts(segments: Pick<SegmentList, 'kinds' | 'lineToVertex'>, i: number): boolean {
  const { kinds, lineToVertex } = segments;
  for (let v = lineToVertex[i] as number; v < (lineToVertex[i + 1] as number); v++) {
    const k = kinds[v] as number;
    if ((k & SEGMENT.UNCERTAIN) !== 0) continue;
    if (k === SEGMENT.FEED || k === SEGMENT.ARC) return true;
  }
  return false;
}

const range = (a: number, b: number): string => (a === b ? `Line ${String(a)}` : `Lines ${String(a)}–${String(b)}`);

/** The carve worker's tools and the key's uncarved notes, for a file's tool changes and the tool table. */
export function carvePlan(changes: Pick<ToolChanges, 'lines' | 'tools'>, sourceLines: Uint32Array, segments: Pick<SegmentList, 'kinds' | 'lineToVertex'>, table: readonly ToolTableEntry[]): CarvePlan {
  const starts: number[] = [0];
  const shapes: (ToolShape | null)[] = [null];
  const reasons: (string | null)[] = [NO_CHANGE_REASON];
  for (let k = 0; k < changes.lines.length; k++) {
    const start = firstSentAt(sourceLines, changes.lines[k] as number);
    const t = changes.tools[k] as number;
    const shape = t === NO_TOOL ? null : toolNumbered(t, table).shape;
    const reason = t === NO_TOOL ? NO_T_REASON : shape === null ? notInTable(t) : null;
    // A change on the first sent line (or two at one line) replaces the entry there.
    if (starts[starts.length - 1] === start) {
      shapes[shapes.length - 1] = shape;
      reasons[reasons.length - 1] = reason;
    } else {
      starts.push(start);
      shapes.push(shape);
      reasons.push(reason);
    }
  }
  const lines = segments.lineToVertex.length - 1;
  const runs: string[] = [];
  for (let s = 0; s < starts.length; s++) {
    const reason = reasons[s];
    if (reason == null) continue;
    const end = Math.min(lines, starts[s + 1] ?? lines);
    let first = -1;
    let last = -1;
    for (let i = starts[s] as number; i < end; i++) {
      if (!cuts(segments, i)) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first >= 0) runs.push(`${range(sourceLines[first] as number, sourceLines[last] as number)} not carved: ${reason}`);
  }
  const uncarved = runs.length <= MAX_UNCARVED_NOTES ? runs : [...runs.slice(0, MAX_UNCARVED_NOTES), `${String(runs.length - MAX_UNCARVED_NOTES)} more runs of lines not carved`];
  return { tools: { starts: Uint32Array.from(starts), shapes }, uncarved };
}
