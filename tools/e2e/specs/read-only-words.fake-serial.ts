/**
 * Read-only states in a few words (owner, 2026-11-18, pictures 149 and 150; docs/design/WIZARD_FIXES.md): the machine
 * strip's text fits beside its pill at 1280 and never trails off, and the Position card says "Update required" with
 * one short line. The stand-in board cannot report stock 449 (it always carries the EN capability token), so the
 * board here is an unapproved 450.90 build: the same read-only branch and the same "Firmware X → Y" words, with the
 * target from the verified release list. readOnlyState.test.ts pins the stock-449 words.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { PORT, session } from './jobFlow.ts';
import { shot } from './wizardPage.ts';

const SHOT_DIR = new URL('../../../docs/design/screenshots/wizard-fixes/', import.meta.url).pathname;

async function connectUnapproved(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const worker = await machineWorker(page);
  await worker.evaluate(() => {
    const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
    scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
    scope.__RUN_FAKE_SERIAL__.next = { build: { fb: 450.9, fv: 0.97, hv: 8, layout: 10002 } };
  });
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).overlays.includes('READ_ONLY'), { timeout: 10_000 }).toBe(true);
}

/** The strip text is never cut: it is not ellipsized, and it sits either whole on the pill's line or below the clip. */
function textFit(page: Page): Promise<string> {
  return page.locator('.statebar .state-meta').evaluate((meta) => {
    const text = meta.querySelector('.meta-text') as HTMLElement;
    const m = meta.getBoundingClientRect();
    const t = text.getBoundingClientRect();
    const cut = text.scrollWidth > text.clientWidth;
    const onLine = t.top >= m.top - 1 && t.bottom <= m.bottom + 1 && t.right <= m.right + 1;
    const hidden = t.top >= m.bottom;
    return !cut && (onLine || hidden) ? 'whole-or-hidden' : `cut: scroll ${text.scrollWidth} client ${text.clientWidth} text ${JSON.stringify(t)} meta ${JSON.stringify(m)}`;
  });
}

function textVisible(page: Page): Promise<boolean> {
  return page.locator('.statebar .state-meta').evaluate((meta) => (meta.querySelector('.meta-text') as HTMLElement).getBoundingClientRect().top < meta.getBoundingClientRect().bottom);
}

for (const theme of ['light', 'dark'] as const) {
  test(`149, 150: the strip says the read-only state in words that fit, the card says "Update required" (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await connectUnapproved(page);
    const strip = page.locator('.statebar');
    await expect(strip).toContainText('Update required');
    const text = strip.locator('.meta-text');
    await expect(text).toHaveText('Firmware 450.90 → 450.06', { timeout: 10_000 });
    // The pill's words open the same text and the long reason (nothing is lost when the strip has no room).
    await expect(strip.locator('.pill .help-copy')).toContainText('Firmware 450.90 → 450.06.');
    await expect(strip.locator('.pill .help-copy')).toContainText('approved list');
    await expect.poll(() => textFit(page)).toBe('whole-or-hidden');
    await shot(page, SHOT_DIR, `read-only-${theme}-1280`);
    // With room (a wider window) the text shows whole beside the pill.
    await page.setViewportSize({ width: 1700, height: 800 });
    await expect.poll(() => textFit(page)).toBe('whole-or-hidden');
    expect(await textVisible(page)).toBe(true);
    await shot(page, SHOT_DIR, `read-only-${theme}-1700`);
    const card = page.locator('[data-region="position"] [data-region="control-block"]');
    await expect(card.locator('strong')).toHaveText('Update required');
    await expect(card).toContainText('450.90 is read only in Run. Install 450.06.');
    await expect(card.locator('[data-action="block-update"]')).toBeVisible();
  });
}
