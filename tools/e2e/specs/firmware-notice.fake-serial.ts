/**
 * The read-only notice above the Board tabs (owner 169-170, 2026-11-19): its "Update firmware" reaches the update
 * itself. On Board → Firmware → Update, the owner's page, it starts the recommended release's flow as that row's own
 * button does: the image is fetched and checked, then C6 asks at its warnings. Nothing is written before C6. While C6
 * shows, the notice has no Update firmware (it would have nothing to start); Cancel brings it back. The board is the
 * test kit's flashable board running an unapproved build (READ_ONLY, update needed) on the simulated hardware 99.
 * RUN_SCREENSHOTS=1 writes the pictures to docs/design/screenshots/wizard-firmware/.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { simFirmwareImage } from '@synthetos/testkit';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { session, PORT } from './jobFlow.ts';
import { shot } from './wizardPage.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const SHOT_DIR = new URL('../../../docs/design/screenshots/wizard-firmware/', import.meta.url).pathname;

/** A flashable board on 450.90 (not on the approved list), hardware 99, with the simulated release images served. */
async function unapprovedBoard(page: Page): Promise<Worker> {
  await page.route('**/firmware/sim/*.hex', (route) => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1) as string;
    route.fulfill({ status: 200, contentType: 'text/plain', body: readFileSync(join(REPO, 'firmware/sim', file), 'utf8') }).catch(() => undefined);
  });
  const worker = await machineWorker(page);
  const image = [...simFirmwareImage({ fb: 450.9, fv: 0.97, hv: 99, layout: 10002 }, 0x8000, 45090)];
  await worker.evaluate(({ image: bytes }) => {
    const g = globalThis as unknown as Record<string, { ports: unknown[]; flashable?: unknown } | undefined>;
    const reg = g['__RUN_FAKE_SERIAL__'] ?? { ports: [] };
    g['__RUN_FAKE_SERIAL__'] = reg;
    reg.flashable = { eeprom: { __layout: 10002 }, id: 'SIM-RO-1', flash: new Uint8Array(bytes) };
  }, { image });
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).overlays, { timeout: 15_000 }).toContain('READ_ONLY');
  return worker;
}

function pageWrites(worker: Worker): Promise<number> {
  return worker.evaluate(() => (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { board?: { device: { xboot: { pageWrites: unknown[] } } } } }).__RUN_FAKE_SERIAL__?.board?.device.xboot.pageWrites.length ?? 0);
}

for (const theme of ['light', 'dark'] as const) {
  test(`on Board → Firmware → Update the notice's Update firmware opens C6; the button is gone while C6 shows (${theme})`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1280, height: 800 });
    const worker = await unapprovedBoard(page);
    await page.locator('[data-region="rail"] [data-view="board"]').click();
    await page.locator('[data-board-tab="firmware"]').click();
    const notice = page.locator('[data-region="read-only-notice"]');
    const update = notice.locator('[data-action="notice-update"]');
    await expect(update).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText('Update to 451.00');
    await shot(page, SHOT_DIR, `notice-${theme}-1280`);
    await update.click();
    const confirm = page.locator('[data-region="flash-confirm"]');
    await expect(confirm.locator('[data-safety="W11"]')).toBeInViewport({ timeout: 20_000 });
    await expect(confirm.locator('[data-safety="C6"]')).toContainText('to 451.00');
    await expect(confirm.locator('[data-action="confirm-flash"]')).toBeDisabled();
    await expect(page.locator('#board-pane-firmware [data-subtab="update"]')).toHaveAttribute('aria-selected', 'true');
    await expect(update).toHaveCount(0);
    expect(await pageWrites(worker)).toBe(0);
    await shot(page, SHOT_DIR, `notice-c6-${theme}-1280`);
    await confirm.locator('[data-action="cancel-flash"]').click();
    await expect(confirm).toHaveCount(0);
    await expect(update).toBeVisible();
    // From another Board tab it goes to the same place.
    await page.locator('[data-board-tab="overview"]').click();
    await update.click();
    await expect(page.locator('[data-board-tab="firmware"]')).toHaveAttribute('aria-selected', 'true');
    await expect(confirm.locator('[data-safety="W11"]')).toBeInViewport({ timeout: 20_000 });
    expect(await pageWrites(worker)).toBe(0);
  });
}
