/**
 * Fetching a listed release image through the firmware route (OD-10; the
 * fake-serial TEST build). The one real TinyG release, 440.21, is listed for
 * hardware version 8 as an older build; the simulated board here runs an
 * edge-next image that reports hardware version 8, so the Firmware tab
 * offers it. "Update to 440.21" fetches the image from the page's own origin
 * at `/firmware/synthetos/TinyG/440.21/tinyg-440.21.hex`, which this spec
 * answers with the bench server's firmware handler
 * (tools/gates/src/bench/firmware.ts: the run Worker's proxy over the signed
 * list) in front of a STUBBED GitHub that serves the repository's copy of
 * the release. The page checks the SHA-256 and size and asks C6; the spec
 * cancels there. Nothing is flashed, and nothing reaches the network.
 *
 * Also: a GitHub that serves other bytes is refused by the proxy (404), the
 * panel says so and offers the local copy, and a local copy is checked the
 * same way.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, Route, Worker } from '@playwright/test';
import { simFirmwareImage } from '@synthetos/testkit';
import { benchFirmware, benchFirmwareAssets, type BenchFirmware } from '../../gates/src/bench/firmware.ts';
import type { FetchLike } from '../../../workers/run/src/firmwareProxy.ts';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const IMAGE = readFileSync(join(REPO, 'firmware/tinyg-440.21.hex'));
const IMAGE_SHA = createHash('sha256').update(IMAGE).digest('hex');
const HEX_URL = 'https://github.com/synthetos/TinyG/releases/download/440.21/tinyg-440.21.hex';
const SUMS_URL = 'https://github.com/synthetos/TinyG/releases/download/440.21/SHA256SUMS';
const ROUTE = '**/firmware/synthetos/TinyG/440.21/tinyg-440.21.hex';

interface Status {
  readonly status: { readonly session: { readonly base: string; readonly identity: { readonly fb?: number; readonly hv?: number } | null } };
}

/** The bench firmware handler over the signed list and a stubbed GitHub (`body` for the hex). */
async function benchRoute(body: Uint8Array<ArrayBuffer>): Promise<{ proxy: BenchFirmware; github: string[]; hits: number; handler: (route: Route) => Promise<void> }> {
  const github: string[] = [];
  const fetchFn: FetchLike = (url) => {
    github.push(url);
    if (url === HEX_URL) return Promise.resolve(new Response(body.slice()));
    if (url === SUMS_URL) return Promise.resolve(new Response(`${IMAGE_SHA}  tinyg-440.21.hex\n`));
    return Promise.resolve(new Response('no', { status: 404 }));
  };
  const assets = await benchFirmwareAssets(JSON.parse(readFileSync(join(REPO, 'firmware/releases.json'), 'utf8')) as unknown);
  // 450.02 and 450.01 are listed too (not recommended); these specs fetch 440.21.
  expect(assets.map((a) => a.asset)).toEqual(['tinyg-450.02.hex', 'tinyg-450.01.hex', 'tinyg-440.21.hex']);
  const proxy = benchFirmware(assets, fetchFn);
  const state = {
    proxy,
    github,
    hits: 0,
    handler: async (route: Route): Promise<void> => {
      state.hits += 1;
      const res = await proxy.respond(route.request().method(), new URL(route.request().url()).pathname);
      await route.fulfill({ status: res.status, headers: { ...res.headers }, body: Buffer.from(res.body) });
    },
  };
  return state;
}

/** A flashable board whose application image reports hardware version 8 (edge-next 450.01). */
async function hv8Board(worker: Worker): Promise<void> {
  const image = [...simFirmwareImage({ fb: 450.01, fv: 0.97, hv: 8, layout: 10002 }, 0x8000, 45001)];
  await worker.evaluate(
    ({ image: bytes }) => {
      const g = globalThis as unknown as Record<string, { ports: unknown[]; flashable?: unknown } | undefined>;
      const reg = g['__RUN_FAKE_SERIAL__'] ?? { ports: [] };
      g['__RUN_FAKE_SERIAL__'] = reg;
      reg.flashable = { eeprom: { __layout: 10002, st: 1, zsn: 1 }, id: 'SIM-HV8-1', flash: new Uint8Array(bytes) };
    },
    { image },
  );
}

async function status(worker: Worker): Promise<Status['status']> {
  return ((await request(worker, { v: 3, kind: 'status' })) as Status).status;
}

function pageWrites(worker: Worker): Promise<number> {
  return worker.evaluate(() => (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { board?: { device: { xboot: { pageWrites: unknown[] } } } } }).__RUN_FAKE_SERIAL__?.board?.device.xboot.pageWrites.length ?? 0);
}

async function openFirmware(page: Page, worker: Worker): Promise<void> {
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await status(worker)).session.base, { timeout: 15_000 }).toMatch(/IDLE_UNHOMED|CONNECTED_UNKNOWN/);
  const s = await status(worker);
  expect(s.session.identity?.fb).toBe(450.01);
  expect(s.session.identity?.hv).toBe(8);
  await page.locator('[data-region="rail"] [data-view="board"]').click();
  await expect(page.locator('[data-screen="board"]')).toBeVisible();
  // W29 is dismissed by the page fixture's handler (specs/fixtures.ts).
  await page.locator('[data-board-tab="firmware"]').click();
}

test('440.21 is listed as an older build from GitHub Releases; Update fetches it through the firmware route, checks it, and asks C6; nothing is flashed', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const bench = await benchRoute(new Uint8Array(IMAGE));
  await page.route(ROUTE, bench.handler);
  const worker = await machineWorker(page);
  await hv8Board(worker);
  await openFirmware(page, worker);
  const release = page.locator('[data-release="tinyg-440.21.hex"]');
  await expect(release).toBeVisible({ timeout: 20_000 });
  await expect(release).toHaveAttribute('data-release-age', 'older');
  await expect(release).toHaveAttribute('data-release-source', 'github');
  // N66: every shipped build carries the known-issue note until the fixed build is named.
  await expect(page.locator('[data-known-issue="n66"]')).toContainText('a step or two off');
  await expect(release.locator('.rel-ver')).toContainText('Older');
  await expect(release.locator('.rel-ver')).not.toContainText('Recommended');
  await expect(release.locator('.installed')).toContainText('GitHub Releases: synthetos/TinyG 440.21');
  await expect(release.locator('.installed')).toContainText('sha256 c2c1…5e92');
  // No old-firmware warning: 440.21 is listed, not below the minimum, and the board runs 450.01.
  await expect(page.locator('[data-old-firmware="true"]')).toHaveCount(0);
  await expect(release.locator('[data-action="update-release"]')).toBeEnabled({ timeout: 20_000 });
  await release.locator('[data-action="update-release"]').click();
  // The download card, then the C6 question about the checked image.
  const confirm = page.locator('[data-region="flash-confirm"]');
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await expect(confirm.locator('[data-safety="C6"]')).toContainText('c2c1…5e92');
  await expect(confirm.locator('[data-safety="C6"]')).toContainText('440.21');
  expect(bench.hits).toBe(1);
  expect(bench.github).toEqual([HEX_URL, SUMS_URL]);
  await confirm.locator('[data-action="cancel-flash"]').click();
  await expect(confirm).toHaveCount(0);
  // The download card shows the checked image; nothing was written and the board still runs 450.01.
  const card = page.locator('[data-region="firmware-download"]');
  await expect(card).toHaveAttribute('data-download-phase', 'ready');
  await expect(card).toContainText('327 KB of 327 KB');
  expect(await pageWrites(worker)).toBe(0);
  expect((await status(worker)).session.identity?.fb).toBe(450.01);
  // A second Update is served from the handler's memory: GitHub is not asked again.
  await release.locator('[data-action="update-release"]').click();
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  expect(bench.hits).toBe(2);
  expect(bench.github).toHaveLength(2);
  await confirm.locator('[data-action="cancel-flash"]').click();
});

test('a GitHub that serves other bytes is refused by the route (404): the panel offers the local copy, which is checked against the signed entry', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const tampered = new Uint8Array(IMAGE);
  tampered[200] = tampered[200] === 0x30 ? 0x31 : 0x30;
  const bench = await benchRoute(tampered);
  await page.route(ROUTE, bench.handler);
  const worker = await machineWorker(page);
  await hv8Board(worker);
  await openFirmware(page, worker);
  const release = page.locator('[data-release="tinyg-440.21.hex"]');
  await expect(release.locator('[data-action="update-release"]')).toBeEnabled({ timeout: 20_000 });
  await release.locator('[data-action="update-release"]').click();
  const message = page.locator('[data-flash-message="true"]');
  await expect(message).toContainText('not served by this site', { timeout: 30_000 });
  await expect(message).toContainText('Use a local copy');
  await expect(page.locator('[data-region="firmware-download"]')).toHaveAttribute('data-download-phase', 'failed');
  expect(bench.hits).toBe(1);
  expect(bench.github).toEqual([HEX_URL]);
  await expect(page.locator('[data-region="flash-confirm"]')).toHaveCount(0);
  // A tampered local copy is refused on the page; the real one is accepted and C6 is asked.
  const input = release.locator('[data-action="release-local"]');
  await input.setInputFiles({ name: 'tinyg-440.21.hex', mimeType: 'text/plain', buffer: Buffer.from(tampered) });
  await expect(message).toContainText('SHA-256 is not the one the signed release list names', { timeout: 20_000 });
  await expect(page.locator('[data-region="flash-confirm"]')).toHaveCount(0);
  await input.setInputFiles({ name: 'tinyg-440.21.hex', mimeType: 'text/plain', buffer: IMAGE });
  const confirm = page.locator('[data-region="flash-confirm"]');
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await expect(confirm.locator('[data-safety="C6"]')).toContainText('c2c1…5e92');
  await confirm.locator('[data-action="cancel-flash"]').click();
  expect(await pageWrites(worker)).toBe(0);
});
