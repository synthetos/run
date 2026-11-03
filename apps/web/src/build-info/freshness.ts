/**
 * Tells an open bench tab when the server has a newer build than the page it
 * shows. The owner rebuilds the bench many times a day and asked that the
 * version footer always reflects what is being looked at. The page already
 * carries its own build (`__RUN_BUILD__`); the bench server serves index.html
 * with `cache-control: no-cache`, so a same-origin GET of `/` returns the
 * current build's prerendered HTML, whose version chip carries the current
 * label. When the two differ, the chip says so and the polling stops.
 *
 * Bench only: the entry starts it when the build channel is `bench`. It never
 * reloads the page by itself (a reload would drop the board connection, tenet 1).
 * Pure apart from the injected fetch and timer, so it is unit-tested with fakes.
 * The fetch itself is cloud/benchIndex.ts, the only place network code may live.
 */
import { type BuildInfo, versionLabel } from './buildInfo.ts';

/** How often the server is asked, ms. Loopback only, one small GET. */
export const FRESHNESS_INTERVAL_MS = 30_000;

/** What the chip says once a newer build is on the server. */
export const STALE_SUFFIX = ' · newer build on the server: reload this tab';

const CHIP = /data-version[^>]*>([^<]*)</;

/** The version label inside a prerendered index.html, or null if none is found. */
export function labelInHtml(html: string): string | null {
  const m = CHIP.exec(html);
  return m === null ? null : m[1]!.trim();
}

export interface FreshnessDeps {
  readonly fetchHtml: () => Promise<string | null>;
  readonly setInterval: (fn: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export interface FreshnessWatch {
  /** Runs one comparison now; resolves true once the server build differs from this page's. */
  check(): Promise<boolean>;
  stop(): void;
}

/**
 * Watches the server's build and marks the chip stale when it changes. `chip`
 * is the page's version element; its text is left alone until a difference is
 * seen, then the suffix is appended once and `data-stale` is set.
 */
export function watchBuildFreshness(chip: Element | null, current: BuildInfo, deps: FreshnessDeps, intervalMs = FRESHNESS_INTERVAL_MS): FreshnessWatch {
  const mine = versionLabel(current);
  let handle: unknown;
  let stale = false;
  const stop = (): void => {
    if (handle !== undefined) deps.clearInterval(handle);
    handle = undefined;
  };
  const check = async (): Promise<boolean> => {
    if (stale) return true;
    const html = await deps.fetchHtml().catch(() => null);
    if (html === null) return false;
    const served = labelInHtml(html);
    if (served === null || served === mine) return false;
    stale = true;
    stop();
    if (chip !== null) {
      chip.setAttribute('data-stale', served);
      chip.setAttribute('title', `This tab shows ${mine}; the server now has ${served}. Reload to see the current build.`);
      chip.textContent = `${chip.textContent ?? mine}${STALE_SUFFIX}`;
    }
    return true;
  };
  handle = deps.setInterval(() => void check(), intervalMs);
  return Object.freeze({ check, stop });
}
