/** Facts the flash view shows, derived from the session and the previous run (flashService.ts). */
import type { SessionSnapshot } from '@synthetos/machine';

/** The board's identity as the flash view records it: each field, or null when the board did not report it. */
export function boardFacts(s: SessionSnapshot): { id: string | null; hv: number | null; fb: number | null; fv: number | null } {
  const id = s.identity;
  return {
    id: typeof id?.id === 'string' && id.id.length > 0 ? id.id : null,
    hv: typeof id?.hv === 'number' ? id.hv : null,
    fb: typeof id?.fb === 'number' ? id.fb : null,
    fv: typeof id?.fv === 'number' ? id.fv : null,
  };
}

/**
 * Whether the flash may have been written, so the application may be gone. A recovery run follows a failed
 * run: if that one wrote, this one starts written; a new update starts clean.
 */
export function startsWritten(recovery: boolean | undefined, previous: { readonly wrote: boolean } | null): boolean {
  return recovery === true && previous?.wrote === true;
}

/** A failed run's `wrote`: its own writes, or those of the run it recovers. */
export function endsWritten(wroteNow: boolean, view: { readonly wrote: boolean } | null): boolean {
  return wroteNow || view?.wrote === true;
}
