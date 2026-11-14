/** A separate host class fixes the firmware role before any page request arrives. */
import { MachineWorkerCore } from './hostCore.ts';
import { firmwareRole } from './firmwareRole.ts';
import type { HostOptions } from './hostRole.ts';
export class FirmwareWorkerHost extends MachineWorkerCore {
  constructor(...options: HostOptions) { super(firmwareRole, ...options); }
}
