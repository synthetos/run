/**
 * "Homed" means a homing cycle (first-time walk 2026-11-08, S2), in the built app (fake-serial TEST build).
 *
 * - Set machine zero here (G28.3) reads back `home` 1 like a homing does, but the Position tag says
 *   "Position set by hand", in amber, with help that says positions count from the point you set;
 * - a homing cycle on a board with X, Y and Z switches says "Homed", in green.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { PORT, session } from './jobFlow.ts';

/** Homing switches at the maximum end of X, Y and Z, with short travels so homing takes about a second. */
const HOMING_EEPROM = { __layout: 10002, xsx: 1, xsv: 1500, xtm: 20, ysx: 1, ysv: 1500, ytm: 20, zsx: 1, zsv: 1500, ztm: 10 };

/** Connects the simulated board, staying in Simple (the Position panel's quick Home and Set machine zero here). */
async function connectSimple(page: Page, board?: Record<string, unknown>): Promise<Worker> {
  await page.setViewportSize({ width: 1280, height: 720 });
  const worker = await machineWorker(page);
  if (board !== undefined) {
    await worker.evaluate((o) => {
      const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
      scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
      scope.__RUN_FAKE_SERIAL__.next = o;
    }, board);
  }
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).reports.phase, { timeout: 10_000 }).toBe('done');
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  return worker;
}

const TAG = '[data-region="run-inspector"] [data-position="homing"], [data-position="homing"]';

test('Set machine zero here (G28.3) is "Position set by hand" in amber, never "Homed"', async ({ page }) => {
  const worker = await connectSimple(page);
  const tag = page.locator(TAG).first();
  await expect(tag).toContainText('Not homed');
  await page.getByRole('button', { name: 'Set the machine zero here, without homing' }).click();
  await page.locator('[data-region="home-quick"] button', { hasText: 'Set machine position' }).click();
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_HOMED');
  await expect(tag).toContainText('Position set by hand');
  await expect(tag).not.toContainText('Homed');
  await expect(tag).toHaveClass(/\bwarn\b/);
  await expect(tag).toHaveAttribute('data-homed-by', 'hand');
  await expect(tag.locator('.help-copy')).toContainText('not with the homing switches');
});

test('a homing cycle with X, Y and Z switches is "Homed" in green', async ({ page }) => {
  const worker = await connectSimple(page, { eeprom: HOMING_EEPROM });
  const home = page.getByRole('button', { name: /^Home all configured axes/ });
  await expect(home).toBeEnabled({ timeout: 10_000 });
  await home.click();
  await page.locator('[data-safety="C4"] [data-action="motion-confirm"]').click();
  await expect.poll(async () => (await session(worker)).base, { timeout: 15_000 }).toBe('IDLE_HOMED');
  const tag = page.locator(TAG).first();
  await expect(tag).toHaveText('Homed');
  await expect(tag).toHaveClass(/\bok\b/);
  await expect(tag).toHaveAttribute('data-homed-by', 'homing');
});

test('with no homing switch set, Home says why in words and "Set up homing" opens Board → Axes (C17)', async ({ page }) => {
  await connectSimple(page);
  const why = page.locator('[data-home="off-reason"]');
  await expect(why).toContainText('Home is off: no axis has a homing switch and search speed set on this board.');
  await why.locator('[data-action="homing-setup"]').click();
  await expect(page.locator('[data-screen="board"]')).toBeVisible();
  await expect(page.locator('[data-board-tab="axes"]')).toHaveAttribute('aria-selected', 'true');
});
