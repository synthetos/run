import type { RunTrustedTypes } from '../security/tt.ts';
import firmwareWorkerUrl from './firmware.worker.ts?worker&url';
/** Separate entry URL, never selected by a caller-supplied mode flag. */
export function startFirmwareWorker(tt: RunTrustedTypes | null): Worker | null {
  if (tt === null) return null;
  return new Worker(tt.workerScriptUrl(firmwareWorkerUrl) as unknown as string, { type: 'module', name: 'firmware-update' });
}
