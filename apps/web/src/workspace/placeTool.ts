/**
 * The tool radius Place job's margins add (placeMargins.ts): the largest radius among the tools that cut the open
 * file, looked up in the tool table (the tool chosen in Analyze counts for the cuts before the first tool change).
 * Null when any cutting tool's size is not known: a margin is never widened by a guess. Pure.
 */
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import type { ToolTableEntry } from '../preview/activeTool.ts';
import { toolLegend } from '../preview/toolSlots.ts';

export function cutToolRadius(result: Pick<PreviewResult, 'tools' | 'sourceLines' | 'segments'>, table: readonly ToolTableEntry[], spindleTool: number | null): number | null {
  if (result.segments === null) return null;
  const { entries } = toolLegend(result.tools, result.sourceLines, result.segments, table, spindleTool);
  if (entries.length === 0 || entries.some((e) => !e.known || e.number === null)) return null;
  let r = 0;
  for (const e of entries) {
    const d = table.find((t) => t.number === e.number)?.tool.geometry.diameter;
    if (d === undefined || !(d > 0)) return null;
    r = Math.max(r, d / 2);
  }
  return r;
}
