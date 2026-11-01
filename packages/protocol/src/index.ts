/**
 * @synthetos/protocol
 *
 * Wire protocol for Synthetos controllers: framing, inbound classification, dialect data, capability probe and classifier, read allowlists.
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 *
 * Firmware citations (`@cite`) use the PROTOCOL_NOTES §1 tags, pinned here
 * until P0-08 records them in `vendor/firmware-pins.json` (PIN-1):
 * - `EN`: TinyG `edge-next` @ ead63997 (`firmware/tinyg/`; `tests/hil/` for EN-HIL).
 * - `TG`: TinyG master @ d041839, build 440.21 (`firmware/tinyg/`).
 * - `G2`, `OLD-PN`: as PROTOCOL_NOTES §1.
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export type {
  Ack,
  Banner,
  ClassifiedLine,
  Exception,
  FlowSignal,
  Footer,
  Garbled,
  GarbledReason,
  Inbound,
  JsonArray,
  JsonObject,
  JsonValue,
  QueueReport,
  Response,
  StatusReport,
  Text,
} from './types.ts';
export { DEFAULT_JSON_LIMITS, parseJson, parseJsonObject } from './json.ts';
export type { JsonErrorReason, JsonLimits, JsonObjectParseResult, JsonParseResult } from './json.ts';
export { MAX_LINE_BYTES, XOFF, XON, createFramer } from './frame.ts';
export type { FrameEvent, FramedLine, Framer } from './frame.ts';
export { MAX_TID, READY_MESSAGE, checksum440, classifyLine, parseFooter } from './classify.ts';
export { createInboundDecoder, decodeInbound } from './inbound.ts';
export type { InboundDecoder } from './inbound.ts';
