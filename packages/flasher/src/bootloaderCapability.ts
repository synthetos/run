/**
 * The bootloader capability token (ROADMAP P0-12; SAFETY T-S16; OLD-TP §4.2
 * "open() throws if baudRate === 1200 unless it receives a
 * BootloaderCapability token. Only flasher can mint the token").
 *
 * Opening a g2core native USB port at 1200 baud and dropping DTR clears
 * GPNVM1 and resets the SAM3X into the SAM-BA ROM: the board is inert until
 * it is reflashed (PROTOCOL_NOTES §3.3, OLD-PN §3.2; @cite MOT
 * MotateUSBCDC.h:537-548). A bootloader-role port (SAM-BA) is likewise only
 * ever opened by the flasher. The machine Transport guard therefore refuses
 * both unless it is handed a token minted here.
 *
 * Why this cannot be forged:
 * - A token is an opaque frozen object whose identity is recorded in a
 *   module-private `WeakSet`. Membership, not shape, is what counts, so an
 *   object literal or a cast never passes.
 * - Every token is single use: `consumeBootloaderCapability` removes it, so
 *   a token that leaked out of one flash cannot open a second port.
 * - Only `packages/flasher/src` may import this module (dependency-cruiser
 *   rule `bootloader-capability-mint-is-flasher-only`; tests are the one
 *   exception, and only to prove the guard's accepting path). The package
 *   entry re-exports the verifier and the type, never the mint.
 *
 * Phase 0 has no flash path, so nothing in production source mints a token
 * yet. Phase 7 adds the FlashGate (SAFETY §4.6) as a required argument here.
 */

declare const BRAND: unique symbol;

/** Proof that the flasher's gate passed. Opaque: only this module creates one. */
export interface BootloaderCapability {
  readonly [BRAND]: 'BootloaderCapability';
}

const minted = new WeakSet<object>();

/**
 * Mint a single-use token. Flasher-internal: restricted by the boundary gate
 * to `packages/flasher/src` (and tests).
 */
export function mintBootloaderCapability(): BootloaderCapability {
  const token = Object.freeze(Object.create(null) as object);
  minted.add(token);
  return token as BootloaderCapability;
}

/**
 * True exactly once for a token minted here, and false for anything else:
 * a forged object, a primitive, or a token that was already consumed.
 * Consuming is the only way to check a token, so a check can never be
 * separated from its use.
 */
export function consumeBootloaderCapability(candidate: unknown): candidate is BootloaderCapability {
  if (typeof candidate !== 'object' || candidate === null) return false;
  return minted.delete(candidate);
}
