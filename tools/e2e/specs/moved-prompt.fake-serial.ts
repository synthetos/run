/**
 * The "Has the machine moved since last time?" question right after the setup wizard (owner 164, 2026-11-19): a
 * board connected with the previous session's marker still set (UNKNOWN), then the wizard finished with "Go to the
 * Job page". On a board Run can control, each answer closes the question. On the owner's 449.01 (READ_ONLY: reads and
 * stops only, SAFETY §4.1) the session refuses "It hasn't moved", so the question is not asked: the Position panel's
 * Update required card is the way out. RUN_SCREENSHOTS=1 writes the pictures to docs/design/screenshots/moved-prompt/.
 */
import type { Locator, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { request } from './machineWorker.ts';
import { session, PORT } from './jobFlow.ts';
import { setupRecord } from './accountRecords.ts';
import { next, open, shot as shotIn, step } from './wizardPage.ts';

const SHOT_DIR = new URL('../../../docs/design/screenshots/moved-prompt/', import.meta.url).pathname;
const OWNER_BOARD = { fb: 449.01, fv: 0.97, hv: 8, layout: 10002 } as const;

/** Connects the fake board as a reload would after a session that ended while connected (the W6 marker). */
async function connectAfterReload(worker: Worker, build?: Record<string, unknown>): Promise<void> {
  if (build !== undefined) {
    await worker.evaluate((b) => {
      const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
      scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
      scope.__RUN_FAKE_SERIAL__.next = { build: b };
    }, build);
  }
  expect(await request(worker, { v: 3, kind: 'open', port: PORT, previousSessionEnded: true })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).overlays, { timeout: 15_000 }).toContain('UNKNOWN');
  await expect.poll(async () => { const s = await session(worker); return s.reports.phase === 'done' || s.overlays.includes('READ_ONLY'); }, { timeout: 15_000 }).toBe(true);
}

/** Finishes the wizard from its last step with the board connected; returns the question's locator. */
async function finishWizard(page: Page, theme: 'light' | 'dark', build?: Record<string, unknown>): Promise<{ worker: Worker; question: Locator }> {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: 1280, height: 800 });
  const { worker } = await open(page, [setupRecord({ step: 7, done: [1, 2, 3, 4, 5, 6] })], 7);
  await connectAfterReload(worker, build);
  await expect(step(page, 7)).toBeVisible();
  await next(page).click();
  await expect(page.locator('[data-wizard-step]')).toHaveCount(0);
  await expect(page.locator('[inert]')).toHaveCount(0);
  // The port opened from this page's worker is this tab's own lock: no W29 (the fixture fails the test on one).
  await expect(page.locator('[data-action="dismiss-w29"]')).toHaveCount(0);
  return { worker, question: page.locator('[data-region="unknown-exits"]') };
}

for (const theme of ['light', 'dark'] as const) {
  test(`after the wizard on a board Run controls, Later closes the question (${theme})`, async ({ page }) => {
    const { question } = await finishWizard(page, theme);
    await expect(question).toContainText('Has the machine moved since last time?', { timeout: 10_000 });
    await shotIn(page, SHOT_DIR, `question-motion-${theme}-1280`);
    await question.locator('[data-action="unknown-later"]').click();
    await expect(question).toHaveCount(0);
  });

  test(`after the wizard on a board Run controls, "It hasn't moved" closes the question and trusts the position (${theme})`, async ({ page }) => {
    const { worker, question } = await finishWizard(page, theme);
    await expect(question).toContainText('Has the machine moved since last time?', { timeout: 10_000 });
    await question.locator('[data-action="unknown-verify"]').click();
    await expect(question).toHaveCount(0);
    expect((await session(worker)).overlays).not.toContain('UNKNOWN');
    await shotIn(page, SHOT_DIR, `after-verify-motion-${theme}-1280`);
  });

  test(`after the wizard on the owner's 449.01 (read only), no question it cannot answer: the Update required card (${theme})`, async ({ page }) => {
    const { worker, question } = await finishWizard(page, theme, OWNER_BOARD);
    const card = page.locator('[data-region="position"] [data-region="control-block"]');
    await expect(card).toHaveAttribute('data-block', 'not-approved', { timeout: 10_000 });
    await expect(card.locator('[data-action="block-update"]')).toBeVisible();
    // The session still holds UNKNOWN: the question waits for a board that can answer it.
    expect((await session(worker)).overlays).toEqual(expect.arrayContaining(['READ_ONLY', 'UNKNOWN']));
    await expect(question).toHaveCount(0);
    await expect(page.locator('[data-action="unknown-ask"]')).toHaveCount(0);
    await shotIn(page, SHOT_DIR, `after-449-${theme}-1280`);
  });
}
