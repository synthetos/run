/**
 * The one network call behind the bench tab's "newer build on the server"
 * check (build-info/freshness.ts): a same-origin GET of `/`, which the bench
 * server serves with `cache-control: no-cache`, so the answer is the current
 * build's prerendered page. It lives under src/cloud/ because that is the only
 * place the bundle scan admits network code (RUN_PLAN §5.3; build/chunks.ts).
 * It imports nothing, so it never pulls anything else into the cloud chunk.
 * Bench only: the entry calls it only when the build channel is `bench`.
 */

/** The served index.html, or null on any failure or non-200 answer. */
export function fetchIndexHtml(): Promise<string | null> {
  return fetch('/', { cache: 'no-store', credentials: 'omit', redirect: 'manual' })
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null);
}
