/**
 * P1-00 on the staging stand-in: every response the staging Worker returns
 * carries SERIAL_GRANTED_SECURITY_HEADERS exactly once each, so staging
 * documents may use Web Serial for their own origin and nothing else is
 * loosened. The main suite (headers.e2e.ts) proves production still denies
 * serial, against the same tree.
 */
import type { Response } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { HASHED_ASSET_CACHE_CONTROL, SERIAL_GRANTED_SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';

function expectExact(all: readonly { name: string; value: string }[], url: string): void {
  for (const [name, value] of Object.entries(SERIAL_GRANTED_SECURITY_HEADERS)) {
    const found = all.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
    expect(found, `${name} on ${url}`).toEqual([value]);
  }
}

test('the staging shell and every subresource carry the serial-granted headers exactly once, and render without a violation', async ({ page, originGuard }) => {
  const responses: Response[] = [];
  page.on('response', (r) => responses.push(r));
  const main = await page.goto('/');
  expect(main?.status()).toBe(200);
  expectExact(await (main as Response).headersArray(), '/');
  await expect(page.locator('[data-shell="workspace"]')).toBeAttached();
  await page.waitForLoadState('networkidle');

  const sub = responses.filter((r) => r.url() !== main?.url());
  expect(sub.some((r) => new URL(r.url()).pathname.endsWith('.js'))).toBe(true);
  for (const r of sub) {
    expectExact(await r.headersArray(), r.url());
    if (new URL(r.url()).pathname.startsWith('/assets/')) expect(r.headers()['cache-control'], r.url()).toBe(HASHED_ASSET_CACHE_CONTROL);
  }
  expect(originGuard.violations).toEqual([]);
  expect(originGuard.findings).toEqual([]);
});

test('the 404 page, /api/health, other /api and /auth paths carry the serial-granted headers too', async ({ request }) => {
  const notFound = await request.get('/no-such-page');
  expect(notFound.status()).toBe(404);
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok', service: 'run', env: 'staging' });
  const api = await request.get('/api/anything');
  const auth = await request.get('/auth/login');
  expect([api.status(), auth.status()]).toEqual([404, 404]);
  for (const res of [notFound, health, api, auth]) expectExact(res.headersArray(), res.url());
});

test('staging grants Web Serial to its own documents, and only that: every other device API stays off', async ({ page }) => {
  await page.goto('/');
  const allowed = await page.evaluate(() => {
    const fp = (document as unknown as { featurePolicy: { allowsFeature(f: string, origin?: string): boolean } }).featurePolicy;
    return {
      ...Object.fromEntries(['serial', 'usb', 'hid', 'bluetooth', 'camera', 'microphone', 'geolocation', 'payment'].map((f) => [f, fp.allowsFeature(f)])),
      serialForOtherOrigin: fp.allowsFeature('serial', 'https://example.com'),
    };
  });
  expect(allowed).toEqual({
    serial: true,
    usb: false,
    hid: false,
    bluetooth: false,
    camera: false,
    microphone: false,
    geolocation: false,
    payment: false,
    serialForOtherOrigin: false,
  });
});
