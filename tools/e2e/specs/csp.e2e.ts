/**
 * ROADMAP P0-04 acceptance: "Adding an inline <script> to a built page
 * produces a CSP violation in the test."
 *
 * The built page is fetched from wrangler dev with its real response
 * headers, an inline script is added to its body, and the page is fulfilled
 * with the SAME headers. The browser must refuse to run the script and
 * report a script-src violation. A control run without the CSP header shows
 * that the injected script does run when nothing blocks it, so the test can
 * tell enforcement from a broken injection.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const INLINE = '<script>globalThis.__inlineRan = true;</script>';

// The injected script provokes this violation on purpose and the test
// asserts it; the origin guard still fails on any other directive.
test.use({ allowedCspDirectives: ['script-src-elem'] });

async function loadWithInlineScript(page: Page, keepCsp: boolean): Promise<{ ran: boolean; violations: { directive: string; blocked: string }[] }> {
  await page.addInitScript(() => {
    const store: { directive: string; blocked: string }[] = [];
    (globalThis as unknown as { __violations: typeof store }).__violations = store;
    document.addEventListener('securitypolicyviolation', (e) => store.push({ directive: e.effectiveDirective, blocked: e.blockedURI }));
  });
  await page.route('**/', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const body = (await response.text()).replace('</body>', `${INLINE}</body>`);
    expect(body).toContain(INLINE);
    const headers = { ...response.headers() };
    if (!keepCsp) delete headers['content-security-policy'];
    return route.fulfill({ response, body, headers });
  });
  await page.goto('/');
  await page.waitForLoadState('load');
  return page.evaluate(() => ({
    ran: (globalThis as unknown as { __inlineRan?: boolean }).__inlineRan === true,
    violations: (globalThis as unknown as { __violations: { directive: string; blocked: string }[] }).__violations,
  }));
}

test('an inline <script> added to the built page is blocked with a script-src violation', async ({ page }) => {
  const result = await loadWithInlineScript(page, true);
  expect(result.ran).toBe(false);
  expect(result.violations).toContainEqual({ directive: 'script-src-elem', blocked: 'inline' });
});

test('control: without the CSP header the same injected script runs', async ({ page }) => {
  const result = await loadWithInlineScript(page, false);
  expect(result.ran).toBe(true);
  expect(result.violations).toEqual([]);
});
