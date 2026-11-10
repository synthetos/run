/**
 * Resume, as the machine strip offers it: `~` for a hold of this session's motion (SAFETY §4.5b), or the job's own
 * Resume for a paused job of this session (§4.4a). Null when neither applies. Shared by the strip and a typed `~`
 * in the terminal (H91), so both press the same handler.
 */
import type { WorkspaceModel } from './model.ts';

export function resumeAction(model: WorkspaceModel | null | undefined): (() => void) | null {
  const view = model?.live.value ?? null;
  const actions = model?.actions.value ?? null;
  const snapshot = view?.message?.snapshot ?? null;
  if (snapshot?.motion?.held === true && actions?.motion !== undefined) return () => void actions.motion?.({ op: 'resume' });
  if (snapshot?.job?.phase === 'paused' && actions?.job !== undefined) return () => void actions.job?.({ op: 'resume', skip: false, spindleRestart: false });
  return null;
}
