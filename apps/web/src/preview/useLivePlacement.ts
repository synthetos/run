/**
 * The Run view's live placement (livePlacement.ts) as a hook: the scene is rebuilt only when the path's zero moves
 * past report rounding, whether the position is established, or the G92 note changes, not on every status report,
 * so the renderer keeps its uploaded solids while the tool moves. Without a planned scene the tool is given in the
 * path's own frame, so the preview still draws it on the path.
 */
import { useMemo, useRef } from 'preact/hooks';
import type { Vec3 } from '@synthetos/gcode-view';
import { liveTool, pathZero, placeLive, positionEstablished, toolInPath, type LiveReport } from './livePlacement.ts';
import { PLANNED_FRAME, type LivePathFrame } from './pathFrame.ts';
import { liveFrame, type JobScene } from './sceneModel.ts';

/** The frame the placement takes, from the open file's preview and the worker's job (pathFrame.ts). */
export { useLivePathFrame } from './pathFrame.ts';

/**
 * Below this a change of the path's zero is report rounding, not a move: `mpo` and `pos` are each rounded to 3
 * decimals, so machine minus work position wanders by about 1 µm in mm, and by up to 26 µm in inches (0.001 in
 * steps). Such a change does not rebuild the scene.
 */
export const ZERO_STEADY_MM = 0.03;

/** The zero to key the scene on: `held` until `next` moves more than `tol` from it on some axis (or either is null). */
export function steadyZero(held: Vec3 | null, next: Vec3 | null, tol = ZERO_STEADY_MM): Vec3 | null {
  if (held === null || next === null) return next;
  return next.some((v, i) => Math.abs(v - (held[i] as number)) > tol) ? next : held;
}

export function useLivePlacement(planned: JobScene | null, live: LiveReport | null, path: LivePathFrame = PLANNED_FRAME): { readonly scene: JobScene | null; readonly tool: Vec3 | null } {
  const frame = live === null ? null : liveFrame(live);
  const established = live !== null && positionEstablished(live);
  const held = useRef<Vec3 | null>(null);
  held.current = steadyZero(held.current, frame === null ? null : pathZero(frame, path.toPath));
  const z = held.current;
  const known = live !== null && frame !== null;
  const home = live?.home;
  const t = path.toPath;
  // `known`, `established` and `home` (which note), the path's zero (past report rounding) and the G92 note decide the scene; the tool alone moves the marker.
  const placed = useMemo(() => (planned === null ? null : placeLive(planned, known ? live : null, path)), [planned, known, established, home, z?.[0], z?.[1], z?.[2], path.nextG92]);
  if (!known) return { scene: placed?.scene ?? planned, tool: null };
  if (planned === null || placed === null) return { scene: null, tool: toolInPath(frame, t) };
  return { scene: placed.scene, tool: liveTool(planned, live, t) };
}
