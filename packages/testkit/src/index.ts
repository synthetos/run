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

/**
 * Marker export that identifies the test kit. The bundle scan (P0-13, T-S40)
 * fails a production build that contains this literal; marker.ts explains
 * why it survives minification.
 */
export { TESTKIT_MARKER } from './marker.ts';

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

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
export { RecordingFormatError, ReplayDivergenceError, ReplayTransport, recordingFromJsonl, recordingFromTranscript } from './replay.ts';
export type { JsonlRecordingLine, Recording, RecordingStep, ReplayDivergence, TransportLike } from './replay.ts';
export { TinyGEdgeNextModel } from './firmware/edgeNext.ts';
export { TinyG440Model } from './firmware/tg440.ts';
export { ModelGapError } from './firmware/common.ts';
export type { ModelSnapshot, SideEffect, TinyGModelOptions } from './firmware/common.ts';
export type { EepromImage } from './firmware/settings.ts';
export { BEHAVIOURS, MODEL_LIMITS } from './honesty/behaviours.ts';
export { renderStatus, validateBehaviours } from './honesty/status.ts';
export type { Behaviour, BehaviourStatus, Citation, ModelLimit } from './honesty/types.ts';
export { XBOOT_TIMINGS, XB_APP_BYTES, XB_BOOT_BYTES, XB_EEPROM_BYTES, XB_PAGE, XB_SIGNATURE, XbootModel } from './firmware/xboot.ts';
export type { XbootFaults, XbootHost, XbootTimings } from './firmware/xboot.ts';
export { FlashableBoard } from './firmware/flashableBoard.ts';
export type { BoardLineFaults, BoardState, FlashableBoardOptions } from './firmware/flashableBoard.ts';
export { SIM_APP_BYTES, SIM_IMAGES, readSimBuild, simCrc16, simFirmwareImage, simHex, simImage } from './firmware/simFirmware.ts';
export type { SimBuild, SimImageName } from './firmware/simFirmware.ts';
