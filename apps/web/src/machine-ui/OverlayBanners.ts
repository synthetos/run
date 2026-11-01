/**
 * The LOST and STALE banners (ROADMAP P1-04; SAFETY §5 W3 and W4, T-S30;
 * RUN_PLAN §7 accessibility: W3 uses `role="alert"` with a tone).
 *
 * - W3 (LOST): full width, `--danger`, `role="alert"` and
 *   `aria-live="assertive"`, with the audible alarm (alarm.ts). Shown until
 *   LOST is acknowledged.
 * - W4 (STALE): "No status from the machine for N s", counted on from how
 *   long the link had been silent when STALE was entered. Not shown under
 *   LOST (the link is gone; W3 says more).
 *
 * The strings come from @synthetos/safety only (T-S32).
 */
import { h, type ComponentChild } from 'preact';
import { w3, w4 } from '@synthetos/safety';
// The page sees the session only as the worker sends it (T-S39: no page module imports @synthetos/machine).
import type { WorkerStatus } from '../machine-worker/rpc.ts';
import { signalText } from '../shell/signal.ts';

type SessionSnapshot = WorkerStatus['session'];

export interface OverlayBannersProps {
  readonly snapshot: Pick<SessionSnapshot, 'overlays' | 'stale'> | null;
  /** Milliseconds since the window first saw this STALE (the worker's clock is not the window's). */
  readonly staleElapsedMs: number;
}

/** W4's N: whole seconds of silence, counted on from STALE entry. */
export function staleSeconds(snapshot: Pick<SessionSnapshot, 'stale'>, staleElapsedMs: number): number {
  const silent = (snapshot.stale?.silentForMs ?? 0) + Math.max(0, staleElapsedMs);
  return Math.floor(silent / 1000);
}

export function OverlayBanners({ snapshot, staleElapsedMs }: OverlayBannersProps): ComponentChild {
  if (snapshot === null) return null;
  if (snapshot.overlays.includes('LOST')) {
    return h(
      'div',
      { class: 'overlay-banner overlay-banner-danger', role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true', 'data-safety': 'W3' },
      h('p', null, ...signalText(w3())),
    );
  }
  if (snapshot.overlays.includes('STALE')) {
    return h(
      'div',
      { class: 'overlay-banner overlay-banner-warn', role: 'status', 'aria-live': 'polite', 'data-safety': 'W4' },
      h('p', null, ...signalText(w4({ seconds: staleSeconds(snapshot, staleElapsedMs) }))),
    );
  }
  return null;
}
