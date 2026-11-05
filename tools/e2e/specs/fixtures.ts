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
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { guardRequestContext, installOriginGuard, type OriginGuard } from '../src/guard.ts';
import { originOf } from '../src/origin.ts';
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
  // OD-16 made W29 (an observer tab after the controlling tab is gone) a modal. Specs that open the port from
  // the worker leave the page an observer, so W29 would cover every control: dismiss it on the spec's own page
  // whenever it appears. A spec that asserts W29 does so on a second page of its own (tab-stop), which this
  // handler does not touch.
  page: async ({ page }, use) => {
    await page.addLocatorHandler(page.locator('[data-action="dismiss-w29"]'), async (ok) => {
      await ok.click();
    });
    await use(page);
  },
  // Playwright requires an object pattern here; an empty one trips no-empty-pattern.
  served: async ({ baseURL: _baseURL }, use) => {
    await use(servedMode(process.env, process.cwd()));
  },
});

/**
 * Guards a context the test created itself. Call `assertClean` on the result
 * before closing the context.
 */
export function guardContext(context: BrowserContext, baseURL: string | undefined): Promise<OriginGuard> {
  return installOriginGuard(context, originOf(baseURL));
}

export { expect };
