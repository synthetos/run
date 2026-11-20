/**
 * Connect on a board marked after a failed update (owner report 2026-11-20, TinyG v8 3Y2462-WWR; fake-serial TEST
 * build). The update ends without a banner in time (the simulated board boots 15 s late), so the board keeps its
 * mark. Board → Firmware says so. Connect then listens for the banner: the dialog says to press Reset, with the
 * countdown. Nobody presses it, so the wait runs out and Try again appears. Try again listens again; a simulated
 * Reset sends the banner, the mark clears and the session connects. Before that banner the bootloader link wrote
 * only the AVR109 check (ESC, S).
 *
 * With RUN_BOOTLOADER_MARK_SHOTS set to a directory, screenshots (1280×800, light and dark) are written there.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

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

/** The persistent flashable board, set up before the first open. */
async function flashableBoard(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const g = globalThis as unknown as Record<string, { ports: unknown[]; flashable?: unknown } | undefined>;
    const reg = g['__RUN_FAKE_SERIAL__'] ?? { ports: [] };
    g['__RUN_FAKE_SERIAL__'] = reg;
    reg.flashable = { eeprom: { __layout: 10002 }, id: 'SIM-FLASH-1' };
  });
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

/** Connect as the page does, without waiting for the reply (the banner wait outlasts `request`'s 5 s). */
function openInBackground(worker: Worker): Promise<void> {
  return worker.evaluate((port) => {
    const g = globalThis as unknown as { __markOpen?: unknown };
    g.__markOpen = 'pending';
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      g.__markOpen = event.data;
      channel.port1.close();
    };
    globalThis.dispatchEvent(new MessageEvent('message', { data: { v: 3, kind: 'open', port }, ports: [channel.port2] }));
  }, PORT);
}

function openReply(worker: Worker): Promise<unknown> {
  return worker.evaluate(() => (globalThis as unknown as { __markOpen?: unknown }).__markOpen);
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
  // The updated firmware boots 15 s late: past the 10 s post-update wait, so the board keeps its mark.
  await boardDo(worker, 15_000);
  await updateTo45002(page);
  const note = page.locator('[data-region="bootloader-mark"]');
  await expect(note).toBeVisible({ timeout: 120_000 });
  await expect(note).toContainText('To clear the mark: press Connect, then press Reset on the board when Run asks.');
  await expect(page.locator('[data-region="flash-recovery"]')).not.toContainText('Unplug USB and power');
  // The late banner goes out to a closed port; later starts boot normally.
  await page.waitForTimeout(7000);
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
});
