/**
 * The tool the 3D marker shows (activeTool.ts), from the open file, the line it is shown at and the tool table
 * in this browser (`toolStore`). In the preview the line follows the scrubber; while a job runs, the line the
 * board reports executing, with the job's own tool change reconciled in.
 */
import { useMemo } from 'preact/hooks';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import { toolStore } from '../workspace/library.ts';
import { activeTool, previewToolLine, withJobChange, type ActiveTool } from './activeTool.ts';

export interface ActiveToolJob {
  /** The file line executing now, or null. */
  readonly executing: number | null;
  /** The job's tool change it stands at, or null. */
  readonly toolChange?: { readonly line: number; readonly tool: number | null } | null;
}

export function useActiveTool(result: PreviewResult | null, scrub: number, job: ActiveToolJob | null): ActiveTool | null {
  const table = toolStore.value.value;
  const scrubLine = scrub > 0 && result !== null ? (result.sourceLines[scrub - 1] ?? 0) : 0;
  const change = job?.toolChange ?? null;
  const executing = job?.executing ?? null;
  return useMemo(() => {
    if (result === null) return null;
    const changes = withJobChange(result.tools, change);
    return activeTool(changes, executing ?? previewToolLine(scrubLine, changes), table);
  }, [result, scrubLine, executing, change?.line, change?.tool, table]);
}
