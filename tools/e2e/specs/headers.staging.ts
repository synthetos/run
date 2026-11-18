/**
 * The staging stand-in (OD-40): staging is public and answers an anonymous
 * visitor exactly as production does. Every response carries SECURITY_HEADERS
 * (serial=()) exactly once, the health body names the staging environment,
 * and the browser refuses Web Serial in the page and in machine.worker. A
 * validated run.connect session is the only thing that grants serial, on
 * either host (workers/run/test/headers.test.ts covers that decision).
 */
import type { Response } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { HASHED_ASSET_CACHE_CONTROL, SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';
import { machineWorker } from './machineWorker.ts';
import { SERIAL_PROBE } from './serialProbe.ts';

function expectExact(all: readonly { name: string; value: string }[], url: string): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    const found = all.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
    expect(found, `${name} on ${url}`).toEqual([value]);
  }
}

test('the staging shell and every subresource carry the fail-closed headers exactly once, and render without a violation', async ({ page, originGuard }) => {
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

test('the 404 page, /api/health, other /api and /auth paths carry the fail-closed headers too, and health names staging', async ({ request }) => {
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

test('an anonymous staging document gets no device API, serial included (OD-40)', async ({ page }) => {
  await page.goto('/');
  const allowed = await page.evaluate(() => {
    const fp = (document as unknown as { featurePolicy: { allowsFeature(f: string, origin?: string): boolean } }).featurePolicy;
    return {
      ...Object.fromEntries(['serial', 'usb', 'hid', 'bluetooth', 'camera', 'microphone', 'geolocation', 'payment'].map((f) => [f, fp.allowsFeature(f)])),
      serialForOtherOrigin: fp.allowsFeature('serial', 'https://example.com'),
    };
  });
  expect(allowed).toEqual({
    serial: false,
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

test('the browser refuses Web Serial on anonymous staging, in the page and in machine.worker, which inherits the document policy', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(await page.evaluate(SERIAL_PROBE)).toBe('err:SecurityError');
  expect(await worker.evaluate(SERIAL_PROBE)).toBe('err:SecurityError');
});
