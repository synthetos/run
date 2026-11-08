/**
 * The Run view's live placement (livePlacement.ts) as a hook: the scene is rebuilt only when the work
 * zero or whether the position is established changes, not on every status report, so the renderer
 * keeps its uploaded solids while the tool moves.
 */
import { useMemo } from 'preact/hooks';
import type { Vec3 } from '@synthetos/gcode-view';
import { liveTool, placeLive, positionEstablished, type LiveReport } from './livePlacement.ts';
import { liveFrame, type JobScene } from './sceneModel.ts';

export function useLivePlacement(planned: JobScene | null, live: LiveReport | null): { readonly scene: JobScene | null; readonly tool: Vec3 | null } {
  const frame = live === null ? null : liveFrame(live);
  const established = live !== null && positionEstablished(live);
  const z = frame?.zero ?? null;
  const known = live !== null && frame !== null;
  const home = live?.home;
  // `known`, `established` and `home` (which note) and the zero decide the scene; the tool alone moves the marker.
  const placed = useMemo(() => (planned === null ? null : placeLive(planned, known ? live : null)), [planned, known, established, home, z?.[0], z?.[1], z?.[2]]);
  if (planned === null || placed === null || !known) return { scene: placed?.scene ?? planned, tool: null };
  return { scene: placed.scene, tool: liveTool(planned, live) };
}
