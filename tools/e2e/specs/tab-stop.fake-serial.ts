/**
 * ROADMAP P1-06 in the built app (fake-serial TEST build): the machine Web
 * Lock, cross-tab stop requests, W29 and STOP NOT DELIVERED (T-S29, T-S73,
 * the automatable half of HIL-1.7 and HIL-1.11), and Escape (T-S18).
 *
 * Two pages of one browser context are two tabs of one browser: they share
 * the Web Locks and the BroadcastChannel. Tab A's worker opens the mock
 * board; tab B never connects.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { STOP_TEXT, w29 } from '../../../packages/safety/src/strings.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const BOARD = 'SIM-EN-0001';

/** Every write tab A's worker made to the simulated board, as text. */
function writes(worker: Worker): Promise<string[]> {
  return worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly Entry[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports[0]?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data));
  });
}

async function connectedTab(page: Page): Promise<Worker> {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect
    .poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: { base: string } } }).status.session.base, { timeout: 10_000 })
    .toBe('CONNECTED_UNKNOWN');
  return worker;
}

function bangs(list: readonly string[]): number {
  return list.filter((w) => w === '!').length;
}

function phase1Only(list: readonly string[]): void {
  for (const w of list) {
    expect(w.includes('\x18') || w.includes('\x04'), JSON.stringify(w)).toBe(false);
    expect(/^\{"[a-z0-9_]+":null\}\n$/.test(w) || w === '!', JSON.stringify(w)).toBe(true);
  }
}

test('an observer tab sees the lock, its request reaches the worker while tab A is frozen (T-S29), and W29 follows tab A closing (T-S73)', async ({ page }) => {
  const workerA = await connectedTab(page);
  // The lock is held under the board id, in this browser.
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.map((l) => l.name))).toEqual([`synthetos-machine:${BOARD}`]);

  const tabB = await page.context().newPage();
  await tabB.goto('/');
  await expect(tabB.locator('html')).toHaveAttribute('data-ready', 'true');
  const observer = tabB.locator('[data-observer="controlled"]');
  await expect(observer).toContainText(STOP_TEXT.controlledElsewhere);
  await expect(observer).toContainText(BOARD);
  await expect(tabB.locator('.stop-button')).toBeEnabled();

  const before = bangs(await writes(workerA));
  // Freeze tab A's main thread for 3 s (HIL-1.7 shape): only its worker can answer.
  void page.evaluate(() => {
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      /* busy */
    }
  }).catch(() => undefined);
  await tabB.locator('[data-action="pause-request"]').click();
  await expect(tabB.locator('[data-stop-outcome="delivered"]')).toContainText(BOARD);
  expect(bangs(await writes(workerA))).toBe(before + 1);

  await tabB.locator('[data-action="stop-job-request"]').click();
  await expect.poll(async () => bangs(await writes(workerA))).toBe(before + 2);
  phase1Only(await writes(workerA));

  // Tab A goes away: the browser releases its lock and tab B shows W29 in place of the request buttons.
  await page.close();
  const w29Banner = tabB.locator('[data-safety="W29"]');
  await expect(w29Banner).toContainText(w29().slice(w29().indexOf(' — ') + 3));
  await expect(tabB.locator('[data-action="pause-request"]')).toHaveCount(0);
});

test('a blocked worker leaves the request unacknowledged: STOP NOT DELIVERED (T-S73, HIL-1.11)', async ({ page }) => {
  const workerA = await connectedTab(page);
  const tabB = await page.context().newPage();
  await tabB.goto('/');
  await expect(tabB.locator('[data-observer="controlled"]')).toBeVisible();
  void workerA.evaluate(() => {
    const end = Date.now() + 2000;
    while (Date.now() < end) {
      /* busy */
    }
  }).catch(() => undefined);
  await tabB.locator('[data-action="pause-request"]').click();
  const line = tabB.locator('[data-stop-outcome="not-delivered"]');
  await expect(line).toHaveText(`${STOP_TEXT.notDelivered} (${BOARD})`);
  await expect(line).toHaveAttribute('role', 'alert');
});

test('Escape from any focus pauses through the worker; Space never does (T-S18)', async ({ page }) => {
  const worker = await connectedTab(page);
  const before = bangs(await writes(worker));
  await page.locator('[data-action="connect"]').focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(bangs(await writes(worker))).toBe(before);
  await page.keyboard.press('Escape');
  await expect.poll(async () => bangs(await writes(worker))).toBe(before + 1);
  // The stop button stays visible and focusable.
  await expect(page.locator('.stop-button')).toBeVisible();
});
