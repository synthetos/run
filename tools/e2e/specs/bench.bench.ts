/**
 * P1-00: the localhost bench build, as the owner opens it. It runs, says it
 * is the bench build, may use Web Serial for its own origin (and nothing
 * else is loosened), and the bench server answers only loopback names.
 */
import type { Response } from '@playwright/test';
import { request as httpRequest } from 'node:http';
import { expect, test } from './fixtures.ts';
import { SERIAL_GRANTED_SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';
import { machineWorker, request } from './machineWorker.ts';
import { SERIAL_PROBE } from './serialProbe.ts';

function expectExact(all: readonly { name: string; value: string }[], url: string): void {
  for (const [name, value] of Object.entries(SERIAL_GRANTED_SECURITY_HEADERS)) {
    expect(all.filter((h) => h.name.toLowerCase() === name).map((h) => h.value), `${name} on ${url}`).toEqual([value]);
  }
}

test('the bench build loads, marks itself, starts the machine worker, and every response carries the serial-granted headers', async ({ page, originGuard }) => {
  const responses: Response[] = [];
  const errors: string[] = [];
  page.on('response', (r) => responses.push(r));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const main = await page.goto('/');
  expect(main?.status()).toBe(200);
  expectExact(await (main as Response).headersArray(), '/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-channel', 'bench');
  await expect(page.locator('[data-version][data-channel="bench"]')).toContainText('bench build, localhost only');
  expect(await page.title()).toMatch(/^\[bench\] /);
  await page.waitForLoadState('networkidle');
  for (const r of responses.filter((x) => x.url() !== main?.url())) expectExact(await r.headersArray(), r.url());
  expect(errors).toEqual([]);
  expect(originGuard.violations).toEqual([]);
  expect(originGuard.findings).toEqual([]);
});

test('the bench page may use Web Serial for its own origin, and no other device API', async ({ page }) => {
  await page.goto('/');
  const allowed = await page.evaluate(() => {
    const fp = (document as unknown as { featurePolicy: { allowsFeature(f: string, origin?: string): boolean } }).featurePolicy;
    return {
      ...Object.fromEntries(['serial', 'usb', 'hid', 'bluetooth', 'camera', 'microphone', 'geolocation', 'payment'].map((f) => [f, fp.allowsFeature(f)])),
      serialForOtherOrigin: fp.allowsFeature('serial', 'https://example.com'),
      secure: window.isSecureContext,
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
    secure: true,
  });
});

test('the bench server refuses a request under another Host name (DNS rebinding)', async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: 8794, path: '/', headers: { host: 'rebind.example:8794' } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
  expect(status).toBe(421);
});

test('the browser allows Web Serial on the bench origin, in the page and in machine.worker', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(await page.evaluate(SERIAL_PROBE)).toBe('ok:0');
  expect(await worker.evaluate(SERIAL_PROBE)).toBe('ok:0');
});

test('machine.worker asks Web Serial for the granted ports; with none granted, open is refused and the worker stays idle (P1-01)', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'status' })).toMatchObject({ status: { source: 'serial', state: 'idle' } });
  expect(await request(worker, { v: 3, kind: 'open', port: { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } })).toEqual({
    v: 3,
    ok: false,
    kind: 'open',
    code: 'unavailable',
    message: 'no port was chosen',
  });
  expect(await request(worker, { v: 3, kind: 'status' })).toMatchObject({ status: { source: 'serial', state: 'idle', session: { base: 'NOT_CONNECTED', overlays: [] } } });
});

/**
 * OD-3: the real Connect in the bench build reaches the window's port
 * chooser. Two stand-ins, both installed in this test's page only:
 * - `requestPort`/`getPorts` on the page's Web Serial object answer with a
 *   port that reports the edge-next FTDI identity (no USB device exists in
 *   Playwright's browser);
 * - the advisory: the placeholder release key's private half is not in the
 *   repository, so no test can sign one. The test serves a well-formed
 *   staging advisory and makes the page's Ed25519 verify answer true.
 *   apps/web/test/advisoryGate.test.ts and the protocol tests cover real
 *   verification.
 * The machine worker is NOT stubbed: its real Web Serial source asks the
 * browser for the granted ports, finds none, and refuses the open, which
 * the page shows. Pause stays available throughout.
 */
const ADVISORY = JSON.stringify({
  format: 'synthetos-run/safety-advisory@1',
  advisories: [
    {
      env: 'staging',
      kid: 'placeholder-bench-2026-11-01',
      payload: JSON.stringify({ format: 'synthetos-run/safety-advisory-env@1', env: 'staging', issued: '2026-01-01T00:00:00Z', expires: '2099-01-01T00:00:00Z', revoked: [] }),
      sig: 'AAAA',
    },
  ],
});

async function stubChooserAndAdvisory(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/safety-advisory.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: ADVISORY }));
  await page.addInitScript(() => {
    const request = 'request' + 'Port';
    const list = 'get' + 'Ports';
    const calls: { active: boolean }[] = [];
    (globalThis as unknown as { __chooserCalls: typeof calls }).__chooserCalls = calls;
    const board = { getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6015 }) };
    const proto = (globalThis as unknown as { Serial: { prototype: Record<string, unknown> } }).Serial.prototype;
    proto[request] = function () {
      calls.push({ active: (navigator as unknown as { userActivation: { isActive: boolean } }).userActivation.isActive });
      return Promise.resolve(board);
    };
    proto[list] = () => Promise.resolve([board]);
    SubtleCrypto.prototype.verify = () => Promise.resolve(true);
  });
}

async function connectThroughC1(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.locator('[data-action="connect"]').click();
  const c1 = page.locator('[data-safety="C1"]');
  await expect(c1).toBeVisible();
  for (const box of await c1.locator('input[type="checkbox"]').all()) await box.check();
  await page.locator('[data-action="confirm"]').click();
}

test('OD-3: Connect passes the bench identity, the advisory and C1, then shows the chooser inside the click and hands the selector to the worker', async ({ page }) => {
  await stubChooserAndAdvisory(page);
  await connectThroughC1(page);
  const refused = page.locator('[data-entry="refused"]');
  await expect(refused).toBeVisible({ timeout: 10_000 });
  // The worker got the selector, asked the browser for its granted ports, found none, and refused.
  await expect(refused).toHaveAttribute('data-refusal', 'open-failed');
  await expect(refused.getByRole('alert')).toHaveText('no port was chosen');
  expect(await page.evaluate(() => (globalThis as unknown as { __chooserCalls: { active: boolean }[] }).__chooserCalls)).toEqual([{ active: true }]);
  await expect(page.locator('.stop-button')).toBeVisible();
});

test("OD-3: a cancelled chooser is refused with the chooser's words, and nothing is opened", async ({ page }) => {
  await stubChooserAndAdvisory(page);
  await page.addInitScript(() => {
    const proto = (globalThis as unknown as { Serial: { prototype: Record<string, unknown> } }).Serial.prototype;
    proto['request' + 'Port'] = () => Promise.reject(new DOMException('No port selected by the user.', 'NotFoundError'));
  });
  await connectThroughC1(page);
  const refused = page.locator('[data-entry="refused"][data-refusal="no-port"]');
  await expect(refused).toBeVisible({ timeout: 10_000 });
  await expect(refused.getByRole('alert')).toHaveText('No port was chosen. Press Connect to try again.');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`390 px, ${colorScheme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme });
    test('the bench version chip wraps: no horizontal page scroll', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
      await expect(page.locator('[data-version][data-channel="bench"]')).toContainText('bench build, localhost only');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const chip = await page.locator('[data-version]').boundingBox();
      expect((chip?.x ?? 0) + (chip?.width ?? 0)).toBeLessThanOrEqual(390);
    });
  });
}
