/**
 * The shell is served with exactly the RUN_PLAN §6.4 headers (ROADMAP P0-04,
 * T-S25), loads nothing from another origin, and renders under the
 * production CSP without a single violation.
 */
import type { Page, Response } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';

/** Each security header appears exactly once with exactly the expected value. */
async function expectExactHeaders(response: Response | null): Promise<void> {
  expect(response).not.toBeNull();
  const all = await (response as Response).headersArray();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    const found = all.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
    expect(found, `${name} on ${(response as Response).url()}`).toEqual([value]);
  }
}

/** Records CSP violations from the first script on, before any page code runs. */
async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store: { directive: string; blocked: string; sample: string }[] = [];
    (globalThis as unknown as { __violations: typeof store }).__violations = store;
    document.addEventListener('securitypolicyviolation', (e) => {
      store.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample });
    });
  });
}

const violations = (page: Page): Promise<{ directive: string; blocked: string; sample: string }[]> =>
  page.evaluate(() => (globalThis as unknown as { __violations: { directive: string; blocked: string; sample: string }[] }).__violations);

test('the shell is served with the exact headers, renders, and violates nothing', async ({ page, originGuard }) => {
  await recordViolations(page);
  const responses: Response[] = [];
  const consoleErrors: string[] = [];
  page.on('response', (r) => responses.push(r));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  const main = await page.goto('/');
  expect(main?.status()).toBe(200);
  await expectExactHeaders(main);
  await expect(page.locator('[data-shell="workspace"]')).toBeAttached();

  // Every self-hosted font face loads under font-src 'self'.
  const fonts = await page.evaluate(async () => {
    const faces = ['400 16px "IBM Plex Sans"', '600 16px "IBM Plex Sans"', '700 16px "IBM Plex Sans Condensed"', '500 16px "IBM Plex Mono"'];
    const loaded = await Promise.all(faces.map((f) => document.fonts.load(f)));
    return loaded.map((l) => l.length);
  });
  expect(fonts).toEqual([1, 1, 1, 1]);

  // Every subresource (script, stylesheet, fonts) carries the headers too.
  const sub = responses.filter((r) => r.url() !== main?.url());
  expect(sub.map((r) => new URL(r.url()).pathname).some((p) => p.endsWith('.js'))).toBe(true);
  expect(sub.map((r) => new URL(r.url()).pathname).some((p) => p.endsWith('.woff2'))).toBe(true);
  for (const r of sub) await expectExactHeaders(r);

  // No violation in the page, and none seen by the origin guard (which also
  // fails the test on any external request, T-S25, SAFETY H12).
  expect(await violations(page)).toEqual([]);
  expect(originGuard.violations).toEqual([]);
  expect(originGuard.findings).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('the 404 page, /api/health, other /api and /auth paths all carry the exact headers', async ({ request }) => {
  const notFound = await request.get('/no-such-page');
  expect(notFound.status()).toBe(404);
  expect(await notFound.text()).toContain('data-page="not-found"');

  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['cache-control']).toBe('no-store');
  expect(await health.json()).toMatchObject({ status: 'ok', service: 'run' });

  const api = await request.get('/api/anything');
  const auth = await request.get('/auth/login');
  expect([api.status(), auth.status()]).toEqual([404, 404]);

  for (const res of [notFound, health, api, auth]) {
    const all = res.headersArray();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(all.filter((h) => h.name.toLowerCase() === name).map((h) => h.value), `${name} on ${res.url()}`).toEqual([value]);
    }
  }
});

test('the Phase 0 Permissions-Policy denies serial, even to this origin, and the other device APIs', async ({ page }) => {
  await page.goto('/');
  const allowed = await page.evaluate(() => {
    const fp = (document as unknown as { featurePolicy: { allowsFeature(f: string): boolean } }).featurePolicy;
    return Object.fromEntries(['serial', 'usb', 'hid', 'bluetooth', 'camera', 'microphone', 'geolocation', 'payment'].map((f) => [f, fp.allowsFeature(f)]));
  });
  expect(allowed).toEqual({ serial: false, usb: false, hid: false, bluetooth: false, camera: false, microphone: false, geolocation: false, payment: false });
});
