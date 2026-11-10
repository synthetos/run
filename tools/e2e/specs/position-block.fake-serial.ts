/**
 * The Position panel when the machine controls are blocked (owner, 2026-11-09), in the built app (fake-serial TEST
 * build):
 *
 * - a board whose build is not on the approved list (READ_ONLY): one card says why, with the build, and "Update
 *   firmware" opens Board → Firmware; jog, home, zero and go-to-zero are not drawn at all;
 * - after a reconnect (UNKNOWN): a sentence and a real "I've checked the machine" button, which clears it, and then
 *   the controls are there;
 * - a normal board: no card, one plain status line, and the X, Y and Z actions on its row.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { PORT, session } from './jobFlow.ts';

async function connect(page: Page, options: { readonly board?: Record<string, unknown>; readonly unknown?: boolean; readonly level?: 'simple' | 'advanced' } = {}): Promise<Worker> {
  await page.setViewportSize({ width: 1280, height: 720 });
  const worker = await machineWorker(page);
  if (options.board !== undefined) {
    await worker.evaluate((o) => {
      const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
      scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
      scope.__RUN_FAKE_SERIAL__.next = o;
    }, options.board);
  }
  expect(await request(worker, { v: 3, kind: 'open', port: PORT, ...(options.unknown === true ? { previousSessionEnded: true } : {}) })).toMatchObject({ ok: true });
  if (options.level === 'advanced') await page.locator('[data-action="ui-level-advanced"]').click();
  // A read-only board configures no reports: wait for the classification instead.
  await expect.poll(async () => { const s = await session(worker); return s.reports.phase === 'done' || s.overlays.includes('READ_ONLY'); }, { timeout: 10_000 }).toBe(true);
  return worker;
}

const inspector = (page: Page) => page.locator('.run-inspector');

for (const level of ['simple', 'advanced'] as const) {
  test(`${level}: a build that is not approved gets one card with the way out, and no controls that cannot work`, async ({ page }) => {
    const worker = await connect(page, { board: { build: { fb: 450.9, fv: 0.97, hv: 8, layout: 10002 } }, level });
    expect((await session(worker)).overlays).toContain('READ_ONLY');
    const card = page.locator('[data-region="position"] [data-region="control-block"]');
    await expect(card).toHaveAttribute('data-block', 'not-approved');
    await expect(card).toContainText('Run can’t control this board yet.');
    await expect(card).toContainText('Its firmware build isn’t on Run’s approved list (450.90, no build id).');
    for (const sel of ['[data-jog="panel"]', '[data-machine-control="zero"]', '[data-machine-control="jog"]', '.sec-home', '[data-region="home-quick"]', '#insp-tab-jog']) {
      await expect(inspector(page).locator(sel), sel).toHaveCount(0);
    }
    await expect(page.locator('[data-position="gate"]')).toHaveCount(0);
    await expect(page.getByText('Where these numbers come from')).toHaveCount(0);
    await card.locator('[data-action="block-update"]').click();
    await expect(page.locator('[data-screen="board"]')).toBeVisible();
    await expect(page.locator('[data-board-tab="firmware"]')).toHaveAttribute('aria-selected', 'true');
  });
}

test('a board left on hardware flow control (ex = 2) says so, in the card and the strip, not "not approved"', async ({ page }) => {
  const worker = await connect(page, { board: { eeprom: { __layout: 10002, ex: 2 } } });
  expect((await session(worker)).overlays).toContain('READ_ONLY');
  const card = page.locator('[data-region="position"] [data-region="control-block"]');
  await expect(card).toHaveAttribute('data-reason', 'flowControl');
  await expect(card).toContainText('It’s set to hardware flow control (RTS/CTS, ex = 2), which Run hasn’t verified.');
  await expect(card).toContainText('Set ex to 1 (XON/XOFF) with another program, then connect again.');
  await expect(card).not.toContainText('approved');
  await expect(page.locator('[data-region="machine-strip"]')).toContainText('hardware flow control (RTS/CTS, ex = 2)');
  await expect(card.locator('[data-action="block-disconnect"]')).toBeVisible();
});

test('after a reconnect: one question on connect, "It hasn’t moved" clears UNKNOWN, and the controls come back', async ({ page }) => {
  const worker = await connect(page, { unknown: true });
  const card = page.locator('[data-region="unknown-exits"]');
  await expect(card).toContainText('Has the machine moved since last time?');
  await expect(inspector(page).locator('[data-jog="panel"]')).toHaveCount(0);
  // Later puts it off; the Position panel's Check… brings it back.
  await card.locator('[data-action="unknown-later"]').click();
  await expect(card).toHaveCount(0);
  await page.locator('[data-region="position"] [data-action="unknown-ask"]').click();
  await card.getByRole('button', { name: "It hasn't moved" }).click();
  await expect.poll(async () => (await session(worker)).overlays).toEqual([]);
  await expect(card).toHaveCount(0);
  await expect(inspector(page).locator('[data-jog="panel"]')).toHaveCount(1);
  await expect(inspector(page).locator('[data-machine-control="zero"]').first()).toBeEnabled();
});

test('a normal board: no card, one plain status line, and the X, Y and Z actions on its row', async ({ page }) => {
  await connect(page, { level: 'advanced' });
  await expect(page.locator('[data-region="control-block"]')).toHaveCount(0);
  const status = page.locator('[data-region="position"] [data-position="status"]');
  await expect(status).toBeVisible();
  // The words of the line, without the W34 help that opens from "Not homed".
  const words = await status.evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.help-copy').forEach((n) => n.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
  expect(words).toBe('G54 · Not homed · Tool T0');
  await expect(status.locator('[data-position="homing"] .help-copy')).toHaveAttribute('data-safety', 'W34');
  const row = page.locator('[data-region="position"] .pos-status-row');
  await expect(row.getByRole('button', { name: 'Set X, Y and Z work zero here' })).toBeEnabled();
  // The all-axes buttons line up with the per-axis buttons' column.
  const perAxis = await page.locator('[data-position-axis="x"] .dro-actions').boundingBox();
  const all = await row.locator('.dro-actions').boundingBox();
  expect(Math.abs((perAxis?.x ?? 0) + (perAxis?.width ?? 0) - ((all?.x ?? 0) + (all?.width ?? 0)))).toBeLessThan(1);
});
