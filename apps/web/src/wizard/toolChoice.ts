/**
 * Step 5's tool choice (spec §6.3 step 5), pure: the tool is whichever entry the catalog or the tool editor added
 * while the step (or the catalog page) was open, the newest when there are several.
 */
import type { ToolEntry } from '../workspace/library.ts';

/** The newest entry added since `before`, or null. */
export function newToolSince(before: readonly ToolEntry[], after: readonly ToolEntry[]): ToolEntry | null {
  const known = new Set(before.map((e) => e.tool.id));
  for (let i = after.length - 1; i >= 0; i -= 1) {
    const entry = after[i];
    if (entry !== undefined && !known.has(entry.tool.id)) return entry;
  }
  return null;
}
