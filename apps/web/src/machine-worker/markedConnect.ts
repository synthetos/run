/**
 * Connect on a marked board, once a live banner arrived (flashService.ts guardConnect; safety review 2026-11-20).
 * Marks are found by the port's USB ids, so another TinyG on the same port matches board A's mark. Only A's own
 * banner (or any live banner, when no board id was recorded) clears A's mark; another board's banner keeps it, and
 * the view becomes a note about A instead of a Recovery card for the board that just proved it is not A.
 */
import type { SessionSnapshot } from '@synthetos/machine';
import type { BootloaderMark } from './bootloaderMark.ts';
import type { FlashView } from './flashService.ts';

/** This banner clears this mark: it is the marked board's own, or the mark recorded no board id. */
export function bannerClears(mark: BootloaderMark, banner: { readonly id?: string } | null): boolean {
  return mark.boardId === null || banner?.id === mark.boardId;
}

/**
 * The flash view after the handoff. The mark kept: a note about the marked board. The mark cleared after an update
 * that may have written: the finished view, so the version check runs once the board identifies (it may still
 * report the old firmware). Otherwise nothing is left to show: the normal Update view.
 */
export function viewAfterBanner(view: FlashView | null, mark: BootloaderMark, cleared: boolean): FlashView | null {
  if (view === null) return null;
  if (!cleared) return { ...view, elsewhere: mark.boardId ?? '', bannerWait: null };
  if (!view.wrote) return null;
  const { bootloader: _bootloader, ...finished } = view;
  return { ...finished, phase: 'done', marked: false, bannerWait: null, recoveryOffered: false, message: null, versionCheck: null };
}

/** What the board reports against what was flashed (to the hundredth). */
export function versionCheck(expected: number | null, reported: number | null): NonNullable<FlashView['versionCheck']> {
  const ok = expected === null ? reported !== null : reported !== null && Math.round(reported * 100) === Math.round(expected * 100);
  return { expected, reported, ok };
}

/** The version check for a finished view still waiting for it, once the session identified the board; else null. */
export function versionCheckDue(view: FlashView | null, s: SessionSnapshot): FlashView['versionCheck'] {
  if (view?.phase !== 'done' || view.versionCheck !== null || s.base === 'NOT_CONNECTED' || s.classification === null) return null;
  return versionCheck(view.target.fb, s.identity?.fb ?? null);
}
