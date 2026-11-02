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

export type { PortSelector, Transport, TransportInfo, TransportOpenOptions, TransportSource } from './transport.ts';
export { isPortSelector } from './transport.ts';
export { GuardedTransport, TransportRefusedError, TransportWriteError } from './guardedTransport.ts';
export type { GuardedTransportOptions, GuardedTransportState, TransportRefusalCode } from './guardedTransport.ts';
export { MAX_REALTIME_GROUP_BYTES, MAX_WRITE_LINE_BYTES, REALTIME_BYTES, classifyWrite, writeLineCapFor } from './writeShape.ts';
export type { WriteRejection, WriteRejectionReason, WriteShape } from './writeShape.ts';
export {
  BOOTLOADER_PORTS,
  BOOTLOADER_TOUCH_BAUD,
  CAPABILITY_BAUD_RATES,
  DUE_PROGRAMMING_PORT,
  REFUSED_PORTS,
  SESSION_BAUD_RATES,
  SESSION_OPEN_OPTIONS,
  TRANSPORT_BUFFER_SIZE,
  capabilityBaudRatesOf,
  decideOpen,
  refusedPortsOf,
  sessionOpenOptionsFor,
  sharedSessionOptions,
} from './openPolicy.ts';
export type { OpenDecision, OpenRefusalReason } from './openPolicy.ts';
export * from './session/index.ts';
export { liveControlPlatform } from './platform.ts';
export type { PlatformDecision, PlatformInfo } from './platform.ts';
export { checkSelection, suggestMachines } from './suggest.ts';
export type { MachineCandidate, MachineSuggestion, ProbedBoard, SelectionCheck } from './suggest.ts';
export { EVENT_LOG_MAX_BYTES, EventLog, EventLogTruncatedError, toHex, wireEventsToJsonl } from './eventLog.ts';
export type { WireDirection, WireEvent } from './eventLog.ts';
export { MPO_POLL_ANSWER_MS, MPO_POLL_MS, MPO_TOKEN, PositionPoller, positionPollable } from './positionPoller.ts';
export type { PollTarget, PositionPollerOptions } from './positionPoller.ts';
export { DRO_AXES, LAG_AMBER_MS, LAG_RED_MS, droView, lagOf } from './dro.ts';
export type { DroAxis, DroMarker, DroView, DroWcs, Lag } from './dro.ts';
