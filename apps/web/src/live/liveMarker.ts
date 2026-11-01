/**
 * The `liveSession` marker and W6 (ROADMAP P1-05; SAFETY §4.6 lifecycle,
 * §5 W6, H15, T-S17).
 *
 * The marker is written to `device-safety` when a LIVE session starts (and
 * again on `pagehide` and `freeze` while LIVE), and removed only by a clean
 * Disconnect. Writing it at LIVE entry, not only at `pagehide`, means a tab
 * that is killed, crashes or is discarded still leaves it behind: an
 * IndexedDB write started in `pagehide` may never commit.
 *
 * On load, a marker or `document.wasDiscarded` shows W6, which overrides the
 * NOT CONNECTED band (shell/SafetyBar.ts). The next connect goes to UNKNOWN
 * (the session always does) and replaces the marker. Nothing is sent to the
 * machine from any lifecycle event; `beforeunload` only asks the user to stay
 * while LIVE.
 */
import type { DeviceSafetyStore } from './deviceSafety.ts';

export const LIVE_MARKER_KEY = 'liveSession';

export interface LiveMarker {
  readonly since: string;
}

export async function markLive(store: DeviceSafetyStore, now: Date): Promise<void> {
  await store.set(LIVE_MARKER_KEY, { since: now.toISOString() } satisfies LiveMarker);
}

/** Only a clean Disconnect calls this. */
export async function clearLive(store: DeviceSafetyStore): Promise<void> {
  await store.delete(LIVE_MARKER_KEY);
}

/** True when W6 must show: the marker survived, or the browser discarded the page. Unreadable store: W6 (fail safe). */
export async function previousSessionEnded(store: DeviceSafetyStore, wasDiscarded: boolean): Promise<boolean> {
  if (wasDiscarded) return true;
  try {
    return (await store.get(LIVE_MARKER_KEY)) !== undefined;
  } catch {
    return true;
  }
}

export interface LifecycleTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
}

/** Wires `pagehide`, `freeze` and `beforeunload`. Sends nothing to the machine. */
export function installLiveLifecycle(win: LifecycleTarget, doc: LifecycleTarget, store: DeviceSafetyStore, isLive: () => boolean, now: () => Date): void {
  const record = (): void => {
    if (isLive()) void markLive(store, now()).catch(() => undefined);
  };
  win.addEventListener('pagehide', record);
  doc.addEventListener('freeze', record);
  win.addEventListener('beforeunload', (event) => {
    if (!isLive()) return;
    event.preventDefault();
    // Older engines show the prompt only when returnValue is set.
    (event as BeforeUnloadEvent).returnValue = '';
  });
}
