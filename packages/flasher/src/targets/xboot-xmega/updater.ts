/**
 * TinyG's xboot on the ATxmega192A3 as an updater target (core/updater.ts). A thin adapter: every step is the
 * existing code, unchanged (ihex.ts and plan.ts prepare, client.ts detects, flashRun.ts writes, backs up and checks
 * the CRC, toIntelHex turns an image backup back into an image).
 */
import type { ByteLink, FlasherClock } from '../../core/link.ts';
import type { Updater } from '../../core/updater.ts';
import { XbootClient, type Identity } from './client.ts';
import { runFlash, type FlashHooks, type FlashOptions, type FlashOutcome } from './flashRun.ts';
import { parseIntelHex, toIntelHex } from './ihex.ts';
import { X192A3 } from './part.ts';
import { planFlash, type FlashPlan } from './plan.ts';

/** The backup this target restores: the whole application section as read before a flash. */
export interface XbootImageBackup {
  readonly flash: Uint8Array;
}

function prepare(text: string): { readonly ok: true; readonly plan: FlashPlan } | { readonly ok: false; readonly reason: string } {
  const parsed = parseIntelHex(text, X192A3);
  return parsed.ok ? { ok: true, plan: planFlash(parsed.image, null) } : { ok: false, reason: parsed.error.message };
}

export const xbootXmega: Updater<XbootClient, Identity, FlashPlan, FlashHooks, FlashOptions, FlashOutcome, XbootImageBackup> = Object.freeze({
  family: 'tinyg-xmega' as const,
  bootloader: 'TinyG xboot (AVR109)',
  prepare,
  async detect(link: ByteLink, clock: FlasherClock, deadlineMs: number) {
    const session = new XbootClient(link, clock, X192A3);
    await session.enter(deadlineMs);
    return { session, identity: await session.identify() };
  },
  write: (session: XbootClient, plan: FlashPlan, hooks: FlashHooks, options: FlashOptions) => runFlash(session, plan, hooks, options),
  verify: (outcome: FlashOutcome) => outcome.ok,
  restore: (backup: XbootImageBackup) => prepare(toIntelHex(backup.flash, X192A3)),
});
