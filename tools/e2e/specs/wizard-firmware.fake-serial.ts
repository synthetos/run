/**
 * The setup wizard's firmware step (owner 167, 2026-11-19) in the built app against the fake serial flashable board
 * (flasher.fake-serial.ts): the step shows only where the board stands and one "Update firmware" button, with no
 * release list and nothing that scrolls inside the frame. The button leaves the wizard for Board → Firmware → Update,
 * the full page, which offers "Back to setup". The update starts there with the usual C6 confirm in full view, and
 * after it the step re-checks the board and offers Next. RUN_SCREENSHOTS=1 writes the pictures to
 * docs/design/screenshots/wizard-firmware/.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { request } from './machineWorker.ts';
import { setupRecord } from './accountRecords.ts';
import { next, open, shot as shotIn, step, wizard } from './wizardPage.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const SHOT_DIR = new URL('../../../docs/design/screenshots/wizard-firmware/', import.meta.url).pathname;
const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const RELEASE = '[data-release="sim-edge-next-451.00.hex"]';

/** The test kit's flashable board on 450.01 (hardware 99), with the simulated release images served. */
async function flashableOnStep3(page: Page, theme: 'light' | 'dark'): Promise<Worker> {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/firmware/sim/*.hex', (route) => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1) as string;
    route.fulfill({ status: 200, contentType: 'text/plain', body: readFileSync(join(REPO, 'firmware/sim', file), 'utf8') }).catch(() => undefined);
  });
  const { worker } = await open(page, [setupRecord({ step: 3, done: [1, 2] })], 3);
  await worker.evaluate(() => {
    const g = globalThis as unknown as Record<string, { ports: unknown[]; flashable?: unknown } | undefined>;
    const reg = g['__RUN_FAKE_SERIAL__'] ?? { ports: [] };
    g['__RUN_FAKE_SERIAL__'] = reg;
    reg.flashable = { eeprom: { __layout: 10002 }, id: 'SIM-FLASH-1' };
  });
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect(page.locator('[data-firmware-step="text"]')).toBeVisible({ timeout: 20_000 });
  return worker;
}

/** Nothing scrolls: not the page, not the wizard's body. */
async function scrolls(page: Page): Promise<{ page: boolean; body: boolean }> {
  return page.evaluate(() => {
    const body = document.querySelector('.wizard-body');
    return { page: document.documentElement.scrollHeight > window.innerHeight, body: body !== null && body.scrollHeight > body.clientHeight };
  });
}

/** True when the element's box lies wholly inside the viewport and inside every clipping ancestor. */
function wholeInView(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) return false;
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if (o === 'visible') continue;
      const c = p.getBoundingClientRect();
      if (r.top < c.top - 1 || r.bottom > c.bottom + 1) return false;
    }
    return true;
  });
}

/**
 * Opening the port from the worker leaves this tab an observer (W29), again after the update's reconnect; a person
 * who connected here never sees it. Out of the wizard the app is live again, so the shared handler comes back.
 */
async function dismissW29(page: Page): Promise<void> {
  await page.addLocatorHandler(page.locator('[data-action="dismiss-w29"]'), async (ok) => { await ok.click(); });
  const w29 = page.locator('[data-action="dismiss-w29"]');
  await w29.waitFor({ timeout: 3_000 }).then(() => w29.click(), () => undefined);
}

/** Step 3 → Update firmware → Board → Firmware → Update with Back to setup, then C6 in full view and the update started. */
async function updateFromTheStep(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const frame = wizard(page);
  await expect(frame.locator('table.wizard-facts')).toContainText('TinyG 450.01');
  await expect(frame.locator('table.wizard-facts')).toContainText('TinyG 451.00');
  // Once the board is read and at rest the offer is up: no held line, just Update firmware.
  await expect(frame.locator('[data-firmware-step="held"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(frame.locator('[data-region="firmware-releases"], [data-action="update-release"]')).toHaveCount(0);
  await expect.poll(() => scrolls(page)).toEqual({ page: false, body: false });
  await shotIn(page, SHOT_DIR, `step-${theme}-1280`);
  await frame.locator('[data-action="wizard-update"]').click();
  await expect(page.locator('[data-wizard-step]')).toHaveCount(0);
  await expect(page.locator('[inert]')).toHaveCount(0);
  await dismissW29(page);
  await expect(page.locator('[data-screen="board"]')).toBeVisible();
  await expect(page.locator('[data-board-tab="firmware"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#board-pane-firmware [data-subtab="update"]')).toHaveAttribute('aria-selected', 'true');
  // Already on the update: the offer modal does not cover the page.
  await expect(page.locator('[data-region="firmware-offer"]')).toHaveCount(0);
  await expect(page.locator('[data-action="back-to-setup"]')).toBeVisible();
  const release = page.locator(RELEASE);
  await expect(release).toHaveAttribute('data-release-focus', '', { timeout: 20_000 });
  await expect(release.locator('[data-action="update-release"]')).toBeEnabled({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(false);
  await shotIn(page, SHOT_DIR, `firmware-page-${theme}-1280`);
  await release.locator('[data-action="update-release"]').click();
  // The click answers in view with the C6 confirm.
  const confirm = page.locator('[data-region="flash-confirm"]');
  await expect(confirm.locator('[data-safety="W11"]')).toBeVisible({ timeout: 20_000 });
  // It opens at its head, with Cancel focused: W11 stays wholly in view (the focus used to scroll the column to Cancel).
  await expect(confirm.locator('[data-action="cancel-flash"]')).toBeFocused();
  await page.waitForTimeout(300);
  expect(await wholeInView(page, '[data-region="flash-confirm"] [data-safety="W11"]')).toBe(true);
  await shotIn(page, SHOT_DIR, `confirm-${theme}-1280`);
  await expect(confirm.locator('[data-action="confirm-flash"]')).toBeDisabled();
  const boxes = confirm.locator('input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await confirm.locator('[data-action="confirm-flash"]').click();
  await expect(page.locator('[data-region="firmware-update"]')).toBeVisible({ timeout: 60_000 });
  // Backups first: the board's settings and current firmware are read before anything is written.
  await expect(page.locator('[data-flash-phase="backup"], [data-flash-phase="saving"], [data-flash-phase="write"]')).toBeVisible({ timeout: 60_000 });
  await shotIn(page, SHOT_DIR, `update-started-${theme}-1280`);
}

test('the step shows the standing and Update firmware; the full Firmware page runs the update; Back to setup re-checks and offers Next (light)', async ({ page }) => {
  test.setTimeout(240_000);
  const worker = await flashableOnStep3(page, 'light');
  await updateFromTheStep(page, 'light');
  await expect(page.locator('[data-region="flash-done"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-version-check="ok"]')).toBeVisible({ timeout: 30_000 });
  const status = (await request(worker, { v: 3, kind: 'status' })) as { status: { session: { identity: { fb?: number } | null } } };
  expect(status.status.session.identity?.fb).toBe(451);
  await page.locator('[data-action="back-to-setup"]').click();
  await expect(step(page, 3)).toBeVisible();
  await expect(page.locator('[data-firmware-step="current"]')).toHaveText('Firmware 451.00 is current.', { timeout: 20_000 });
  await expect(next(page)).toBeEnabled();
  await expect(page.locator('[data-action="back-to-setup"]')).toHaveCount(0);
});

test('the same in dark, up to the update started', async ({ page }) => {
  test.setTimeout(120_000);
  await flashableOnStep3(page, 'dark');
  await updateFromTheStep(page, 'dark');
});
