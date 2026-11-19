/**
 * Board settings in the built app (fake-serial TEST build; Board settings spec 2026-11-18, OD-44; SAFETY §4.6).
 *
 * - A read-only board (the edge-next simulator reporting 449.01, READ_ONLY): one notice says why with the way out,
 *   no setting control is enabled, there is no pending bar and no Restore.
 * - An approved board: X min set to "Homing and limit" on Inputs becomes one pending, high-risk change; Review and
 *   apply opens the diff; Apply asks C5 with the switch consequence; the backup downloads before anything is written;
 *   xsn is written once and read back; Revert writes the backed-up value back.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { session } from './jobFlow.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const READ_ONLY = { build: { fb: 449.01, fv: 0.97, hv: 8, layout: 10002 } };

async function connect(page: Page, board?: Record<string, unknown>): Promise<Worker> {
  await page.setViewportSize({ width: 1280, height: 900 });
  const worker = await machineWorker(page);
  if (board !== undefined) {
    await worker.evaluate((o) => {
      const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
      scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
      scope.__RUN_FAKE_SERIAL__.next = o;
    }, board);
  }
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => { const s = await session(worker); return s.reports.phase === 'done' || s.overlays.includes('READ_ONLY'); }, { timeout: 10_000 }).toBe(true);
  await page.locator('[data-region="rail"] [data-view="board"]').click();
  await expect(page.locator('[data-screen="board"]')).toBeVisible();
  return worker;
}

/** The simulated board's value of one setting: as stored in its EEPROM (`stored`), or as it runs now. */
function boardValue(worker: Worker, key: string, stored: boolean): Promise<unknown> {
  return worker.evaluate(([k, s]) => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: { settings: { eeprom: Record<string, unknown>; get(k: string): unknown } } } }[] } }).__RUN_FAKE_SERIAL__;
    const settings = registry?.ports.at(-1)?.endpoint.device.settings;
    return s ? settings?.eeprom[k as string] : settings?.get(k as string);
  }, [key, stored] as const);
}

test('a read-only board: one notice with the way out, nothing editable, no bar, no Restore', async ({ page }) => {
  await connect(page, READ_ONLY);
  const notice = page.locator('[data-region="read-only-notice"]');
  await expect(notice).toContainText("Run can't change settings on firmware 449.01. You can see every setting and back them up.");
  await expect(notice.locator('[data-action="notice-update"]')).toBeVisible();
  for (const tab of ['motors', 'axes', 'inputs', 'io', 'settings']) {
    await page.locator(`[data-board-tab="${tab}"]`).click();
    await expect(page.locator(`#board-pane-${tab} [data-setting-control]`).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`#board-pane-${tab} [data-setting-control] :is(input, select, button):enabled`)).toHaveCount(0);
  }
  await expect(page.locator('[data-region="pending-bar"]')).toHaveCount(0);
  await page.locator('[data-board-tab="backups"]').click();
  await expect(page.locator('[data-action="backup-restore"]')).toHaveCount(0);
});

test('an approved board: X min to "Homing and limit", review, C5, backup first, written and read back, then Revert', async ({ page }) => {
  test.setTimeout(90_000);
  const worker = await connect(page);
  await page.locator('[data-board-tab="inputs"]').click();
  // The value the board reported, as the control shows it selected (the simulator answers its default until written).
  const selected = page.locator('#board-pane-inputs [data-setting-control="xsn"] [aria-checked="true"]');
  await expect(selected).toHaveCount(1, { timeout: 20_000 });
  const old = Number(await selected.getAttribute('data-value'));
  expect(old).not.toBe(3);
  expect(await boardValue(worker, 'xsn', true)).not.toBe(3);
  await page.locator('#board-pane-inputs [data-setting-control="xsn"] [data-value="3"]').click();

  const bar = page.locator('[data-region="pending-bar"]');
  await expect(bar.locator('[data-pending-count]')).toHaveText('1 change pending');
  await expect(bar).toContainText('1 high risk');
  await bar.locator('[data-action="review-apply"]').click();
  const panel = page.locator('[data-region="pending-changes"]');
  await expect(panel.locator('[data-pending-key="xsn"]')).toContainText('Homing and limit');
  await panel.locator('[data-action="apply-settings"]').click();

  const dialog = page.locator('[data-dialog="apply-confirm"]');
  await expect(dialog.locator('[data-risk-key="xsn"]')).toContainText('Changing the X-min switch');
  await expect(dialog.locator('[data-action="confirm-apply"]')).toBeDisabled();
  for (const box of await dialog.locator('input[type="checkbox"]').all()) await box.check();
  const typed = dialog.locator('#apply-typed');
  if ((await typed.count()) > 0) await typed.fill('WRITE');
  const download = page.waitForEvent('download');
  await dialog.locator('[data-action="confirm-apply"]').click();
  expect((await download).suggestedFilename()).toMatch(/^synthetos-settings-SIM-EN-0001-\d{4}-\d{2}-\d{2}-before-write-\d{6}\.json$/);

  await expect(panel.locator('[data-apply-step="xsn"]')).toHaveAttribute('data-step-status', 'verified', { timeout: 20_000 });
  await expect.poll(() => boardValue(worker, 'xsn', true), { timeout: 10_000 }).toBe(3);

  await panel.locator('[data-action="revert-settings"]').click();
  await expect(panel.locator('[data-apply="done"][data-apply-mode="revert"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => boardValue(worker, 'xsn', true), { timeout: 10_000 }).toBe(old);
});
