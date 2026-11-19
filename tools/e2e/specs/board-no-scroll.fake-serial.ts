/**
 * No scrolling on the Board view (owner, 2026-11-19 staging walk: "we dont like scroll bars ... not scrolling hell").
 * At 1280 × 800, every Board tab and every sub-tab inside it, at Simple and Advanced, for an approved board and a
 * read-only one, fits: the page does not scroll and no element inside it scrolls. Content that does not fit is split
 * into tabs, not put in a scrolling box.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { PORT, session } from './jobFlow.ts';
import { machineWorker, request } from './machineWorker.ts';

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
  await expect.poll(() => page.locator('[data-setting-control]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  return worker;
}

/** Every element that scrolls (or the page itself), with how far it overflows. */
function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = document.scrollingElement;
    if (root !== null && root.scrollHeight > window.innerHeight + 1) out.push(`page +${root.scrollHeight - window.innerHeight}px`);
    if (root !== null && root.scrollWidth > window.innerWidth + 1) out.push(`page wider +${root.scrollWidth - window.innerWidth}px`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const s = getComputedStyle(el);
      if (!['auto', 'scroll'].includes(s.overflowY) || el.offsetParent === null) continue;
      if (el.scrollHeight > el.clientHeight + 1) out.push(`${el.tagName.toLowerCase()}.${el.className.split(' ').join('.')} +${el.scrollHeight - el.clientHeight}px`);
    }
    return out;
  });
}

/** The tab, then each of its sub-tabs (data-subtab), each measured. */
async function measureTab(page: Page, id: string): Promise<string[]> {
  await page.locator(`[data-board-tab="${id}"]`).click();
  await expect(page.locator(`#board-pane-${id}`)).toBeVisible();
  await page.waitForTimeout(150);
  const found = (await overflowing(page)).map((o) => `${id}: ${o}`);
  const subs = page.locator(`#board-pane-${id} [data-subtab]`);
  for (let i = 0; i < (await subs.count()); i++) {
    const sub = subs.nth(i);
    const name = (await sub.getAttribute('data-subtab')) ?? String(i);
    await sub.click();
    await page.waitForTimeout(100);
    found.push(...(await overflowing(page)).map((o) => `${id} › ${name}: ${o}`));
  }
  return found;
}

for (const board of ['approved', 'read-only'] as const) {
  for (const level of ['simple', 'advanced'] as const) {
    test(`${board} board, ${level}: no tab or sub-tab scrolls at 1280 × 800`, async ({ page }) => {
      test.setTimeout(120_000);
      await connect(page, board === 'read-only' ? READ_ONLY : undefined);
      await page.locator(`[data-action="ui-level-${level}"]`).click();
      const found: string[] = [];
      for (const id of TABS) found.push(...(await measureTab(page, id)));
      expect(found).toEqual([]);
    });
  }
}
