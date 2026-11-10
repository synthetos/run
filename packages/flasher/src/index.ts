/**
 * @synthetos/flasher
 *
 * Firmware flasher: manifest, Intel HEX validation, page planner, xboot client and guard filter.
 *
 * Layout (the modular updater, owner 2026-11-09; see README.md):
 * - `core/`: the byte link, SHA-256 and the `Updater` interface every target implements;
 * - `targets/xboot-xmega/`: TinyG's xboot on the ATxmega192A3 (unchanged code, moved);
 * - `targets/index.ts`: the target table keyed by board family;
 * - `authorize.ts` and `bootloaderCapability.ts`: the gate in front of every target (the mint stays here).
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

export { X192A3, appPages, partByName } from './targets/xboot-xmega/part.ts';
export type { Part } from './targets/xboot-xmega/part.ts';
export { MAX_HEX_TEXT_BYTES, installMarkerAt, isResetVector, parseIntelHex, toIntelHex } from './targets/xboot-xmega/ihex.ts';
export type { HexError, HexErrorCode, HexImage, HexParse } from './targets/xboot-xmega/ihex.ts';
export { bootloaderJump, planFlash } from './targets/xboot-xmega/plan.ts';
export type { FlashPlan, PageWrite } from './targets/xboot-xmega/plan.ts';
export { crc16, crc16Update } from './targets/xboot-xmega/crc16.ts';
export { isSha256, sha256Hex } from './core/sha256.ts';
export { CommandError, FORBIDDEN_OPCODES, FrameGuard, MEMORY, OPCODES, REPLY, SECTION_APPLICATION, encodeCommand, replyLength } from './targets/xboot-xmega/avr109.ts';
export type { Command, CommandOp, FrameRefusal, FrameVerdict, Opcode } from './targets/xboot-xmega/avr109.ts';
export { ByteBuffer, LinkClosed, LinkTimeout } from './core/link.ts';
export type { ByteLink, FlasherClock } from './core/link.ts';
export { DEFAULT_TIMINGS, XbootClient, XbootError, toXbootError } from './targets/xboot-xmega/client.ts';
export type { ClientTimings, Identity, XbootErrorCode } from './targets/xboot-xmega/client.ts';
export { recoverEntry, runFlash } from './targets/xboot-xmega/flashRun.ts';
export type { FlashBackups, FlashHooks, FlashOptions, FlashOutcome, FlashPhase, FlashProgress } from './targets/xboot-xmega/flashRun.ts';
export { MAX_OPENS, authorizeFlash } from './authorize.ts';
export type { Authorized, BoardFacts, FlashAuthorization, FlashCheck, FlashRefusal, FlashSource } from './authorize.ts';

// The modular updater (core/updater.ts): the interface and the target table.
export { UPDATER_TARGETS, updaterFor } from './targets/index.ts';
export { xbootXmega } from './targets/xboot-xmega/updater.ts';
export type { XbootImageBackup } from './targets/xboot-xmega/updater.ts';
export type { BoardFamily, Prepared, Updater, UpdaterProgress } from './core/updater.ts';
