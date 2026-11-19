/**
 * Board settings walkthrough pictures (owner rule: UI changes need a first-time-user walkthrough with screenshots).
 * Runs only when BOARD_CONFIG_SHOTS names a folder; then it captures every Board tab and its sub-tabs at 1280 × 800
 * (the owner's window, 2026-11-19), dark and light, for
 * an approved board (the plain simulator) and a read-only one (the edge-next simulator reporting 449.01, READ_ONLY:
 * the test kit has no stock-449 simulator), plus a pending change with the review panel, a change the plan refuses,
 * a read-only board with a change left from before (Discard only), All settings at Advanced, and Backups after one
 * backup with the Delete confirmation. It asserts only what it needs to reach each state.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { PORT, session } from './jobFlow.ts';
import { machineWorker, request } from './machineWorker.ts';

const SHOTS = process.env['BOARD_CONFIG_SHOTS'];
const TABS = ['overview', 'motors', 'axes', 'inputs', 'io', 'settings', 'firmware', 'backups'] as const;
const READ_ONLY = { build: { fb: 449.01, fv: 0.97, hv: 8, layout: 10002 } };

async function connect(page: Page, board?: Record<string, unknown>): Promise<Worker> {
  await page.setViewportSize({ width: 1280, height: 800 });
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

async function shoot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function tab(page: Page, id: string): Promise<void> {
  await page.locator(`[data-board-tab="${id}"]`).click();
  await expect(page.locator(`#board-pane-${id}`)).toBeVisible();
}

/** The sub-tabs pictured per Board tab (owner walk 2026-11-19: one part at a time, nothing scrolls). */
const PARTS: Readonly<Record<string, readonly string[]>> = { axes: ['all', 'x', 'a', 'other'], motors: ['1', '4'], inputs: ['switches', 'homing'], io: ['outputs', 'pwm'], firmware: ['update', 'images', 'custom'] };

/** A tab, and each pictured sub-tab of it: `<board>-<tab>[-<part>]-<theme>.png`. */
async function everyPart(page: Page, board: string, id: string, theme: string): Promise<void> {
  await tab(page, id);
  const parts = PARTS[id];
  if (parts === undefined) return shoot(page, `${board}-${id}-${theme}`);
  for (const part of parts) {
    await page.locator(`#board-pane-${id} [data-subtab="${part}"]`).click();
    await shoot(page, `${board}-${id}-${part}-${theme}`);
  }
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`walkthrough, ${theme}`, () => {
    test.use({ colorScheme: theme });
    test.skip(SHOTS === undefined, 'set BOARD_CONFIG_SHOTS to a folder to take the walkthrough pictures');

    test(`approved board, every tab, ${theme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await connect(page);
      for (const id of TABS) await everyPart(page, 'approved', id, theme);
      await page.locator('[data-action="ui-level-advanced"]').click();
      await tab(page, 'settings');
      await page.locator('#board-pane-settings [data-group-chip="communications"]').click();
      await shoot(page, `approved-settings-advanced-${theme}`);
    });

    test(`approved board, a pending switch change and the review panel, ${theme}`, async ({ page }) => {
      await connect(page);
      await tab(page, 'inputs');
      await page.locator('#board-pane-inputs [data-setting-control="xsn"] [data-value][aria-checked="false"]').nth(2).click();
      await expect(page.locator('[data-region="pending-bar"]')).toBeVisible();
      await shoot(page, `approved-inputs-pending-${theme}`);
      await page.locator('[data-region="pending-bar"] [data-action="review-apply"]').click();
      await expect(page.locator('[data-region="pending-changes"]')).toBeVisible();
      await shoot(page, `approved-review-${theme}`);
    });

    test(`approved board, Backups after one backup, ${theme}`, async ({ page }) => {
      await connect(page);
      await tab(page, 'backups');
      const backup = page.locator('#board-pane-backups [data-action="backup"]').first();
      await expect(backup).toBeEnabled({ timeout: 20_000 });
      await backup.click();
      await page.waitForTimeout(3000);
      await shoot(page, `approved-backups-after-one-${theme}`);
      await page.locator('#board-pane-backups [data-action="backup-delete"]').first().click();
      await expect(page.locator('[data-safety="backup-delete"]')).toBeVisible();
      await shoot(page, `approved-backup-delete-${theme}`);
    });

    test(`approved board, a change the plan refuses, ${theme}`, async ({ page }) => {
      await connect(page);
      await tab(page, 'axes');
      await page.locator('#board-pane-axes [data-subtab="x"]').click();
      const field = page.locator('#board-pane-axes [data-setting-control="xvm"] input');
      await field.fill('-5');
      await field.press('Tab');
      await expect(page.locator('[data-pending-refused]')).toBeVisible();
      await shoot(page, `approved-refused-bar-${theme}`);
      await page.locator('[data-region="pending-bar"] [data-action="review-apply"]').click();
      await expect(page.locator('.tray-refused')).toBeVisible();
      await shoot(page, `approved-refused-review-${theme}`);
    });

    test(`read-only board with a change left from before: Discard only, ${theme}`, async ({ page }) => {
      await connect(page);
      await tab(page, 'inputs');
      await page.locator('#board-pane-inputs [data-setting-control="xsn"] [data-value][aria-checked="false"]').nth(2).click();
      await expect(page.locator('[data-region="pending-bar"]')).toBeVisible();
      await connect(page, READ_ONLY);
      await tab(page, 'inputs');
      await expect(page.locator('#board-pane-inputs [data-setting-control="xsn"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-pending-readonly]')).toBeVisible();
      await shoot(page, `readonly-leftover-discard-${theme}`);
    });

    test(`read-only board (449.01), every tab, ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await connect(page, READ_ONLY);
      // Wait for the settings read: the notice's Back up settings is enabled only once the board is read and at rest.
      await expect(page.locator('[data-action="notice-backup"]')).toBeEnabled({ timeout: 20_000 });
      for (const id of TABS) await everyPart(page, 'readonly', id, theme);
    });
  });
}
