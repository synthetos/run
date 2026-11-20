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
 * The board then spends xboot's 4.8 s reset window before the firmware prints its banner. 30 s covers both with
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

/**
 * Listen for a live firmware banner for `ms`, updating the countdown once a second through `show`. True when the
 * banner arrived (`show(null)`), false when the wait ran out (`show` gets the expired view).
 */
export async function listenForBanner(link: BannerSource, clock: SessionClock, show: (wait: BannerWaitView | null) => void, ms = BANNER_WAIT_MS): Promise<boolean> {
  const end = clock.now() + ms;
  let timer: number | null = null;
  const tick = (): void => {
    show({ phase: 'waiting', seconds: Math.max(0, Math.ceil((end - clock.now()) / 1000)) });
    timer = clock.setTimeout(tick, 1000);
  };
  tick();
  try {
    const heard = await link.waitForFirmwareBanner(ms);
    show(heard ? null : { phase: 'expired', seconds: 0 });
    return heard;
  } finally {
    if (timer !== null) clock.clearTimeout(timer);
  }
}
