/**
 * @synthetos/protocol
 *
 * Wire protocol for Synthetos controllers: framing, inbound classification, dialect data, capability probe and classifier, signed approved-builds manifest, signed firmware release list.
 *
 * The read allowlists and forbidden writes are NOT here: they are generated
 * from the vendored HIL tables and live in `@synthetos/schema`
 * (`readAllowlistFor(dialectId)`, `FORBIDDEN_WRITES`), keyed by `DialectId`.
 * RUN_PLAN §5.5 sketches them as `Dialect.readAllowlist` and
 * `Dialect.forbiddenWrites`; that deviation is recorded in
 * docs/protocol/notes-amendments.md. `protocol` is the bottom layer and may
 * not import `schema`, so `MachineSession` (machine) joins the two by the
 * classified dialect's id.
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 *
 * Firmware citations (`@cite`) use the PROTOCOL_NOTES §1 tags. The commits
 * are pinned in `vendor/firmware-pins.json` (PIN-1), and a test keeps this
 * list and that file in agreement:
 * - `EN`: TinyG `edge-next` @ 93a723b8 (`firmware/tinyg/`; `tests/hil/` for EN-HIL).
 * - `TG`: TinyG master @ d0418390, build 440.21 (`firmware/tinyg/`).
 * - `S449`: TinyG origin/edge-0.97 @ c5024186, build 449.01 (`firmware/tinyg/`).
 * - `G2`: g2 edge-preview @ 1fb59404 (`g2core/`); `MOT`: its `Motate/MotateProject/motate/`.
 * - `G2W`: the g2 wiki @ 339ec97.
 * - `OLD-PN`: docs/tools/PROTOCOL_NOTES.md of the design.
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export type {
  Ack,
  Heartbeat,
  FeedLimitSummary,
  FeedLimitEvent,
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
  RxReport,
  StatusReport,
  Text,
} from './types.ts';
export { DEFAULT_JSON_LIMITS, JSON_HARD_LIMITS, parseJson, parseJsonObject } from './json.ts';
export type { JsonErrorReason, JsonLimits, JsonObjectParseResult, JsonParseResult } from './json.ts';
export { MAX_LINE_BYTES, XOFF, XON, createFramer } from './frame.ts';
export type { FrameEvent, FramedLine, Framer } from './frame.ts';
export { MAX_RX_REPORT, MAX_TID, READY_MESSAGE, checksum440, classifyLine, parseFooter } from './classify.ts';
export { createInboundDecoder, decodeInbound } from './inbound.ts';
export type { InboundDecoder } from './inbound.ts';
export {
  BUILD_HASH_TOKEN,
  CAPABILITY_TOKENS,
  FSTK_MAX,
  IDENTITY_TOKENS,
  PROBE_STATUS,
  PROBE_STEPS,
  SPLICE_GUARD_LINE,
  COOLANT_PAUSE_TOKEN,
  SPINDLE_PAUSE_TOKEN,
  buildProbeResult,
} from './probe.ts';
export type {
  CapabilityToken,
  IdentityToken,
  ProbeKey,
  ProbeObservations,
  ProbeOutcome,
  ProbeResult,
  ProbeStep,
  SpphAnswer,
  TokenAnswer,
} from './probe.ts';
export {
  APPROVED_BUILDS_FORMAT,
  CHANNEL_PAYLOAD_FORMAT,
  NO_APPROVED_BUILDS,
  SIGNING_PREFIX,
  environmentForOrigin,
  findApproval,
  verifyApprovedBuilds,
} from './approvedBuilds.ts';
export type {
  ApprovedBuild,
  ApprovedBuilds,
  Channel,
  ChannelRejection,
  ChannelVerdict,
  Environment,
  ProbedBoard,
  VerifiedApprovedBuilds,
  VerifyOptions,
} from './approvedBuilds.ts';
export { RELEASE_KEYS } from './releaseKeys.ts';
export type { ReleaseKey } from './releaseKeys.ts';
export * from './dialects/index.ts';
export {
  ADVISORY_PAYLOAD_FORMAT,
  ADVISORY_SIGNING_PREFIX,
  SAFETY_ADVISORY_FORMAT,
  findRevocation,
  verifySafetyAdvisory,
} from './safetyAdvisory.ts';
export type { AdvisoryEnvironment, AdvisoryRejection, AdvisoryVerdict, AdvisoryVerifyOptions, Revocation, SafetyAdvisory } from './safetyAdvisory.ts';
export {
  FIRMWARE_RELEASES_FORMAT,
  FIRMWARE_RELEASES_PAYLOAD_FORMAT,
  FIRMWARE_RELEASES_SIGNING_PREFIX,
  MAX_RELEASE_HEX_BYTES,
  belowMinimum,
  releasesForHardware,
  verifyFirmwareReleases,
} from './firmwareReleases.ts';
export type { FirmwareRelease, FirmwareReleases, HardwareReleases, ReleasesEnvironment, ReleasesRejection, ReleasesVerdict, ReleasesVerifyOptions } from './firmwareReleases.ts';
