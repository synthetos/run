/** What Run says when a board may be in its bootloader (flashService.ts; the Recovery card shows it). */

/**
 * The banner that clears the mark must arrive while Connect listens (bannerWait.ts), so this never says to
 * power-cycle first: a TinyG prints its banner once, and a person who power-cycles before Connect loses it.
 */
export const BOOTLOADER_ADVICE = 'The board may still be in its bootloader. Normal commands could damage it. Press Connect, then press Reset on the board when Run asks.';

/** A port call passed its deadline (a write, the open or the close): the port is stuck, and only unplugging frees it. */
export const PORT_STUCK_ADVICE = 'The USB port stopped answering. Unplug the board’s USB cable, plug it back in, then press Connect.';

const SENTENCE = 'The board may still be in its bootloader.';

/** `message` followed by the advice, with "may still be in its bootloader" said once (owner report 2026-11-20). */
export function withAdvice(message: string): string {
  const trimmed = message.trim();
  if (trimmed.includes(BOOTLOADER_ADVICE)) return trimmed;
  const head = trimmed.endsWith(SENTENCE) ? trimmed.slice(0, -SENTENCE.length).trimEnd() : trimmed;
  return head.length === 0 ? BOOTLOADER_ADVICE : `${head} ${BOOTLOADER_ADVICE}`;
}
