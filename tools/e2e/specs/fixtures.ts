/**
 * The `test` every spec uses (ROADMAP P0-06). It installs the origin guard
 * (src/guard.ts) on each test's browser context before the first navigation
 * and fails the test, after its body, on any external request, external
 * resource reference or CSP violation.
 *
 * Specs import `test` and `expect` from here, never from @playwright/test
 * (eslint.config.js enforces it), so no test can run without the guard. A
 * test that creates its own context calls `guardContext` on it.
 */
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { installOriginGuard, type OriginGuard } from '../src/guard.ts';
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
