/**
 * What the view frames (first-time walk 2026-11-08, C19): the job, not the bed. The default view and Fit frame the
 * toolpath and the solids the job stands on or in (the stock, its fixture and clamps), so on a 750 mm bed a
 * 180 mm stock and its toolpath fill the view instead of a corner of it. With neither a path nor a job solid (an
 * empty scene, or a scene with a bed alone) it falls back to everything drawn.
 */
import type { Box3 } from './segments.ts';
import { sceneBounds, unionBox, type SceneLayers } from './scene.ts';

/** Scene solids the view frames with the path: the job's own, never the bed. */
export const FRAMED_TAGS: ReadonlySet<string> = new Set(['stock', 'fixture', 'clamp']);

/** The box of the scene's job solids (stock, fixture, clamps), or null when it has none. */
export function jobSolidsBox(scene: SceneLayers | null): Box3 | null {
  if (scene === null) return null;
  const solids = scene.solids.filter((s) => s.tag !== undefined && FRAMED_TAGS.has(s.tag));
  return solids.length === 0 ? null : sceneBounds({ solids, rings: [] });
}

/** The box to frame: the path (in the drawing's frame) with the job's solids, else `everything`. */
export function framedBox(path: Box3 | null, scene: SceneLayers | null, everything: Box3 | null): Box3 | null {
  return unionBox(path, jobSolidsBox(scene)) ?? everything;
}
