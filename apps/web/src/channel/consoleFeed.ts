/**
 * Bench only: the page hands its wire transcript (the Console tab's lines) to
 * the bench server's `/console` route whenever it changes, so the owner or an
 * agent on this computer can read a session's traffic without the browser
 * (owner request, 2026-11-03). Read-only on the session: it only asks the
 * worker for the transcript it already keeps. Nothing here touches the
 * network itself: the post is injected (cloud/benchIndex.ts), and the entry
 * starts this only on the bench channel.
 */

export interface ConsoleFeedDeps {
  /** The worker's transcript as JSONL, or null when no link has opened. */
  readonly read: () => Promise<string | null>;
  /** Posts the transcript; resolves false when the server did not take it. */
  readonly post: (jsonl: string) => Promise<boolean>;
  readonly setInterval: (fn: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export const CONSOLE_FEED_INTERVAL_MS = 2000;

/** Starts the feed; returns a function that stops it. One read at a time; a transcript is posted again only after it changed or a post failed. */
export function watchConsoleFeed(deps: ConsoleFeedDeps, intervalMs: number = CONSOLE_FEED_INTERVAL_MS): () => void {
  let posted: string | null = null;
  let busy = false;
  const tick = (): void => {
    if (busy) return;
    busy = true;
    void deps
      .read()
      .then(async (jsonl) => {
        if (jsonl === null || jsonl === posted) return;
        if (await deps.post(jsonl)) posted = jsonl;
      })
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  };
  const handle = deps.setInterval(tick, intervalMs);
  return () => deps.clearInterval(handle);
}
