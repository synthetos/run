/** Override refusals belong to the controls, not the legacy job-flag diagnostic. */
import { onJobRuntimeAnswer } from '../job.ts';
import { parseOverrideLine } from './model.ts';
export function onWorkspaceRuntimeAnswer(...args: Parameters<typeof onJobRuntimeAnswer>): void {
  const [, entry] = args;
  if (entry.line !== undefined && parseOverrideLine(entry.line) !== null) return;
  onJobRuntimeAnswer(...args);
}
