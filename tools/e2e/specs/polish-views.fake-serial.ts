/**
 * Owner polish (2026-11-10), in the built app (fake-serial TEST build):
 *
 * - an informational notice outside the Job view has a × and stays hidden after a reload, per notice; safety text
 *   (the magnesium line, the downgrade note) has none;
 * - table-like lists are striped with the shared token, and hover and selected stay distinct from the stripe, in
 *   light and dark;
 * - firmware release titles read "TinyG edge-next 450 · 450.02" and "TinyG 440 · 440.21".
 *
 * With RUN_SCREENSHOTS_DIR set, every view it visits is captured in both themes at 1440 px.
 */
import type { Locator, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { PORT } from './jobFlow.ts';

const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

async function connect(page: Page): Promise<Worker> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: { reports: { phase: string } } } }).status.session.reports.phase, { timeout: 10_000 }).toBe('done');
  return worker;
}

const rail = (page: Page, view: string): Promise<void> => page.locator(`[data-region="rail"] [data-view="${view}"]`).click();
const boardTab = (page: Page, tab: string): Promise<void> => page.locator(`[data-board-tab="${tab}"]`).click();

async function shot(page: Page, name: string, theme: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}-1440-${theme}.png` });
}

function background(l: Locator): Promise<string> {
  return l.evaluate((el) => getComputedStyle(el).backgroundColor);
}

const CLEAR = ['rgba(0, 0, 0, 0)', 'transparent'];

test('a × on informational notices outside the Job view, remembered per notice; safety text has none', async ({ page }) => {
  await connect(page);
  await rail(page, 'board');
  await boardTab(page, 'settings');
  const recorded = page.locator('[data-notice="board/settings-recorded"]');
  await expect(recorded).toContainText('First read of this board on this computer');
  await expect(recorded.locator('[data-action="dismiss-notice-x"]')).toHaveAttribute('aria-label', 'Hide: the settings read note.');
  await recorded.locator('[data-action="dismiss-notice-x"]').click();
  await expect(recorded).toHaveCount(0);
  await boardTab(page, 'inputs');
  await expect(page.locator('[data-notice="board/inputs-pullups"]')).toBeVisible();
  await rail(page, 'settings');
  await page.locator('[data-notice="preferences/theme-hint"] [data-action="dismiss-notice-x"]').click();
  await expect(page.locator('[data-notice="preferences/theme-hint"]')).toHaveCount(0);
  await expect(page.locator('[data-notice="preferences/storage"]')).toBeVisible();

  // A reload: the dismissed ones stay hidden, the others still show.
  await connect(page);
  await rail(page, 'settings');
  await expect(page.locator('[data-notice="preferences/theme-hint"]')).toHaveCount(0);
  await expect(page.locator('[data-notice="preferences/storage"]')).toBeVisible();
  await rail(page, 'board');
  await boardTab(page, 'inputs');
  await expect(page.locator('[data-notice="board/inputs-pullups"]')).toBeVisible();
  await boardTab(page, 'settings');
  await expect(page.locator('[data-notice="board/settings-recorded"]')).toHaveCount(0);

  // Safety text is never dismissable: the downgrade note beside its button, the magnesium line.
  await boardTab(page, 'firmware');
  await expect(page.locator('[data-release-note="downgrade"]').first()).toBeVisible();
  await expect(page.locator('.dismissable [data-release-note]')).toHaveCount(0);
  await rail(page, 'library');
  await page.locator('#library-tab-materials').click();
  await expect(page.locator('.mat-foot')).toBeVisible();
  await expect(page.locator('.dismissable .mat-foot')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`zebra rows, hover and selected distinct, release titles, every view (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme });
    await connect(page);

    await rail(page, 'board');
    await shot(page, 'board-overview', theme);
    await boardTab(page, 'motors');
    const rows = page.locator('[data-motor-row]');
    const [selected, striped, plain] = [rows.nth(0), rows.nth(1), rows.nth(2)];
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    const stripe = await background(striped);
    expect(CLEAR).not.toContain(stripe);
    expect(CLEAR).toContain(await background(plain));
    const chosen = await background(selected);
    expect(chosen).not.toBe(stripe);
    await striped.hover();
    const hovered = await background(striped);
    expect(hovered).not.toBe(stripe);
    expect(hovered).not.toBe(chosen);
    await page.mouse.move(0, 0);
    await shot(page, 'board-motors', theme);
    for (const tab of ['axes', 'inputs', 'io', 'comms', 'settings']) {
      await boardTab(page, tab);
      await shot(page, `board-${tab}`, theme);
    }
    await expect(page.locator('.cfg-section .cfg-table tbody tr:nth-child(even)').first()).toBeAttached();

    await boardTab(page, 'firmware');
    await expect(page.locator('[data-release="tinyg-450.02.hex"] [data-release-title]')).toHaveText('TinyG edge-next 450 · 450.02');
    await expect(page.locator('[data-release="tinyg-440.21.hex"] [data-release-title]')).toHaveText('TinyG 440 · 440.21');
    expect(await background(page.locator('.releases > li').nth(1))).toBe(stripe);
    expect(CLEAR).toContain(await background(page.locator('.releases > li').nth(0)));
    await shot(page, 'board-firmware', theme);

    await boardTab(page, 'backups');
    for (let i = 1; i <= 3; i++) {
      await page.locator('[data-action="backup"]').click();
      await expect(page.locator('[data-settings-backups]')).toHaveAttribute('data-settings-backups', String(i), { timeout: 20_000 });
    }
    expect(await background(page.locator('.hub-list > li').nth(1))).toBe(stripe);
    await shot(page, 'board-backups', theme);

    await rail(page, 'library');
    await page.locator('#library-tab-tools').click();
    const tools = page.locator('[data-tool-row]');
    expect(await background(tools.nth(1))).toBe(stripe);
    await tools.nth(3).hover();
    expect(await background(tools.nth(3))).not.toBe(stripe);
    await page.mouse.move(0, 0);
    await shot(page, 'library-tools', theme);
    await page.locator('#library-tab-materials').click();
    await shot(page, 'library-materials', theme);
    await page.locator('#library-tab-machines').click();
    await shot(page, 'library-machines', theme);

    await rail(page, 'projects');
    // Three projects, listed newest first (3, 2, 1). Project 1 holds three files and is the one open (selected, the
    // third row), so the second row (Project 2) shows the stripe and the file list does too.
    await page.locator('[data-action="project-new"]').click();
    await expect(page.locator('[data-project-row]')).toHaveCount(1);
    await page.locator('[data-project="detail"] input[type="file"][multiple]').first().setInputFiles(
      ['a', 'b', 'c'].map((n) => ({ name: `part-${n}.nc`, mimeType: 'text/plain', buffer: Buffer.from('G21 G90\nG0 X0 Y0\nM30\n') })),
    );
    await expect(page.locator('[data-project-file]')).toHaveCount(3, { timeout: 10_000 });
    for (const count of [2, 3]) {
      await page.locator('[data-action="project-new"]').click();
      await expect(page.locator('[data-project-row]')).toHaveCount(count);
    }
    await page.locator('[data-project-row="Project 1"]').click();
    await expect(page.locator('[data-project-file]')).toHaveCount(3);
    expect(await background(page.locator('.file-list > li').nth(1))).toBe(stripe);
    // Project rows fade their background; wait for it to settle.
    await expect.poll(() => background(page.locator('[data-project-row="Project 2"]'))).toBe(stripe);
    await expect.poll(() => background(page.locator('[data-project-row="Project 1"]'))).not.toBe(stripe);
    await shot(page, 'projects', theme);

    await rail(page, 'settings');
    expect(await background(page.locator('dl.facts > div').nth(1))).toBe(stripe);
    await shot(page, 'preferences', theme);
  });
}
