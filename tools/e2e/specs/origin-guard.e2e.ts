/**
 * The origin guard catches each way a page can reach another origin
 * (ROADMAP P0-06; src/guard.ts). Runs in every e2e run, so a Playwright or
 * Chromium upgrade that silently blinds one layer fails here, not in
 * production.
 *
 * Each case serves a same-origin test document from a route on a fresh,
 * guarded context, so the run's own pages stay untouched. The third-party
 * host is under `.invalid` (RFC 6761): it cannot resolve, and the guard
 * aborts the request before any lookup anyway.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { GUARD_PREFIX } from '../src/origin.ts';
import type { OriginGuard } from '../src/guard.ts';
import { expect, guardContext, test } from './fixtures.ts';

const THIRD = 'https://third-party.invalid';
const CSP = "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'";

async function guardedPage(
  context: BrowserContext,
  baseURL: string | undefined,
  html: string,
  csp: string | undefined,
): Promise<{ page: Page; guard: OriginGuard; failed: string[] }> {
  const guard = await guardContext(context, baseURL);
  await context.route('**/__guard-selftest', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><title>t</title>${html}</head><body><p>t</p></body></html>`, headers: csp === undefined ? {} : { 'content-security-policy': csp } }),
  );
  const page = await context.newPage();
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  await page.goto('/__guard-selftest');
  return { page, guard, failed };
}

async function expectGuardFails(guard: OriginGuard, ...fragments: string[]): Promise<void> {
  const error = await guard.assertClean().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message.startsWith(GUARD_PREFIX)).toBe(true);
  for (const fragment of fragments) expect(message).toContain(fragment);
}

test('without a CSP, an external image is a request finding and is aborted before the network', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const { guard, failed } = await guardedPage(context, baseURL, `<img src="${THIRD}/no-csp.png" alt="">`, undefined);
  // Aborted by the guard's route (Chromium reports DevTools-blocked requests as ERR_BLOCKED_BY_CLIENT.Inspector).
  await expect.poll(() => failed.filter((f) => f.startsWith(`${THIRD}/no-csp.png net::ERR_BLOCKED_BY_CLIENT`))).toHaveLength(1);
  expect(guard.findings.map((f) => f.kind).sort()).toEqual(['dom', 'request']);
  await expectGuardFails(guard, `request ${THIRD}/no-csp.png`, `dom ${THIRD}/no-csp.png`);
  await context.close();
});

test('under a CSP, an external stylesheet is a request, a DOM finding and a CSP violation', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const { guard } = await guardedPage(context, baseURL, `<link rel="stylesheet" href="${THIRD}/csp.css">`, CSP);
  await expectGuardFails(guard, `request ${THIRD}/csp.css`, `dom ${THIRD}/csp.css`, `csp ${THIRD}/csp.css (style-src-elem`);
  await context.close();
});

test('a dns-prefetch hint, which never becomes a request, is a DOM finding', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const { guard } = await guardedPage(context, baseURL, `<link rel="dns-prefetch" href="${THIRD}/">`, CSP);
  await expectGuardFails(guard, `dom ${THIRD}/ (<link href>`);
  await context.close();
});

test('an external WebSocket is a finding and is closed', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const { page, guard } = await guardedPage(context, baseURL, '', undefined);
  await page.evaluate((url) => {
    new WebSocket(url);
  }, 'wss://third-party.invalid/socket');
  await expect.poll(() => guard.findings.map((f) => f.kind)).toContain('websocket');
  await expectGuardFails(guard, 'websocket wss://third-party.invalid/socket');
  await context.close();
});

test('a same-origin document with a hyperlink to another site and data: images is clean', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const img = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  const { guard } = await guardedPage(context, baseURL, `<a href="${THIRD}/help">help</a><img src="${img}" alt=""><link rel="icon" href="/icons/icon-32.png">`, "default-src 'none'; img-src 'self' data:");
  await guard.assertClean();
  expect(guard.findings).toEqual([]);
  await context.close();
});
