/**
 * @synthetos/flasher
 *
 * Firmware flasher: manifest, Intel HEX validation, page planner, xboot client and guard filter.
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 *
 * Bootloader citations (`XB`) are to TinyG's xboot, synthetos/tg-xboot @
 * 29d08013 (vendor/firmware-pins.json).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

// The verifier and the type only. The mint stays flasher-internal (ROADMAP P0-12): authorize.ts hands out
// tokens through a FlashAuthorization, which only authorizeFlash creates.
export { consumeBootloaderCapability } from './bootloaderCapability.ts';
export type { BootloaderCapability } from './bootloaderCapability.ts';

export { X192A3, appPages, partByName } from './part.ts';
export type { Part } from './part.ts';
export { MAX_HEX_TEXT_BYTES, installMarkerAt, isResetVector, parseIntelHex, toIntelHex } from './ihex.ts';
export type { HexError, HexErrorCode, HexImage, HexParse } from './ihex.ts';
export { bootloaderJump, planFlash } from './plan.ts';
export type { FlashPlan, PageWrite } from './plan.ts';
export { crc16, crc16Update } from './crc16.ts';
export { isSha256, sha256Hex } from './sha256.ts';
export { CommandError, FORBIDDEN_OPCODES, FrameGuard, MEMORY, OPCODES, REPLY, SECTION_APPLICATION, encodeCommand, replyLength } from './avr109.ts';
export type { Command, CommandOp, FrameRefusal, FrameVerdict, Opcode } from './avr109.ts';
export { ByteBuffer, LinkClosed, LinkTimeout } from './link.ts';
export type { ByteLink, FlasherClock } from './link.ts';
export { DEFAULT_TIMINGS, XbootClient, XbootError, toXbootError } from './client.ts';
export type { ClientTimings, Identity, XbootErrorCode } from './client.ts';
export { recoverEntry, runFlash } from './flashRun.ts';
export type { FlashBackups, FlashHooks, FlashOptions, FlashOutcome, FlashPhase, FlashProgress } from './flashRun.ts';
export { MAX_OPENS, authorizeFlash } from './authorize.ts';
export type { Authorized, BoardFacts, FlashAuthorization, FlashCheck, FlashRefusal, FlashSource } from './authorize.ts';
