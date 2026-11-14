import type { MachineReply, MachineRequest } from './rpc.ts';
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
