/**
 * The firmware update in the built app (fake-serial TEST build; SAFETY §4.8
 * as amended 2026-11-03, H79-H89, T-S127). The board is the test kit's
 * flashable board: the xboot model plus the edge-next model running whatever
 * the application section holds. The images are the simulated ones in
 * firmware/sim/ (hardware version 99, simulator only); the page fetches them
 * from /firmware/sim/, which this spec serves from the repository.
 *
 * - A full update across an EEPROM layout change: C6, the backups, the
 *   progress, the reconnect and version check, the required restore, the
 *   switch check, then jog unlocked.
 * - Recovery after USB is pulled mid-flash.
 * - Putting a firmware backup back.
 * - Custom firmware: read-only without trust, approved with it.
 *
 * With RUN_FLASHER_SHOTS set to a directory, screenshots at 1440 px are
 * written there.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const SHOTS = process.env['RUN_FLASHER_SHOTS'];
const REPO = resolve(import.meta.dirname, '../../..');

interface Status {
  readonly status: { readonly session: { readonly base: string; readonly overlays: readonly string[]; readonly identity: { readonly fb?: number; readonly id?: string } | null; readonly classification: { readonly mode: string; readonly approvalSource?: string } | null } };
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

async function serveSim(page: Page): Promise<void> {
  await page.route('**/firmware/sim/*.hex', (route) => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1) as string;
    route.fulfill({ status: 200, contentType: 'text/plain', body: readFileSync(join(REPO, 'firmware/sim', file), 'utf8') }).catch(() => undefined);
  });
}

/** Sets up the persistent flashable board before the first open. */
async function flashableBoard(worker: Worker, eeprom: Record<string, number>, flash?: 'custom'): Promise<void> {
  await worker.evaluate(
    ({ eeprom: e }) => {
      const g = globalThis as unknown as Record<string, { ports: unknown[]; flashable?: unknown } | undefined>;
      const reg = g['__RUN_FAKE_SERIAL__'] ?? { ports: [] };
      g['__RUN_FAKE_SERIAL__'] = reg;
      reg.flashable = { eeprom: { ...e }, id: 'SIM-FLASH-1' };
    },
    { eeprom, flash },
  );
}

/** Calls a method on the persistent board inside the worker. */
function boardDo(worker: Worker, what: 'pull' | 'replug' | 'press' | 'release', input = 0): Promise<unknown> {
  return worker.evaluate(
    ({ what: w, input: n }) => {
      interface Board {
        readonly device: { powerCycle(): void; setInput(n: number, c: boolean): void; readonly state: string };
        readonly endpoint: { disconnect(r: string): void; reconnect(): void };
      }
      const reg = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { board?: Board } }).__RUN_FAKE_SERIAL__;
      const b = reg?.board;
      if (b === undefined) throw new Error('no flashable board');
      if (w === 'pull') b.endpoint.disconnect('USB pulled');
      if (w === 'replug') {
        b.endpoint.reconnect();
        b.device.powerCycle();
      }
      if (w === 'press') b.device.setInput(n, true);
      if (w === 'release') b.device.setInput(n, false);
      return b.device.state;
    },
    { what, input },
  );
}

function pageWrites(worker: Worker): Promise<number> {
  return worker.evaluate(() => (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { board?: { device: { xboot: { pageWrites: unknown[]; eraseCount: number } } } } }).__RUN_FAKE_SERIAL__?.board?.device.xboot.pageWrites.length ?? 0);
}

function eraseCount(worker: Worker): Promise<number> {
  return worker.evaluate(() => (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { board?: { device: { xboot: { eraseCount: number } } } } }).__RUN_FAKE_SERIAL__?.board?.device.xboot.eraseCount ?? -1);
}

async function status(worker: Worker): Promise<Status['status']> {
  return ((await request(worker, { v: 3, kind: 'status' })) as Status).status;
}

async function connect(page: Page, worker: Worker, extra: Record<string, unknown> = {}): Promise<void> {
  expect(await request(worker, { v: 3, kind: 'open', port: PORT, ...extra })).toMatchObject({ ok: true });
  await expect.poll(async () => (await status(worker)).session.base, { timeout: 15_000 }).toMatch(/IDLE_UNHOMED|CONNECTED_UNKNOWN/);
  void page;
}

async function openFirmware(page: Page, tab: 'firmware' | 'backups' = 'firmware'): Promise<void> {
  await page.locator('[data-region="rail"] [data-view="board"]').click();
  await expect(page.locator('[data-screen="board"]')).toBeVisible();
  const w29 = page.locator('[data-action="dismiss-w29"]');
  if ((await w29.count()) > 0) await w29.click();
  await page.locator(`[data-board-tab="${tab}"]`).click();
}

/** Ticks the C6 boxes in order and confirms. */
async function confirmFlash(page: Page): Promise<void> {
  const dialog = page.locator('[data-region="flash-confirm"]').first();
  await expect(dialog).toBeVisible();
  const boxes = dialog.locator('input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await dialog.locator('[data-action="confirm-flash"]').click();
}

async function waitDone(page: Page): Promise<void> {
  await expect(page.locator('[data-region="flash-done"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-version-check="ok"]')).toBeVisible({ timeout: 30_000 });
}

test('a full update across an EEPROM layout change: backups, progress, version check, required restore, switch check, unlocked', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveSim(page);
  const worker = await machineWorker(page);
  await flashableBoard(worker, { __layout: 10002, st: 1, zsn: 1 });
  await connect(page, worker);
  expect((await status(worker)).session.identity?.fb).toBe(450.01);
  await openFirmware(page);
  const release = page.locator('[data-release="sim-edge-next-451.00.hex"]');
  await expect(release).toBeVisible({ timeout: 20_000 });
  await expect(release.locator('.changelog')).toContainText('new EEPROM layout');
  await expect(release.locator('[data-action="update-release"]')).toBeEnabled({ timeout: 20_000 });
  await shot(page, 'update-panel-changelog');
  await release.locator('[data-action="update-release"]').click();
  await expect(page.locator('[data-region="flash-confirm"] [data-safety="W11"]')).toBeVisible();
  await confirmFlash(page);
  await expect(page.locator('[data-region="firmware-update"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-flash-phase="write"], [data-flash-phase="verify"]')).toBeVisible({ timeout: 90_000 });
  await shot(page, 'update-progress');
  await waitDone(page);
  expect(await eraseCount(worker)).toBe(0);
  expect((await status(worker)).session.identity?.fb).toBe(451);
  // The settings check: the new layout loaded the defaults, so the restore is required and jog is locked.
  await expect(page.locator('[data-post-flash="restoreRequired"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-safety="W45"]')).toBeVisible();
  const jog = (await request(worker, { v: 3, kind: 'motion', command: { op: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 } })) as { ok: boolean };
  expect(jog.ok).toBe(false);
  await shot(page, 'update-restore-required');
  const verify = page.locator('[data-action="post-flash-verify"]');
  if ((await verify.count()) > 0) await verify.click();
  await page.locator('[data-action="restore-after-flash"]').click();
  // The backed-up values are pending changes; Apply asks for its usual confirmation (C5, WRITE for the switch keys).
  const tray = page.locator('[data-region="pending-changes"]');
  await expect(tray.locator('[data-pending-key="st"]')).toBeVisible({ timeout: 20_000 });
  await tray.locator('[data-action="apply-settings"]').click();
  const apply = page.locator('[data-dialog="apply-confirm"]');
  await expect(apply).toBeVisible({ timeout: 20_000 });
  for (const box of await apply.locator('input[type="checkbox"]').all()) await box.check();
  const typed = apply.locator('#apply-typed');
  if ((await typed.count()) > 0) await typed.fill('WRITE');
  await apply.locator('[data-action="confirm-apply"]').click();
  await expect(page.locator('[data-post-flash="switchCheck"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-safety="W46"]')).toContainText('Check your limit switches. The update changed the switch settings.');
  await page.locator('[data-action="switch-test-start"]').click();
  await boardDo(worker, 'press', 5);
  await expect(page.locator('[data-switch-input="5"]')).toHaveAttribute('data-seen', /closed|both/, { timeout: 10_000 });
  await boardDo(worker, 'release', 5);
  await expect(page.locator('[data-switch-input="5"]')).toHaveAttribute('data-seen', 'both', { timeout: 10_000 });
  await shot(page, 'switch-check');
  await page.locator('[data-action="switch-test-done"]').click();
  await expect(page.locator('[data-region="post-flash"]')).toHaveCount(0, { timeout: 10_000 });
  // The Backups tab lists the settings backup taken before this update; the Firmware tab its firmware image backup
  // (owner, 2026-11-09: one Firmware tab and one Backups tab).
  await page.locator('[data-board-tab="backups"]').click();
  await expect(page.locator('[data-backup-trigger="before-update"]').first()).toBeVisible();
  await shot(page, 'backups-hub');
  await page.locator('[data-board-tab="firmware"]').click();
  await expect(page.locator('[data-firmware-backups="1"]')).toBeVisible();
});

test('recovery: USB pulled mid-flash leaves no application; unplug and replug during the countdown, and the same image is flashed', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveSim(page);
  const worker = await machineWorker(page);
  await flashableBoard(worker, { __layout: 10002 });
  await connect(page, worker);
  await openFirmware(page);
  const release = page.locator('[data-release="sim-edge-next-450.02.hex"]');
  await expect(release.locator('[data-action="update-release"]')).toBeEnabled({ timeout: 20_000 });
  await release.locator('[data-action="update-release"]').click();
  await confirmFlash(page);
  await expect.poll(() => pageWrites(worker), { timeout: 90_000 }).toBeGreaterThan(30);
  await boardDo(worker, 'pull');
  await expect(page.locator('[data-region="flash-recovery"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-action="flash-recover"]').click();
  await expect(page.locator('[data-safety="W49"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-safety="W49"]')).toContainText('Unplug the USB cable and plug it back in now.');
  await shot(page, 'recovery-countdown');
  await boardDo(worker, 'replug');
  await waitDone(page);
  expect((await status(worker)).session.identity?.fb).toBe(450.02);
  expect(await eraseCount(worker)).toBe(0);
});

test('put a firmware backup back: the image read before the update returns the board to 450.01', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveSim(page);
  const worker = await machineWorker(page);
  await flashableBoard(worker, { __layout: 10002 });
  await connect(page, worker);
  await openFirmware(page);
  const release = page.locator('[data-release="sim-edge-next-450.02.hex"]');
  await expect(release.locator('[data-action="update-release"]')).toBeEnabled({ timeout: 20_000 });
  await release.locator('[data-action="update-release"]').click();
  await confirmFlash(page);
  await waitDone(page);
  expect((await status(worker)).session.identity?.fb).toBe(450.02);
  await page.locator('[data-board-tab="firmware"]').click();
  const putBack = page.locator('[data-action="firmware-put-back"]').first();
  await expect(putBack).toBeEnabled({ timeout: 30_000 });
  await putBack.click();
  await confirmFlash(page);
  await page.locator('[data-board-tab="firmware"]').click();
  await expect(page.locator('[data-region="firmware-update"]')).toBeVisible({ timeout: 60_000 });
  await waitDone(page);
  await expect.poll(async () => (await status(worker)).session.identity?.fb, { timeout: 30_000 }).toBe(450.01);
});

test('custom firmware: labelled unsigned, read-only after the update; trusted on this board it is approved, with the banner', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveSim(page);
  const worker = await machineWorker(page);
  await flashableBoard(worker, { __layout: 10002 });
  await connect(page, worker);
  await openFirmware(page, 'firmware');
  // W47 is shown where the decision is made (the confirmation), not as a permanent banner (OD-9).
  await expect(page.locator('[data-safety="W47"]')).toHaveCount(0);
  const input = page.locator('[data-action="custom-file"]');
  await expect(input).toBeEnabled({ timeout: 20_000 });
  await input.setInputFiles({ name: 'my-tinyg.hex', mimeType: 'text/plain', buffer: readFileSync(join(REPO, 'firmware/sim/sim-custom-450.90.hex')) });
  await expect(page.locator('[data-region="flash-confirm"] [data-safety="W47"]')).toBeVisible();
  await expect(page.locator('[data-region="flash-confirm"] [data-safety="C37"]')).toBeVisible();
  await confirmFlash(page);
  await page.locator('[data-board-tab="firmware"]').click();
  await waitDone(page);
  const after = await status(worker);
  expect(after.session.identity?.fb).toBe(450.9);
  expect(after.session.overlays).toContain('READ_ONLY');
  // Trust it on this board (C38).
  await expect(page.locator('[data-region="trust-offer"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-action="trust-open"]').click();
  await expect(page.locator('[data-safety="C38"]')).toBeVisible();
  await expect(page.locator('[data-safety="C38"]')).toContainText('you can revoke it in Board → Firmware.');
  await shot(page, 'custom-firmware-trust');
  await page.locator('[data-action="trust-confirm"]').click();
  // C38 names where it is revoked: the Firmware tab lists the trusted build with Revoke.
  await page.locator('[data-board-tab="firmware"]').click();
  await expect(page.locator('[data-trusted="1"]')).toBeVisible();
  await expect(page.locator('[data-trusted="1"] [data-action="trust-revoke"]')).toBeVisible();
  // The page sends the trust at Connect; here the spec reconnects the way the page does.
  const trustRecord = await page.evaluate(async () => {
    const open = indexedDB.open('device-safety', 1);
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const tx = db.transaction('kv', 'readonly').objectStore('kv');
    const keys: IDBValidKey[] = await new Promise((res) => {
      const r = tx.getAllKeys();
      r.onsuccess = () => res(r.result);
    });
    const key = keys.find((k) => typeof k === 'string' && k.startsWith('trust/'));
    const value = await new Promise((res) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').get(key as IDBValidKey);
      r.onsuccess = () => res(r.result);
    });
    return value as { boardId: string; sha256: string; dialect: string; fb: number; fbs: string | null; name: string };
  });
  expect(await request(worker, { v: 3, kind: 'close' })).toMatchObject({ ok: true });
  await boardDo(worker, 'replug');
  await page.waitForTimeout(6000);
  const { boardId, sha256, dialect, fb, fbs, name } = trustRecord;
  await connect(page, worker, { trusted: [{ boardId, sha256, dialect, fb, fbs, name }] });
  await expect.poll(async () => (await status(worker)).session.classification?.approvalSource, { timeout: 15_000 }).toBe('trusted');
  expect((await status(worker)).session.overlays).not.toContain('READ_ONLY');
  await expect(page.locator('[data-region="machine-strip"]')).toContainText('Custom firmware (trusted by you)');
  await shot(page, 'custom-firmware-trusted-banner');
});
