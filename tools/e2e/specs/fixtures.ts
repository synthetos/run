/**
 * The `test` every spec uses (ROADMAP P0-06). It installs the origin guard
 * (src/guard.ts) on each test's browser context before the first navigation
 * and fails the test, after its body, on any external request, external
 * resource reference or CSP violation. The `request` fixture is wrapped too
 * (guardRequestContext): it throws before any request or redirect hop to
 * another origin is sent.
 *
 * Specs import `test` and `expect` from here, never from @playwright/test
 * (eslint.config.js enforces it), so no test can run without the guard. A
 * test that creates its own context calls `guardContext` on it.
 */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { guardRequestContext, installOriginGuard, type OriginGuard } from '../src/guard.ts';
import { originOf } from '../src/origin.ts';
import { stubFirmwareCatalog } from './firmwareCatalogFixture.ts';
import { servedMode, type ServedMode } from '../src/served.ts';

interface Fixtures {
  /**
   * CSP directives this test provokes on purpose (and asserts itself). A
   * violation of any other directive fails the test.
   */
  allowedCspDirectives: readonly string[];
  /** The guard on this test's context. Automatic. */
  originGuard: OriginGuard;
  /** What wrangler dev is serving: the site tree on disk and the mode. */
  served: ServedMode;
}

export const test = base.extend<Fixtures>({
  allowedCspDirectives: [[], { option: true }],
  originGuard: [
    async ({ context, baseURL, allowedCspDirectives }, use) => {
      const guard = await installOriginGuard(context, originOf(baseURL));
      await use(guard);
      await guard.assertClean(allowedCspDirectives);
    },
    { auto: true },
  ],
  // The API request fixture is sent from Node, outside every browser route:
  // it is wrapped so it can neither address nor be redirected to another
  // origin (src/guard.ts, guardRequestContext).
  request: async ({ request, baseURL }, use) => {
    await use(guardRequestContext(request, originOf(baseURL)));
  },
  // W29 (an observer tab after the controlling tab is gone) never belongs on the spec's own page: a port opened
  // from that page's worker is its own lock, never another tab's (ownerLock.ts). Seeing W29 there fails the test.
  // A spec that asserts W29 does so on a second page of its own (tab-stop, workspace), which this does not watch.
  page: async ({ page }, use) => {
    await stubFirmwareCatalog(page);
    const w29Seen = await watchW29(page);
    // The firmware update offer (owner, 2026-11-09) opens after a connect when the signed list has a newer build for
    // the simulated board, as it always does: answer Not now whenever it appears. The offer's own spec
    // (firmware-offer.fake-serial.ts) removes this handler first.
    // The offer can step aside behind machine messages, so the click must not wait for it: a handler stuck on a
    // vanished offer would hang the test.
    await page.addLocatorHandler(page.locator('[data-action="firmware-offer-later"]'), async (later) => {
      await later.click({ timeout: 2_000 }).catch(() => undefined);
    }, { noWaitAfter: true });
    await use(page);
    expect(w29Seen(), 'W29 appeared on the spec page: its own worker lock was taken for another tab').toEqual([]);
  },
  // Playwright requires an object pattern here; an empty one trips no-empty-pattern.
  served: async ({ baseURL: _baseURL }, use) => {
    await use(servedMode(process.env, process.cwd()));
  },
});

/**
 * Records every document of `page` that shows W29, across reloads: an init script watches the DOM and reports
 * through a binding. Returns the URLs seen.
 */
async function watchW29(page: Page): Promise<() => string[]> {
  const seen: string[] = [];
  await page.exposeBinding('__e2eW29Seen', (_source, url: string) => {
    seen.push(url);
  });
  await page.addInitScript(() => {
    let reported = false;
    const check = (): void => {
      if (reported || document.querySelector('[data-safety="W29"]') === null) return;
      reported = true;
      void (globalThis as unknown as { __e2eW29Seen: (url: string) => Promise<void> }).__e2eW29Seen(location.href);
    };
    addEventListener('DOMContentLoaded', () => new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true }));
  });
  return () => [...seen];
}

/**
 * Guards a context the test created itself. Call `assertClean` on the result
 * before closing the context.
 */
export function guardContext(context: BrowserContext, baseURL: string | undefined): Promise<OriginGuard> {
  return installOriginGuard(context, originOf(baseURL));
}

export { expect };
