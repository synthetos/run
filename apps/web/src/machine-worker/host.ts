/** Workspace host binds the full session and command adapters at import time. */
import { MachineWorkerCore } from './hostCore.ts';
import { workspaceRole } from './workspaceRole.ts';
import type { MachineSession } from '@synthetos/machine';
import type { HostOptions } from './hostRole.ts';
export { realClock, workerPlatform, workerState, SNAPSHOT_INTERVAL_MS } from './hostCore.ts';
export type { SnapshotPort, WorkerApproval } from './hostCore.ts';
export class MachineWorkerHost extends MachineWorkerCore {
  constructor(...options: HostOptions) { super(workspaceRole, ...options); }
  override get session(): MachineSession { return super.session as MachineSession; }
}
