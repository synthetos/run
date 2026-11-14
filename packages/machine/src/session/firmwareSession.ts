/** Firmware role is selected by the importing worker entry, never by an RPC message. */
import { SessionExecutor, type MachineSessionOptions } from './sessionExecutor.ts';
import { firmwareRuntime } from './firmwareRuntime.ts';
export class FirmwareSession extends SessionExecutor {
  constructor(options: MachineSessionOptions) { super(options, firmwareRuntime); }
}
