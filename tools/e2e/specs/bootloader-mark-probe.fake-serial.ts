/**
 * A marked board whose firmware is running (owner report 2026-11-21, TinyG v8 3Y2462-WWR at 449.01; fake-serial TEST
 * build). After a failed update the board keeps its "may be in its bootloader" mark, but its firmware starts. The
 * firmware stays silent to the AVR109 check (ESC, then S, no line end), so Run used to wait for a bootloader that
 * was not there: "Try the update again" counted down and failed with "Nothing came back", and Connect waited for a
 * banner that only Reset prints.
 *
 * Now, after a silent AVR109 check, Run sends one line end. The firmware answers it, which proves it is running:
 * - Try the update again connects, checks the board id, enters the bootloader the normal way ({"boot":1}) and
 *   flashes the same image;
 * - Connect connects at once and clears the mark (same board id).
 * Before the board is identified, the bootloader link writes only ESC, S and that line end.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const REPO = resolve(import.meta.dirname, '../../..');

interface Session { readonly base: string; readonly identity: { readonly fb?: number } | null }

async function serveSim(page: Page): Promise<void> {
  await page.route('**/firmware/sim/*.hex', (route) => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1) as string;
    route.fulfill({ status: 200, contentType: 'text/plain', body: readFileSync(join(REPO, 'firmware/sim', file), 'utf8') }).catch(() => undefined);
  });
}

async function flashableBoard(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const g = globalThis as unknown as Record<string, { ports: unknown[]; flashable?: unknown } | undefined>;
    const reg = g['__RUN_FAKE_SERIAL__'] ?? { ports: [] };
    g['__RUN_FAKE_SERIAL__'] = reg;
    reg.flashable = { eeprom: { __layout: 10002 }, id: 'SIM-FLASH-1' };
  });
}

/** Every later firmware start prints its banner `ms` late. */
function bannerDelay(worker: Worker, ms: number): Promise<void> {
  return worker.evaluate((delay) => {
    const b = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { board?: { device: { setBannerDelay(ms: number): void } } } }).__RUN_FAKE_SERIAL__?.board;
    if (b === undefined) throw new Error('no flashable board');
    b.device.setBannerDelay(delay);
  }, ms);
}

async function session(worker: Worker): Promise<Session> {
  return ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: Session } }).status.session;
}

/** The flash transcript's writes, in order (hex, one frame each). */
async function flashWrites(worker: Worker): Promise<string[]> {
  const reply = (await request(worker, { v: 3, kind: 'transcript' })) as { flash?: { jsonl: string } };
  const lines = (reply.flash?.jsonl ?? '').trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { dir: string; hex: string });
  return lines.filter((l) => l.dir === 'tx').map((l) => l.hex);
}

/** Connect, update to 450.02 with a firmware that boots 40 s late: the update fails and the board keeps its mark. */
async function markedBoardRunningFirmware(page: Page): Promise<Worker> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await serveSim(page);
  const worker = await machineWorker(page);
  await flashableBoard(worker);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).base, { timeout: 15_000 }).toMatch(/IDLE_UNHOMED|CONNECTED_UNKNOWN/);
  await bannerDelay(worker, 40_000);
  await page.locator('[data-region="rail"] [data-view="board"]').click();
  const w29 = page.locator('[data-action="dismiss-w29"]');
  if ((await w29.count()) > 0) await w29.click();
  await page.locator('[data-board-tab="firmware"]').click();
  const release = page.locator('[data-release="sim-edge-next-450.02.hex"]');
  await expect(release.locator('[data-action="update-release"]')).toBeEnabled({ timeout: 20_000 });
  await release.locator('[data-action="update-release"]').click();
  const dialog = page.locator('[data-region="flash-confirm"]').first();
  await expect(dialog).toBeVisible();
  const boxes = dialog.locator('input[type="checkbox"]');
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
  await dialog.locator('[data-action="confirm-flash"]').click();
  await expect(page.locator('[data-region="bootloader-mark"]')).toBeVisible({ timeout: 120_000 });
  // The late banner goes out (40 s after the exit) to a closed port: the firmware now runs, and the mark stays.
  await page.waitForTimeout(12_000);
  await bannerDelay(worker, 0);
  expect((await session(worker)).base).toBe('NOT_CONNECTED');
  return worker;
}

test('Try the update again on a marked board whose firmware runs: the line-end probe, {"boot":1}, and the update completes', async ({ page }) => {
  test.setTimeout(300_000);
  const worker = await markedBoardRunningFirmware(page);
  await page.locator('[data-action="flash-recover"]').click();
  await expect(page.locator('[data-region="flash-done"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-version-check="ok"]')).toBeVisible({ timeout: 30_000 });
  expect((await session(worker)).identity?.fb).toBe(450.02);
  await expect(page.locator('[data-region="bootloader-mark"]')).toHaveCount(0);
  // Before the board identified: ESC, S and one line end. The bootloader entry after {"boot":1} follows.
  const writes = await flashWrites(worker);
  expect(writes.slice(0, 3)).toEqual(['1b', '53', '0a']);
  expect(writes.filter((w) => w === '0a')).toHaveLength(1);
});

test('Connect on a marked board whose firmware runs: it answers the line end, the session connects and the mark clears', async ({ page }) => {
  test.setTimeout(240_000);
  const worker = await markedBoardRunningFirmware(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).base, { timeout: 15_000 }).toMatch(/IDLE_UNHOMED|CONNECTED_UNKNOWN/);
  await expect(page.locator('[data-region="banner-wait"]')).toHaveCount(0);
  await expect(page.locator('[data-region="bootloader-mark"]')).toHaveCount(0, { timeout: 10_000 });
  expect(await flashWrites(worker)).toEqual(['1b', '53', '0a']);
});
