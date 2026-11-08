import type { Page, Worker } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;

async function library(page: Page): Promise<void> {
  await page.locator('[data-region="rail"] [data-view="library"]').click();
  await page.locator('[data-tab="catalogue"]').click();
  await page.locator('[data-template="xcarve"] [data-action="copy-machine"]').click();
}

function eepromWrites(worker: Worker): Promise<number> {
  return worker.evaluate(() => {
    const fake = (globalThis as unknown as { __RUN_FAKE_SERIAL__: { ports: { endpoint: { device: { eepromWrites: number } } }[] } }).__RUN_FAKE_SERIAL__;
    return fake.ports.at(-1)?.endpoint.device.eepromWrites ?? -1;
  });
}

test('guided settings stage only, survive level changes, and reach the existing review and C5 flow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await library(page);
  const screen = page.locator('[data-screen="library"]');
  // The board's settings are their own tab beside the machine profile.
  await screen.locator('[data-tab="settings"]').click();
  const guided = screen.locator('[data-region="guided-settings"]');
  const feed = guided.locator('[data-setting-edit="xfr"]');
  await expect(feed).toBeEnabled();
  await expect(feed).toHaveAttribute('placeholder', /\d/);
  await expect(guided.locator('[data-guided-axis]')).toHaveCount(3);
  const initial = await eepromWrites(worker);
  const next = Number(await feed.getAttribute('placeholder')) - 100;
  await feed.fill(String(next));
  // A pushed live snapshot must preserve text that has not been committed by blur.
  await worker.evaluate(() => {
    const fake = (globalThis as unknown as { __RUN_FAKE_SERIAL__: { ports: { endpoint: { device: { setMachinePosition(p: Record<string, number>): void } } }[] } }).__RUN_FAKE_SERIAL__;
    fake.ports.at(-1)?.endpoint.device.setMachinePosition({ x: 12.5 });
  });
  await expect(page.locator('[data-position-axis="x"] [data-position="machine"]')).toHaveText('12.500');
  await expect(feed).toHaveValue(String(next));
  await feed.press('Tab');
  await expect(screen.locator('[data-action="machine-review-settings"]')).toHaveText('Review 1 pending change');
  expect(await eepromWrites(worker)).toBe(initial);
  await page.locator('[data-action="ui-level-advanced"]').click();
  await expect(guided).toHaveCount(0);
  await screen.getByText('All board settings', { exact: true }).click();
  await expect(screen.locator('[data-region="all-settings"] [data-setting-edit="xfr"]')).toHaveValue(String(next));
  await expect(screen.locator('[data-region="tinyg-mapping"] thead th')).toHaveCount(5);
  await screen.locator('[data-region="tinyg-mapping"]').scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('library-advanced-connected.png') });
  const advancedAxe = await new AxeBuilder({ page }).include('[data-screen="library"]').analyze();
  expect(advancedAxe.violations.map((v) => v.id)).toEqual([]);
  await page.locator('[data-action="ui-level-simple"]').click();
  await expect(feed).toHaveValue(String(next));
  await screen.locator('[data-action="machine-review-settings"]').click();
  await expect(page.locator('#board-pane-settings')).toBeVisible();
  await expect(page.locator('[data-region="pending-changes"] [data-pending-key="xfr"]')).toBeVisible();
  await page.locator('[data-action="apply-settings"]').click();
  await expect(page.locator('[data-dialog="apply-confirm"] [data-c5]')).toBeVisible();
  expect(await eepromWrites(worker)).toBe(initial);
  await page.locator('[data-action="cancel-apply"]').click();
  await page.locator('[data-region="rail"] [data-view="library"]').click();
  await page.locator('[data-action="ui-level-advanced"]').click();
  await screen.locator('[data-action="machine-backups"]').click();
  await expect(page.locator('#board-pane-backups')).toBeVisible();
  await page.locator('[data-region="rail"] [data-view="library"]').click();
  await page.locator('[data-action="ui-level-simple"]').click();
  await feed.scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('library-guided-connected.png') });
});

test('machine and settings share a centred page with a compact bed in both interface levels', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await library(page);
  const screen = page.locator('[data-screen="library"]');
  await expect(screen.locator('[role="tablist"][aria-label="Machines"] [role="tab"]')).toHaveText(['Your machine', 'TinyG settings', 'Start from a machine']);
  await expect(screen.locator('[data-machine="bed"]')).toBeVisible();
  // The profile tab no longer carries the board's settings.
  await expect(screen.locator('[data-machine-settings]')).toBeHidden();
  const width = screen.getByLabel('Width, bed', { exact: true });
  await width.fill('760');
  await width.press('Tab');
  await expect(screen.locator('[data-machine="bed-note"]')).toContainText('Saved');
  for (const size of [1280, 390]) {
    await page.setViewportSize({ width: size, height: size === 390 ? 844 : 720 });
    for (const level of ['simple', 'advanced']) {
      await page.locator(`[data-action="ui-level-${level}"]`).click();
      const bounds = await screen.locator('.machines-view').boundingBox();
      expect(bounds?.width).toBeLessThanOrEqual(1000);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size);
      await screen.locator('#mach-pane-mine > .scroll-region').evaluate((el) => { el.scrollTop = 0; });
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`library-${size}-${level}.png`) });
    }
  }
  await page.locator('[data-action="ui-level-simple"]').click();
  await screen.locator('[data-tab="settings"]').click();
  await expect(screen.locator('[data-machine-settings="simple"]')).toBeVisible();
  await screen.locator('[data-region="guided-settings"] input').first().scrollIntoViewIfNeeded();
  await expect(screen.locator('[data-region="guided-settings"] input').first()).toBeDisabled();
  await expect(screen.locator('[data-region="guided-settings"] input').first()).toHaveAttribute('title', /Connect/);
  const axe = await new AxeBuilder({ page }).include('[data-screen="library"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('settings that differ from the reference raise no banner at connect (OD-17); the difference is shown in Board', async ({ page }) => {
  const worker = await machineWorker(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('device-safety', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('kv'); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ deviceHash: '0'.repeat(64), settings: { xfr: 123 }, at: '2026-11-01T00:00:00Z' }, 'settings-reference/tinyg-en/SIM-EN-0001');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: { reports: { phase: string } } } }).status.session.reports.phase, { timeout: 10_000 }).toBe('done');
  await expect(page.locator('[data-region="review-exits"]')).toHaveCount(0);
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: { overlays: readonly string[] } } }).status.session.overlays).not.toContain('NEEDS_REVIEW');
  await page.locator('[data-region="rail"] [data-view="board"]').click();
  await page.locator('[data-board-tab="settings"]').click();
  await expect(page.locator('[data-settings="drift"]')).toBeVisible();
});
