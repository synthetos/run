/**
 * Connect on a board marked after a failed update (owner report 2026-11-20, TinyG v8 3Y2462-WWR; fake-serial TEST
 * build). The update ends without a banner in time (the simulated board boots 40 s late), so the board keeps its
 * mark. Board → Firmware says so. Connect then listens for the banner: the dialog says to press Reset, with the
 * countdown. Nobody presses it, so the wait runs out and Try again appears. Try again listens again; a simulated
 * Reset sends the banner, the mark clears and the session connects. Before that banner the bootloader link wrote
 * only the AVR109 check (ESC, S). Then the page is the normal Update view (no Recovery card), its release rows
 * capped on a wide window, and Update to 451.00 opens C6.
 *
 * With RUN_BOOTLOADER_MARK_SHOTS set to a directory, screenshots (light and dark; 1280×800, and 1600×1000 for the
 * wide Update view) are written there.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { setupRecord } from './accountRecords.ts';
import { open as openWizard, step } from './wizardPage.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const SHOTS = process.env['RUN_BOOTLOADER_MARK_SHOTS'];
const REPO = resolve(import.meta.dirname, '../../..');

interface Board {
  readonly device: { resetBoard(): void; setBannerDelay(ms: number): void };
}

/** Screenshots in both themes, and no page scroll bars at 1280×800. */
async function shots(page: Page, name: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const size = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
    expect(size.h, `${name} ${theme}: page height`).toBeLessThanOrEqual(size.ih);
    expect(size.w, `${name} ${theme}: page width`).toBeLessThanOrEqual(size.iw);
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`), fullPage: false });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function serveSim(page: Page): Promise<void> {
  await page.route('**/firmware/sim/*.hex', (route) => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1) as string;
    route.fulfill({ status: 200, contentType: 'text/plain', body: readFileSync(join(REPO, 'firmware/sim', file), 'utf8') }).catch(() => undefined);
  });
}

/** The persistent flashable board, set up before the first open: running its firmware, or in xboot's power-on window. */
async function flashableBoard(worker: Worker, start: 'app' | 'bootloader' = 'app'): Promise<void> {
  await worker.evaluate((s) => {
    const g = globalThis as unknown as Record<string, { ports: unknown[]; flashable?: unknown } | undefined>;
    const reg = g['__RUN_FAKE_SERIAL__'] ?? { ports: [] };
    g['__RUN_FAKE_SERIAL__'] = reg;
    reg.flashable = { eeprom: { __layout: 10002 }, id: 'SIM-FLASH-1', start: s };
  }, start);
}

/** The board inside the worker: a late banner on the next start (ms), or the Reset button. */
function boardDo(worker: Worker, what: 'reset' | number): Promise<void> {
  return worker.evaluate((w) => {
    const b = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { board?: Board } }).__RUN_FAKE_SERIAL__?.board;
    if (b === undefined) throw new Error('no flashable board');
    if (w === 'reset') b.device.resetBoard();
    else b.device.setBannerDelay(w);
  }, what);
}

/** Sends a request without waiting for the reply (the banner wait outlasts `request`'s 5 s); `reply` reads it. */
function inBackground(worker: Worker, message: unknown): Promise<void> {
  return worker.evaluate((data) => {
    const g = globalThis as unknown as { __markReply?: unknown };
    g.__markReply = 'pending';
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      g.__markReply = event.data;
      channel.port1.close();
    };
    globalThis.dispatchEvent(new MessageEvent('message', { data, ports: [channel.port2] }));
  }, message);
}

/** Connect as the page does, in the background. */
const openInBackground = (worker: Worker): Promise<void> => inBackground(worker, { v: 3, kind: 'open', port: PORT });

function openReply(worker: Worker): Promise<unknown> {
  return worker.evaluate(() => (globalThis as unknown as { __markReply?: unknown }).__markReply);
}

async function base(worker: Worker): Promise<string> {
  return ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: { base: string } } }).status.session.base;
}

async function updateTo45002(page: Page): Promise<void> {
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
}

/** The flash transcript's writes up to the first banner received. */
async function writesBeforeBanner(worker: Worker): Promise<string[]> {
  const reply = (await request(worker, { v: 3, kind: 'transcript' })) as { flash?: { jsonl: string } };
  const lines = (reply.flash?.jsonl ?? '').trim().split('\n').map((l) => JSON.parse(l) as { t: number; dir: string; hex: string });
  let text = '';
  const bannerAt = lines.find((l) => l.dir === 'rx' && (text += Buffer.from(l.hex, 'hex').toString('latin1')).includes('"fb":'))?.t ?? Infinity;
  return lines.filter((l) => l.dir === 'tx' && l.t <= bannerAt).map((l) => l.hex);
}

test('a marked board: press Reset during the countdown; the wait runs out, Try again, Reset, and the session connects', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await serveSim(page);
  const worker = await machineWorker(page);
  await flashableBoard(worker);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(() => base(worker), { timeout: 15_000 }).toMatch(/IDLE_UNHOMED|CONNECTED_UNKNOWN/);
  // The updated firmware boots 40 s late: past the 30 s post-update wait, so the board keeps its mark.
  await boardDo(worker, 40_000);
  await updateTo45002(page);
  const note = page.locator('[data-region="bootloader-mark"]');
  await expect(note).toBeVisible({ timeout: 120_000 });
  await expect(note).toContainText('To clear the mark: press Connect, then press Reset on the board when Run asks.');
  const recovery = page.locator('[data-region="flash-recovery"]');
  await expect(recovery).not.toContainText('Unplug USB and power');
  // Pages were written: the card says no firmware may be running, and says "in its bootloader" once.
  await expect(recovery).toContainText('No firmware running');
  expect((await recovery.innerText()).split('may still be in its bootloader').length - 1).toBe(1);
  // The late banner goes out to a closed port (40 s after the exit); later starts boot normally.
  await page.waitForTimeout(12_000);
  await boardDo(worker, 0);
  await shots(page, 'firmware-mark-note');

  await openInBackground(worker);
  const dialog = page.locator('[data-region="banner-wait"]');
  await expect(dialog).toHaveAttribute('data-banner-wait', 'waiting', { timeout: 10_000 });
  await expect(dialog).toContainText('Press the Reset button on the board now (or switch the board’s power off and on, keeping USB connected).');
  await expect(dialog.locator('[data-banner-wait-seconds]')).toHaveAttribute('data-banner-wait-seconds', /^(30|29|28|27|26|25)$/);
  await shots(page, 'connect-countdown');
  // Nobody presses Reset: the wait runs out, the mark stays, Try again.
  await expect(dialog).toHaveAttribute('data-banner-wait', 'expired', { timeout: 40_000 });
  expect(await openReply(worker)).toMatchObject({ ok: false, message: expect.stringContaining('Press Connect, then press Reset on the board when Run asks.') });
  await expect(dialog.locator('[data-action="banner-retry"]')).toBeVisible();
  await expect(note).toBeVisible();
  expect(await writesBeforeBanner(worker)).toEqual(['1b', '53']);
  await shots(page, 'connect-expired');

  await dialog.locator('[data-action="banner-retry"]').click();
  await expect(dialog).toHaveAttribute('data-banner-wait', 'waiting', { timeout: 10_000 });
  await page.waitForTimeout(2000);
  await boardDo(worker, 'reset');
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => base(worker), { timeout: 15_000 }).toMatch(/IDLE_UNHOMED|CONNECTED_UNKNOWN/);
  await expect(note).toHaveCount(0);
  expect(await writesBeforeBanner(worker)).toEqual(['1b', '53']);

  // Firmware runs and the mark is gone: the normal Update view, no Recovery card, and Update to 451.00 opens C6.
  await expect(recovery).toHaveCount(0);
  await expect(page.locator('[data-region="firmware-plan"]')).toBeVisible();
  const next = page.locator('[data-release="sim-edge-next-451.00.hex"] [data-action="update-release"]');
  await expect(next).toBeEnabled({ timeout: 20_000 });
  await shots(page, 'firmware-update-1280');
  await page.setViewportSize({ width: 1600, height: 1000 });
  const row = await page.locator('[data-release="sim-edge-next-451.00.hex"]').boundingBox();
  expect(row?.width ?? 0, 'release rows stop at a readable width').toBeLessThanOrEqual(900);
  await shots(page, 'firmware-update-1600');
  await page.setViewportSize({ width: 1280, height: 800 });
  await next.click();
  await expect(page.locator('[data-region="flash-confirm"]')).toBeVisible();
  await expect(page.locator('[data-region="flash-recovery"]')).toHaveCount(0);
  await page.locator('[data-action="cancel-flash"]').click();
});

/**
 * The setup wizard's Machine step (step 2) shows the same guidance over the wizard. The mark comes from a board found
 * in its bootloader whose Start firmware got no banner in time (the firmware boots 40 s late): a failed mark.
 */
test('setup, Machine step: a marked board gets the countdown, Try again, and connects after Reset', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { worker } = await openWizard(page, [setupRecord({ step: 2, done: [1] })], 2);
  await flashableBoard(worker, 'bootloader');
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: false });
  await boardDo(worker, 40_000);
  await inBackground(worker, { v: 3, kind: 'flash', command: { op: 'startFirmware' } });
  await expect.poll(() => openReply(worker), { timeout: 45_000 }).toMatchObject({ ok: false });
  // The late banner goes out to a closed port (40 s after E); later starts boot normally.
  await page.waitForTimeout(12_000);
  await boardDo(worker, 0);

  await openInBackground(worker);
  const dialog = page.locator('[data-banner-host="card"] [data-region="banner-wait"]');
  await expect(dialog).toHaveAttribute('data-banner-wait', 'waiting', { timeout: 10_000 });
  await expect(dialog).toContainText('Press the Reset button on the board now (or switch the board’s power off and on, keeping USB connected).');
  await expect(dialog.locator('[data-banner-wait-seconds]')).toHaveAttribute('data-banner-wait-seconds', /^(30|29|28|27|26|25)$/);
  await shots(page, 'wizard-countdown');
  await expect(dialog).toHaveAttribute('data-banner-wait', 'expired', { timeout: 40_000 });
  await shots(page, 'wizard-expired');
  await dialog.locator('[data-action="banner-retry"]').click();
  await expect(dialog).toHaveAttribute('data-banner-wait', 'waiting', { timeout: 10_000 });
  await page.waitForTimeout(2000);
  await boardDo(worker, 'reset');
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => base(worker), { timeout: 15_000 }).toMatch(/IDLE_UNHOMED|CONNECTED_UNKNOWN/);
  await expect(step(page, 2)).toBeVisible();
  expect(await writesBeforeBanner(worker)).toEqual(['1b', '53']);
});
