/**
 * Connect on a board marked as possibly in its bootloader (owner report 2026-11-20). A TinyG prints its banner once,
 * at power-up or reset, so the banner that clears the mark has to arrive while Connect listens: the page asks the
 * person to press Reset (or switch the board's power off and on, USB kept connected) during this wait, with a
 * countdown. The wait writes nothing: the AVR109 check before it is the only thing sent (SAFETY rule: no normal
 * traffic to a board that may be in xboot command mode).
 */
import type { SessionClock } from '@synthetos/machine';

/**
 * 30 s. A person reads the guidance, finds the Reset button (or the power switch) and presses it: about 10-15 s.
 * The board then spends xboot's reset window (about 3 s on a v8, longer on newer xboot builds) before the firmware
 * prints its banner. 30 s covers both with
 * margin, and is short enough that the port and the machine lock are not held for long when nobody acts. Try again
 * starts another wait.
 */
export const BANNER_WAIT_MS = 30_000;

/** What the page shows while Connect listens for the banner, and after the wait ran out. */
export type BannerWaitView = { readonly phase: 'waiting'; readonly seconds: number } | { readonly phase: 'expired'; readonly seconds: 0 };

/** The part of `BootloaderLink` the wait uses: it only listens. */
export interface BannerSource {
  waitForFirmwareBanner(timeoutMs: number): Promise<boolean>;
}

export type BannerWaitOutcome = 'heard' | 'expired' | 'cancelled';

/**
 * Listen for a live firmware banner for BANNER_WAIT_MS, updating the countdown once a second through `show`.
 * 'heard' when the banner arrived (`show(null)`); 'expired' when the wait ran out (`show` gets the expired view);
 * 'cancelled' when `stop` settled first (the person pressed Cancel; `show(null)`).
 */
export async function listenForBanner(link: BannerSource, clock: SessionClock, show: (wait: BannerWaitView | null) => void, stop: Promise<void>): Promise<BannerWaitOutcome> {
  const end = clock.now() + BANNER_WAIT_MS;
  let timer: number | null = null;
  const tick = (): void => {
    show({ phase: 'waiting', seconds: Math.max(0, Math.ceil((end - clock.now()) / 1000)) });
    timer = clock.setTimeout(tick, 1000);
  };
  tick();
  try {
    const cancelled: Promise<BannerWaitOutcome> = stop.then(() => 'cancelled');
    const outcome = await Promise.race([link.waitForFirmwareBanner(BANNER_WAIT_MS).then((heard): BannerWaitOutcome => (heard ? 'heard' : 'expired')), cancelled]);
    show(outcome === 'expired' ? { phase: 'expired', seconds: 0 } : null);
    return outcome;
  } finally {
    if (timer !== null) clock.clearTimeout(timer);
  }
}
