/**
 * The machine Web Lock of a tab's OWN worker (owner report 2026-11-19: one
 * tab, after a firmware update, Recovery and a reload, said "Machine is
 * controlled in another tab" and showed W29).
 *
 * The firmware path connects the worker without LIVE entry (Reconnect,
 * Start firmware, the post-flash reconnect), and every Connect holds the
 * lock while it is still `opening`. In those states the tab's own worker
 * holds the lock while the tab is not LIVE. That is not another tab: no
 * observer bar, and no W29 when the lock goes. A real second tab still
 * observes and still gets W29.
 */
import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { heldLocks, machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const BOARD = 'SIM-EN-0001';

async function connectedOutsideLiveEntry(worker: Worker): Promise<void> {
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect
    .poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: { base: string } } }).status.session.base, { timeout: 10_000 })
    .toBe('IDLE_UNHOMED');
}

test("a tab's own worker lock is never 'another tab'; a real second tab still observes it and gets W29", async ({ page }) => {
  // The fixture dismisses W29 on the spec's page; this spec asserts it never appears there.
  await page.removeLocatorHandler(page.locator('[data-action="dismiss-w29"]'));
  const worker = await machineWorker(page);
  await page.evaluate(() => {
    const seen = ((globalThis as unknown as { __seen: Set<string> }).__seen = new Set<string>());
    new MutationObserver(() => {
      if (document.querySelector('[data-safety="W29"]') !== null) seen.add('W29');
      if (document.querySelector('[data-observer="controlled"]') !== null) seen.add('observer');
    }).observe(document.body, { childList: true, subtree: true });
  });
  await connectedOutsideLiveEntry(worker);
  await expect.poll(() => heldLocks(page, 'synthetos-machine:')).toEqual([`synthetos-machine:${BOARD}`]);

  const tabB = await page.context().newPage();
  await tabB.goto('/');
  await expect(tabB.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(tabB.locator('[data-observer="controlled"]')).toContainText(BOARD);
  // Several lock polls (250 ms each) have run in tab A by now.
  await expect(page.locator('[data-observer="controlled"]')).toHaveCount(0);

  expect(await request(worker, { v: 3, kind: 'close' })).toMatchObject({ ok: true });
  await expect(tabB.locator('[data-safety="W29"]')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => [...(globalThis as unknown as { __seen: Set<string> }).__seen])).toEqual([]);
});
