/**
 * "Firmware update available" (owner, 2026-11-09) in the built app (fake-serial TEST build): the simulated board
 * is given edge-next 450.01 (hardware 8), older than the newest the signed staging list names for it (450.02), so
 * after a connect the page offers it. The default simulated board already runs 450.02 and is offered nothing. Not now hides it for the page; Go to update opens Board → Firmware on that release; "Don't
 * show again for this version" keeps it hidden after a reload; it never opens over the Run step while a job is
 * loaded or running there, and it waits until that is over. With RUN_SCREENSHOTS_DIR set, the modal is captured in
 * light and dark at 1440 px.
 *
 * The shared fixture answers Not now whenever the offer opens (every other spec); this spec removes that handler.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { open, start, zigzag } from './jobFlow.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

interface Session {
  readonly base: string;
  readonly reports: { readonly phase: string };
  readonly identity: { readonly fb?: number } | null;
  readonly job: { readonly phase: string } | null;
}

async function session(worker: Worker): Promise<Session> {
  return ((await request(worker, { v: 3, kind: 'status' })) as { readonly status: { readonly session: Session } }).status.session;
}

async function own(page: Page): Promise<void> {
  await page.removeLocatorHandler(page.locator('[data-action="firmware-offer-later"]'));
}

/** The next simulated board runs edge-next 450.01 (see tools/e2e/fake-serial/transport.ts `next`). */
async function olderBoard(worker: Worker): Promise<void> {
  await worker.evaluate((build) => {
    const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
    scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
    scope.__RUN_FAKE_SERIAL__.next = { build };
  }, OLDER);
}

const OLDER = { fb: 450.01, fv: 0.97, hv: 8, layout: 10002 } as const;

async function connect(page: Page): Promise<Worker> {
  const worker = await machineWorker(page);
  await olderBoard(worker);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  return worker;
}

const offer = (page: Page) => page.locator('[data-region="firmware-offer"]');

for (const theme of ['light', 'dark'] as const) {
  test(`the offer opens after a connect; Not now hides it; Go to update opens that release (${theme})`, async ({ page }) => {
    await own(page);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 900 });
    const worker = await connect(page);
    expect((await session(worker)).identity?.fb).toBe(450.01);
    await expect(offer(page)).toBeVisible({ timeout: 10_000 });
    await expect(offer(page).locator('h2')).toHaveText('Firmware update available');
    await expect(offer(page).locator('[data-firmware-offer="text"]')).toHaveText('This board runs 450.01. 450.02 is released.');
    if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/firmware-offer-1440-${theme}.png` });
    await offer(page).locator('[data-action="firmware-offer-later"]').click();
    await expect(offer(page)).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(offer(page)).toHaveCount(0);

    // A new page asks again; Go to update opens Board → Firmware with that release marked.
    await connect(page);
    await expect(offer(page)).toBeVisible({ timeout: 10_000 });
    await offer(page).locator('[data-action="firmware-offer-go"]').click();
    await expect(page.locator('[data-region="rail"] [data-view="board"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-board-tab="firmware"]')).toHaveAttribute('aria-selected', 'true');
    const row = page.locator('[data-release="tinyg-450.02.hex"]');
    await expect(row).toHaveAttribute('data-release-focus', '');
    await expect(row).toBeInViewport();
    await expect(offer(page)).toHaveCount(0);
    if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/firmware-offer-release-1440-${theme}.png` });
  });
}

test('"Don\'t show again for this version" keeps it closed after a reload', async ({ page }) => {
  await own(page);
  await connect(page);
  await expect(offer(page)).toBeVisible({ timeout: 10_000 });
  await offer(page).locator('[data-action="firmware-offer-never"]').click();
  await expect(offer(page)).toHaveCount(0);
  await connect(page);
  await page.waitForTimeout(3000);
  await expect(offer(page)).toHaveCount(0);
});

test('never over the Run step with a job loaded or running; it waits until that is over', async ({ page }) => {
  await own(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await machineWorker(page);
  // A file open on the Run step from the start: the offer waits while it is checked, started and run there.
  await page.locator('[data-job-step="run"]').click();
  await olderBoard(worker);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await open(page, zigzag(40));
  await page.waitForTimeout(1500);
  await expect(offer(page)).toHaveCount(0);
  await start(page);
  await expect.poll(async () => (await session(worker)).job?.phase, { timeout: 10_000, intervals: [100] }).toBe('running');
  await expect(offer(page)).toHaveCount(0);
  await page.waitForTimeout(2000);
  expect((await session(worker)).job?.phase).toBe('running');
  await expect(offer(page)).toHaveCount(0);
  await expect.poll(async () => (await session(worker)).job?.phase, { timeout: 60_000 }).toBe('done');
  // Still on the Run step with the file open: it keeps waiting. Leaving the step lets it open.
  await page.waitForTimeout(1000);
  await expect(offer(page)).toHaveCount(0);
  await page.locator('[data-job-step="check"]').click();
  await expect(offer(page)).toBeVisible({ timeout: 10_000 });
});

for (const theme of ['light', 'dark'] as const) {
  test(`unapproved board needs an update, once per connection (${theme})`, async ({ page }) => {
    await own(page);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1280, height: 720 });
    const worker = await machineWorker(page);
    await worker.evaluate(() => {
      const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
      scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
      scope.__RUN_FAKE_SERIAL__.next = { build: { fb: 450.03, fv: 0.97, hv: 8, layout: 10002 } };
    });
    expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
    await expect(offer(page)).toBeVisible({ timeout: 10_000 });
    await expect(offer(page).locator('h2')).toHaveText('Firmware update needed');
    await expect(offer(page).locator('[data-firmware-offer="text"]')).toHaveText("Run can't control firmware 450.03. Install 450.02, the newest release Run supports.");
    await expect(offer(page).locator('[data-action="firmware-offer-never"]')).toHaveCount(0);
    if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/firmware-needed-1280-${theme}.png` });
    await offer(page).locator('[data-action="firmware-offer-later"]').click();
    await page.waitForTimeout(1500);
    await expect(offer(page)).toHaveCount(0);
    // Reopen the same board in this page. The epoch changes; Not now does not suppress the next connection.
    expect(await request(worker, { v: 3, kind: 'close' })).toMatchObject({ ok: true });
    await worker.evaluate(() => {
      const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__: { next?: unknown } };
      scope.__RUN_FAKE_SERIAL__.next = { build: { fb: 450.03, fv: 0.97, hv: 8, layout: 10002 } };
    });
    expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
    await expect(offer(page)).toBeVisible({ timeout: 10_000 });
    await offer(page).locator('[data-action="firmware-offer-go"]').click();
    await expect(page.locator('[data-board-tab="firmware"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-release="tinyg-450.02.hex"]')).toHaveAttribute('data-release-focus', '');
  });
}
