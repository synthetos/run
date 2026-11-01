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
  expect(await request(worker, { v: 2, kind: 'status' })).toMatchObject({ status: { source: 'serial', state: 'idle' } });
  expect(await request(worker, { v: 2, kind: 'open', port: { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } })).toEqual({
    v: 2,
    ok: false,
    kind: 'open',
    code: 'unavailable',
    message: 'no port was chosen',
  });
  expect(await request(worker, { v: 2, kind: 'status' })).toMatchObject({ status: { source: 'serial', state: 'idle', bytesReceived: 0 } });
});
