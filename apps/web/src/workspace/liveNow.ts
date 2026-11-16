/** True while a machine is connected in this tab (any LIVE state, or a port opening): sign-in and sign-out are refused then (T-S58). */
import { connected, type WorkspaceModel } from './model.ts';

export function liveNow(model: WorkspaceModel | null): boolean {
  const view = model?.live.value ?? null;
  if (view === null) return false;
  return connected(view) || view.entry.step === 'live' || view.entry.step === 'opening';
}
