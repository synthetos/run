/**
 * The Run view's live placement (livePlacement.ts) as a hook: the scene is rebuilt only when the path's zero,
 * whether the position is established, or the G92 note changes, not on every status report, so the renderer
 * keeps its uploaded solids while the tool moves. Without a planned scene the tool is given in the path's own
 * frame, so the preview still draws it on the path.
 */
import { useMemo } from 'preact/hooks';
import type { Vec3 } from '@synthetos/gcode-view';
import { liveTool, pathZero, placeLive, positionEstablished, toolInPath, type LiveReport } from './livePlacement.ts';
import { PLANNED_FRAME, type LivePathFrame } from './pathFrame.ts';
import { liveFrame, type JobScene } from './sceneModel.ts';

/** The frame the placement takes, from the open file's preview and the worker's job (pathFrame.ts). */
export { useLivePathFrame } from './pathFrame.ts';

export function useLivePlacement(planned: JobScene | null, live: LiveReport | null, path: LivePathFrame = PLANNED_FRAME): { readonly scene: JobScene | null; readonly tool: Vec3 | null } {
  const frame = live === null ? null : liveFrame(live);
  const established = live !== null && positionEstablished(live);
  const z = frame === null ? null : pathZero(frame, path.toPath);
  const known = live !== null && frame !== null;
  const home = live?.home;
  const t = path.toPath;
  // `known`, `established` and `home` (which note), the path's zero and the G92 note decide the scene; the tool alone moves the marker.
  const placed = useMemo(() => (planned === null ? null : placeLive(planned, known ? live : null, path)), [planned, known, established, home, z?.[0], z?.[1], z?.[2], t[0], t[1], t[2], path.nextG92]);
  if (!known) return { scene: placed?.scene ?? planned, tool: null };
  if (planned === null || placed === null) return { scene: null, tool: toolInPath(frame, t) };
  return { scene: placed.scene, tool: liveTool(planned, live, t) };
}
