/**
 * @synthetos/testkit
 *
 * DEV ONLY. Firmware models, MockSerial, fault plans, virtual clock and replay transport for tests. Never part of a production bundle.
 *
 * No production entry graph may import this package (RUN_PLAN §5.3, T-S40).
 * Honesty rule (RUN_PLAN §8.1): every model behaviour a safety claim depends
 * on carries `@cite` and `@status`; `STATUS.md` (generated) lists them, and
 * the UNVERIFIED ones for the release checklist.
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

/**
 * Marker export that identifies the test kit. The bundle scan (P0-13, T-S40)
 * fails a production build that contains this literal.
 */
export const TESTKIT_MARKER = '__SYNTHETOS_TESTKIT_DEV_ONLY__';

export { VirtualClock, settle } from './clock.ts';
export type { Clock } from './clock.ts';
export { SeededRng } from './rng.ts';
export { bytes, escapeBytes, text } from './bytes.ts';
export { Transcript } from './transcript.ts';
export type { TranscriptEntry, TranscriptKind } from './transcript.ts';
export { NO_FAULTS, validateFaultPlan } from './faults.ts';
export type { ByteSelector, Direction, Fault, FaultPlan } from './faults.ts';
export type { DeviceIo, FaultTarget, SimDevice } from './device.ts';
export { SimEndpoint } from './endpoint.ts';
export type { LinkOptions, SimEndpointOptions } from './endpoint.ts';
export { SimHost, createSim } from './simHost.ts';
export type { Sim } from './simHost.ts';
export { MockSerialPort } from './mockSerialPort.ts';
export type { MockSerialPortOptions, SerialInputSignals, SerialOptions, SerialOutputSignals, SerialPortInfo } from './mockSerialPort.ts';
export { ReplayTransport, recordingFromTranscript } from './replay.ts';
export type { Recording, RecordingStep, ReplayDivergence, TransportLike } from './replay.ts';
export { TinyGEdgeNextModel } from './firmware/edgeNext.ts';
export { TinyG440Model } from './firmware/tg440.ts';
export { ModelGapError } from './firmware/common.ts';
export type { ModelSnapshot, SideEffect, TinyGModelOptions } from './firmware/common.ts';
export type { EepromImage } from './firmware/settings.ts';
export { BEHAVIOURS, MODEL_LIMITS } from './honesty/behaviours.ts';
export { renderStatus, validateBehaviours } from './honesty/status.ts';
export type { Behaviour, BehaviourStatus, Citation, ModelLimit } from './honesty/types.ts';
