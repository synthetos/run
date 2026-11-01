/**
 * Starts `machine.worker` from the workspace page (ROADMAP P0-14; RUN_PLAN
 * §5.4).
 *
 * The worker's URL comes from the build (Vite `?worker&url`: a hashed
 * `/assets/machine.worker-*.js` chunk) and goes through the `rs-worker`
 * Trusted Types policy (security/tt.ts), the only way the production CSP
 * lets a page start a worker. Without Trusted Types (not a supported
 * browser) the worker is not started: fail closed.
 *
 * Phase 0 starts the worker and sends it nothing. The heartbeat, the
 * visibility messages and the connect flow come with Phase 1.
 */
import type { RunTrustedTypes } from '../security/tt.ts';
import type { MachineReply, MachineRequest } from './rpc.ts';
import machineWorkerUrl from './machine.worker.ts?worker&url';

/** The worker's name, as `self.name` inside it and in browser tooling. */
export const MACHINE_WORKER_NAME = 'machine';

export function startMachineWorker(tt: RunTrustedTypes | null): Worker | null {
  if (tt === null) return null;
  // A TrustedScriptURL is what the Worker constructor needs under the CSP;
  // the DOM typings know only strings and URLs.
  const url = tt.workerScriptUrl(machineWorkerUrl) as unknown as string;
  return new Worker(url, { type: 'module', name: MACHINE_WORKER_NAME });
}

/** The parts of a Worker `callMachineWorker` uses. */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
}

/** Sends one request with its own reply port and resolves with the worker's first answer. */
export function callMachineWorker(worker: WorkerLike, request: MachineRequest): Promise<MachineReply> {
  const channel = new MessageChannel();
  return new Promise((resolve) => {
    channel.port1.onmessage = (event: MessageEvent) => {
      channel.port1.close();
      resolve(event.data as MachineReply);
    };
    worker.postMessage(request, [channel.port2]);
  });
}
