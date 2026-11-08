/**
 * The active tool per line (docs/design/tool-sim.md, slice 1): a compact
 * change-point table, file line -> T number, for each tool change in the
 * sanitised lines, beside the interpreter. Display only: nothing here is
 * sent or gates a line.
 *
 * Semantics (RS274NGC 3.7.3; @cite EN canonical_machine.c:1544-1574,
 * gcode_parser.c:499,536,642-643): `T` stores a tool select and changes
 * nothing; `M6` makes the selected tool the active one. In one block the T
 * word runs before M6, so `T1 M6` changes to T1; `T1` then `M6` on a later
 * line also changes to T1, the last T before it. A `T` with no M6 after it
 * selects only. Before the first M6 the active tool is unknown. This is also
 * the sanitiser's model of a tool change (safety `ToolChange.tool`: "its T
 * word, or the last T before it"), which the job's tool-change stop uses.
 *
 * TinyG master and TinyG2 queue the select, so their M6 can read the previous
 * selection, a bug their own comments note (@cite TG canonical_machine.c:1031-1055;
 * TinyG2 canonical_machine.cpp:978-1014). Edge-next sets it at once. The
 * table follows the file's intent on every dialect.
 */
import type { SentLine } from '@synthetos/safety';
import { codeOf, parseLine } from './parser.ts';
import { KIND, type JobAnalysis } from './types.ts';

/** No tool selected when an M6 ran (`ToolChanges.tools`). */
export const NO_TOOL = -1;

export interface ToolChanges {
  /** 1-based file line of each tool change (M6), ascending. */
  readonly lines: Uint32Array;
  /** The T number each change makes active, or `NO_TOOL` when no T was selected before it. */
  readonly tools: Int32Array;
  /** 1-based file line of the first cutting move (feed or arc), or 0 when the file never cuts. */
  readonly firstCut: number;
}

/** The change points of the sanitised lines, and the first cut from the analysis' segment kinds. */
export function toolChanges(lines: readonly Pick<SentLine, 'body' | 'sourceLine'>[], analysis: Pick<JobAnalysis, 'kinds' | 'lineToVertex'>): ToolChanges {
  const at: number[] = [];
  const tools: number[] = [];
  let selected = NO_TOOL;
  for (const line of lines) {
    let change = false;
    for (const w of parseLine(line.body).words) {
      if (w.letter === 'T' && Number.isInteger(w.value) && w.value >= 0) selected = w.value;
      else if (codeOf(w) === 'M6') change = true;
    }
    if (!change) continue;
    // Two changes on one file line (an inserted line and its own): the later one stands.
    if (at.length > 0 && at[at.length - 1] === line.sourceLine) tools[tools.length - 1] = selected;
    else {
      at.push(line.sourceLine);
      tools.push(selected);
    }
  }
  return { lines: Uint32Array.from(at), tools: Int32Array.from(tools), firstCut: firstCutLine(lines, analysis) };
}

/** File line of the first sent line that draws a feed or arc segment, or 0. */
function firstCutLine(lines: readonly Pick<SentLine, 'sourceLine'>[], analysis: Pick<JobAnalysis, 'kinds' | 'lineToVertex'>): number {
  const { kinds, lineToVertex } = analysis;
  for (let i = 0; i + 1 < lineToVertex.length && i < lines.length; i++) {
    for (let v = lineToVertex[i] as number; v < (lineToVertex[i + 1] as number); v++) {
      const k = (kinds[v] as number) & ~KIND.UNCERTAIN;
      if (k === KIND.FEED || k === KIND.ARC) return (lines[i] as Pick<SentLine, 'sourceLine'>).sourceLine;
    }
  }
  return 0;
}

/** The index of the change in force at a file line (a change applies to its own line), or -1 before the first. */
export function changeAt(changes: Pick<ToolChanges, 'lines'>, fileLine: number): number {
  const at = changes.lines;
  let lo = 0;
  let hi = at.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((at[mid] as number) <= fileLine) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** The T number active at a file line, or null when it is unknown (no M6 yet, or an M6 with no T selected). */
export function activeToolAt(changes: Pick<ToolChanges, 'lines' | 'tools'>, fileLine: number): number | null {
  const i = changeAt(changes, fileLine);
  const t = i < 0 ? NO_TOOL : (changes.tools[i] as number);
  return t === NO_TOOL ? null : t;
}
