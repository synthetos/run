/**
 * Spawns the real `carve.worker` through the `rs-worker` Trusted Types policy (docs/design/tool-sim.md,
 * slice 2), as gcode-worker/spawn.ts does for the preview worker. Only the workspace entry imports this, so
 * the prerendered components never import the worker URL.
 */
import type { CarveWorkerLike } from '@synthetos/gcode-view';
import type { RunTrustedTypes } from '../security/tt.ts';
import carveWorkerUrl from './carve.worker.ts?worker&url';

export const CARVE_WORKER_NAME = 'carve';

/** Spawns the real worker; null without Trusted Types (fail closed: no carving). */
export function carveWorkerSpawner(tt: RunTrustedTypes | null): (() => CarveWorkerLike) | null {
  if (tt === null) return null;
  return () => new Worker(tt.workerScriptUrl(carveWorkerUrl) as unknown as string, { type: 'module', name: CARVE_WORKER_NAME }) as unknown as CarveWorkerLike;
}
