/** Step 2 of the firmware update (flashService.ts): the machine session puts the board into its bootloader. */
import type { SessionExecutor, SessionSnapshot } from '@synthetos/machine';

/** Where the session is on the way into the bootloader: entered (null), refused or lost (why), or not yet (undefined). */
function entryOutcome(s: SessionSnapshot): string | null | undefined {
  if (s.notices.bootloaderEntered !== undefined && s.base === 'NOT_CONNECTED') return null;
  if (s.notices.bootRefused !== undefined) return `The board was not put into its bootloader: ${s.notices.bootRefused}.`;
  if (s.overlays.includes('LOST') || s.overlays.includes('FAULT')) return 'The connection was lost before the board entered its bootloader.';
  return undefined;
}

/** The session's `flash` intent, then wait until its link closed (or it refused). Null on success, else why. */
export function enterBootloader(session: SessionExecutor): Promise<string | null> {
  const decision = session.request({ intent: 'flash' });
  if (!decision.allowed) return Promise.resolve(`${decision.reason} ${decision.remedy}`);
  return new Promise((resolve) => {
    const now = entryOutcome(session.snapshot);
    if (now !== undefined) {
      resolve(now);
      return;
    }
    const unsubscribe = session.subscribe((s) => {
      const outcome = entryOutcome(s);
      if (outcome === undefined) return;
      unsubscribe();
      resolve(outcome);
    });
  });
}
