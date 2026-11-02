/**
 * Spawns the real `gcode.worker` through the `rs-worker` Trusted Types
 * policy (ROADMAP TB-03). Kept apart from the client so that the components
 * the build prerenders never import the worker URL; only the workspace entry
 * imports this module.
 */
import type { RunTrustedTypes } from '../security/tt.ts';
import { GCODE_WORKER_NAME, type WorkerLike } from './client.ts';
import gcodeWorkerUrl from './gcode.worker.ts?worker&url';

/** Spawns the real worker; null without Trusted Types (fail closed). */
export function gcodeWorkerSpawner(tt: RunTrustedTypes | null): (() => WorkerLike) | null {
  if (tt === null) return null;
  return () => new Worker(tt.workerScriptUrl(gcodeWorkerUrl) as unknown as string, { type: 'module', name: GCODE_WORKER_NAME }) as unknown as WorkerLike;
}
