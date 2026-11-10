/**
 * The page's own "don't ask again" for C24 (Spindle on), for this page load only: never stored (SAFETY §4.5b, H52).
 * Shared by the Spindle button and a typed M3/M4 in the terminal (H91: the same confirmation as the button).
 */
let skipped = false;

/** True when the user ticked "Don't ask again until I reload this page" on C24. */
export function spindleConfirmSkipped(): boolean {
  return skipped;
}

/** The user ticked it on a C24 they confirmed. */
export function skipSpindleConfirm(): void {
  skipped = true;
}

/** Tests only: forget the session's "don't ask again" for C24. */
export function resetSpindleConfirm(): void {
  skipped = false;
}
