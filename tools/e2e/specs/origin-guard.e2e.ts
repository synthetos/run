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
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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

/**
 * Redirect hops (batch 7, finding P0-06 redirect). Chromium follows a
 * redirect without asking the context's routes again, so the guard must
 * refuse an external hop before the browser follows it. Both servers listen
 * on loopback only; the "third party" counts every request that reaches it,
 * and every case requires that count to stay 0.
 */
interface RedirectRig {
  readonly origin: string;
  readonly third: string;
  readonly thirdHits: () => number;
  close(): Promise<void>;
}

async function redirectRig(): Promise<RedirectRig> {
  let hits = 0;
  const third = createServer((_req, res) => {
    hits++;
    res.end('third party');
  });
  const listen = (s: Server): Promise<number> =>
    new Promise((done) => s.listen(0, '127.0.0.1', () => done((s.address() as AddressInfo).port)));
  const thirdPort = await listen(third);
  const thirdOrigin = `http://127.0.0.1:${thirdPort}`;
  const source = createServer((req, res) => {
    const path = req.url ?? '/';
    const go = (status: number, location: string): void => {
      res.writeHead(status, { location });
      res.end();
    };
    if (path === '/away') return go(302, `${thirdOrigin}/target`);
    if (path === '/away-307') return go(307, `${thirdOrigin}/target`);
    if (path === '/away-308') return go(308, `${thirdOrigin}/target`);
    if (path === '/away-protocol-relative') return go(301, `//127.0.0.1:${thirdPort}/target`);
    if (path === '/hop') return go(302, '/away');
    if (path === '/hop2') return go(307, '/hop');
    if (path === '/loop') return go(302, '/loop');
    if (path === '/home') return go(302, '/ok');
    if (path === '/away.png') return go(302, `${thirdOrigin}/pixel.png`);
    if (path === '/ok') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>ok</title><p>ok</p>');
    }
    if (path === '/page-with-image') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>img</title><img src="/away.png" alt="">');
    }
    res.writeHead(404);
    res.end();
  });
  const sourcePort = await listen(source);
  return {
    origin: `http://127.0.0.1:${sourcePort}`,
    third: thirdOrigin,
    thirdHits: () => hits,
    close: async () => {
      await Promise.all([new Promise((d) => source.close(d)), new Promise((d) => third.close(d))]);
    },
  };
}

for (const path of ['/away', '/away-307', '/away-308', '/away-protocol-relative', '/hop', '/hop2']) {
  test(`a navigation redirected to another origin (${path}) is aborted before the third party is reached`, async ({ browser }) => {
    const rig = await redirectRig();
    const context = await browser.newContext();
    try {
      const guard = await guardContext(context, rig.origin);
      const page = await context.newPage();
      await page.goto(`${rig.origin}${path}`).catch(() => undefined);
      await expectGuardFails(guard, `redirect ${rig.third}/target`);
      expect(rig.thirdHits()).toBe(0);
    } finally {
      await context.close();
      await rig.close();
    }
  });
}

test('a subresource redirected to another origin is aborted before the third party is reached', async ({ browser }) => {
  const rig = await redirectRig();
  const context = await browser.newContext();
  try {
    const guard = await guardContext(context, rig.origin);
    const page = await context.newPage();
    await page.goto(`${rig.origin}/page-with-image`);
    await page.waitForLoadState('load');
    await expect.poll(() => guard.findings.map((f) => f.kind)).toContain('redirect');
    await expectGuardFails(guard, `redirect ${rig.third}/pixel.png`);
    expect(rig.thirdHits()).toBe(0);
  } finally {
    await context.close();
    await rig.close();
  }
});

test('a fetch() redirected to another origin is aborted before the third party is reached', async ({ browser }) => {
  const rig = await redirectRig();
  const context = await browser.newContext();
  try {
    const guard = await guardContext(context, rig.origin);
    const page = await context.newPage();
    await page.goto(`${rig.origin}/ok`);
    const outcome = await page.evaluate(() => fetch('/away').then(() => 'loaded', () => 'refused'));
    expect(outcome).toBe('refused');
    await expectGuardFails(guard, `redirect ${rig.third}/target`);
    expect(rig.thirdHits()).toBe(0);
  } finally {
    await context.close();
    await rig.close();
  }
});

test('control: a same-origin redirect is followed and is clean', async ({ browser }) => {
  const rig = await redirectRig();
  const context = await browser.newContext();
  try {
    const guard = await guardContext(context, rig.origin);
    const page = await context.newPage();
    const response = await page.goto(`${rig.origin}/home`);
    expect(response?.status()).toBe(200);
    // The guard follows the hop itself, so the document keeps its requested URL.
    expect(page.url()).toBe(`${rig.origin}/home`);
    await expect(page.locator('p')).toHaveText('ok');
    await guard.assertClean();
    expect(guard.findings).toEqual([]);
    expect(rig.thirdHits()).toBe(0);
  } finally {
    await context.close();
    await rig.close();
  }
});

test('a same-origin redirect loop is refused', async ({ browser }) => {
  const rig = await redirectRig();
  const context = await browser.newContext();
  try {
    const guard = await guardContext(context, rig.origin);
    const page = await context.newPage();
    await page.goto(`${rig.origin}/loop`).catch(() => undefined);
    await expectGuardFails(guard, 'redirect', 'hops');
    expect(rig.thirdHits()).toBe(0);
  } finally {
    await context.close();
    await rig.close();
  }
});
