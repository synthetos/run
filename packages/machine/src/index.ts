/**
 * @synthetos/machine
 *
 * Machine path: Transport interface, MachineSession statechart (the single writer), flow engines, streamer, watchdog and stop sequences.
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export type { Transport, TransportInfo, TransportOpenOptions, TransportSource } from './transport.ts';
export { GuardedTransport, TransportRefusedError, TransportWriteError } from './guardedTransport.ts';
export type { GuardedTransportState, TransportRefusalCode } from './guardedTransport.ts';
export { MAX_REALTIME_GROUP_BYTES, MAX_WRITE_LINE_BYTES, REALTIME_BYTES, classifyWrite } from './writeShape.ts';
export type { WriteRejection, WriteRejectionReason, WriteShape } from './writeShape.ts';
export {
  BOOTLOADER_PORTS,
  BOOTLOADER_TOUCH_BAUD,
  CAPABILITY_BAUD_RATES,
  DUE_PROGRAMMING_PORT,
  REFUSED_PORTS,
  SESSION_BAUD_RATES,
  TRANSPORT_BUFFER_SIZE,
  capabilityBaudRatesOf,
  decideOpen,
  refusedPortsOf,
} from './openPolicy.ts';
export type { OpenDecision, OpenRefusalReason } from './openPolicy.ts';
