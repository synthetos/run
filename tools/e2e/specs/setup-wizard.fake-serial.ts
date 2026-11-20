/**
 * The setup wizard (docs/superpowers/specs/2026-11-16-first-run-design.md §6) in the built app against the fake
 * serial board: it opens for a signed-in account with no machine once the records are read, walks the seven steps,
 * writes the setup record as it goes, makes the demo project and ends on the Job page with it open. The firmware
 * `needed` state is the simulated unapproved board (firmware-offer.fake-serial.ts). RUN_SCREENSHOTS=1 writes the
 * walkthrough pictures to docs/design/screenshots/setup-wizard/.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { request } from './machineWorker.ts';
import { fakeRecords, setupRecord, stubAccount } from './accountRecords.ts';
import { base, connect as connectBoard, next, open, shot as shotIn, step, wizard } from './wizardPage.ts';

const SHOT_DIR = new URL('../../../docs/design/screenshots/setup-wizard/', import.meta.url).pathname;
const NEEDED = { fb: 450.07, fv: 0.97, hv: 8, layout: 10002 } as const;

const shot = (page: Page, name: string): Promise<void> => shotIn(page, SHOT_DIR, name);
const connect = (_page: Page, worker: Parameters<typeof connectBoard>[0], build?: Record<string, unknown>): Promise<void> => connectBoard(worker, build);

const MACHINE = { id: 'm-1', name: 'Bench', templateId: 'custom', drive: 'any', travel: { x: 300, y: 300, z: 80 }, spindle: '', createdAt: '2026-11-18T00:00:00.000Z' };
const machineRecord = () => ({ id: 'm-1', kind: 'machine' as const, rev: 1, archivedAt: null, content: MACHINE, sha256: 'a'.repeat(64) });

test('opens for a signed-in account with no machine once the records are read; not with a machine; not when dismissed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(wizard(page).getByRole('heading', { name: 'Welcome to Run' })).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await stubAccount(page);
  await fakeRecords(page, [machineRecord()]);
  await page.goto('/');
  await expect(page.locator('[data-shell="workspace"][data-level]')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-wizard-step]')).toHaveCount(0);
  await expect(page.locator('[inert]')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await stubAccount(page);
  await fakeRecords(page, [setupRecord({ dismissed: true, step: 4 })]);
  await page.goto('/');
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-wizard-step]')).toHaveCount(0);
});

test('walks all seven steps with the fake board, saves the setup record as it goes and opens the demo on the Job page', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { account, worker } = await open(page);
  // 1 Welcome: focus starts on the heading; nothing to skip.
  await expect(page.locator('#wizard-title')).toBeFocused();
  await expect(page.locator('[data-action="wizard-skip"]')).toHaveCount(0);
  await shot(page, 'step-1-light-1280');
  await next(page).click();
  // 2 Your machine: a template, a name, the bed, then the board.
  await expect(step(page, 2)).toBeVisible();
  await page.locator('.wizard .wizard-select select').selectOption('shapeoko');
  await page.locator('.wizard .wizard-name input').fill('Shapeoko on the bench');
  await connect(page, worker);
  await expect(page.locator('[data-wizard="board"]')).toContainText('Connected · TinyG v8', { timeout: 15_000 });
  await shot(page, 'step-2-light-1280');
  await next(page).click();
  await expect(step(page, 3)).toBeVisible();
  await expect.poll(() => account.ofKind('machine').length, { timeout: 10_000 }).toBe(1);
  const machine = account.ofKind('machine')[0]?.content as { name: string; boardId?: string; bed?: { width: number } };
  expect(machine.name).toBe('Shapeoko on the bench');
  expect(machine.bed?.width).toBe(425);
  expect(typeof machine.boardId).toBe('string');
  // 3 Firmware: the simulated board runs 450.02, the list names 450.06: available, skippable.
  await expect(page.locator('[data-firmware-step="text"]')).toHaveText('This board runs 450.02. 450.06 is released.', { timeout: 15_000 });
  await expect(page.locator('[data-action="wizard-skip"]')).toBeVisible();
  await shot(page, 'step-3-light-1280');
  await next(page).click();
  // 4 Homing: a choice, written as made; the existing Home controls.
  await expect(step(page, 4)).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await page.locator('input[name="wizard-homing"][value="none"]').check();
  const homeQuick = wizard(page).locator('[data-region="home-quick"]');
  await expect(homeQuick).toBeVisible();
  await expect(homeQuick.getByRole('button', { name: /Set machine zero/ })).toBeVisible();
  await expect(homeQuick.getByRole('button', { name: /^Home all/ })).toBeHidden();
  // And what is wired to the coolant output (owner 152): saved on the machine from step 2.
  await page.locator('input[name="wizard-coolant"][value="flood"]').check();
  await expect.poll(() => (account.ofKind('machine')[0]?.content as { coolant?: string }).coolant, { timeout: 10_000 }).toBe('flood');
  await shot(page, 'step-4-light-1280');
  await next(page).click();
  // 5 Tools (OD-42: no stock): the catalog opens as a whole page, a tool added there brings the step back with it;
  // the tool editor opens on top and closes.
  await expect(step(page, 5)).toBeVisible();
  await expect(wizard(page).locator('[data-action="wizard-add-stock"]')).toHaveCount(0);
  await page.locator('[data-action="wizard-catalog"]').click();
  const catalog = page.locator('.wizard-catalog');
  await expect(catalog.locator('[data-catalog-part="52-280"]')).toBeVisible({ timeout: 15_000 });
  await catalog.locator('[data-catalog-part="52-280"] [data-action="catalog-add"]').click();
  await page.locator('.tool-modal [data-action="save-tool"]').click();
  await expect(catalog).toHaveCount(0);
  await expect(page.locator('[data-wizard="tool"]')).toContainText('6.35 mm end mill');
  await page.locator('[data-action="wizard-create-tool"]').click();
  await expect(page.locator('.tool-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tool-modal')).toHaveCount(0);
  await shot(page, 'step-5-light-1280');
  await next(page).click();
  // 6 First project: the demo.
  await expect(step(page, 6)).toBeVisible();
  await expect(page.locator('input[name="wizard-project"][value="demo"]')).toBeChecked();
  await shot(page, 'step-6-light-1280');
  await next(page).click();
  // 7 Done, then the Job page with the demo open and the wizard gone for good.
  await expect(step(page, 7)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-wizard="headline"]')).toHaveText('Name plate is open on the Job page');
  await expect(page.locator('.wizard details')).toHaveCount(6);
  await shot(page, 'step-7-light-1280');
  await next(page).click();
  await expect(page.locator('[data-wizard-step]')).toHaveCount(0);
  await expect(page.locator('[inert]')).toHaveCount(0);
  await expect(page.locator('[data-screen="job"] [data-preview="file-name"]')).toHaveText('name-plate.nc');
  await shot(page, 'job-demo-light-1280');
  await expect.poll(() => (account.records.get('setup:setup')?.content as { dismissed: boolean } | undefined)?.dismissed, { timeout: 10_000 }).toBe(true);
  const setup = account.records.get('setup:setup')?.content as { done: number[]; projectId: string | null; homing: string | null; stock: unknown; toolId: string | null };
  expect(setup.done).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(setup.homing).toBe('none');
  // OD-42: the wizard writes no stock; the demo keeps its own 180 × 120 × 6.35 mm block.
  expect(setup.stock).toBeNull();
  const added = account.ofKind('tool').find((r) => (r.content as { partNumber?: string }).partNumber === '52-280');
  expect(setup.toolId).toBe(added?.id);
  expect(setup.projectId).not.toBeNull();
  const projects = account.ofKind('project');
  expect(projects.map((r) => (r.content as { name: string }).name)).toEqual(['Name plate']);
  expect((projects[0]?.content as { setup?: { stockSnapshot?: { width: number } } }).setup?.stockSnapshot?.width).toBe(180);
  expect(account.ofKind('tool').map((r) => r.id)).toContain('demo.quarter-2f');
});

test('dark: the first and the last step', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await shot(page, 'step-1-dark-1280');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await stubAccount(page);
  await fakeRecords(page, [setupRecord({ step: 7, done: [1, 2, 3, 4, 5, 6] })]);
  await page.goto('/');
  await expect(step(page, 7)).toBeVisible({ timeout: 15_000 });
  await shot(page, 'step-7-dark-1280');
});

test('below 1024 px the frame fills the page below the W1 safety bar, with the dots strip', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 700 });
  await open(page, [setupRecord({ step: 2, done: [1] })], 2);
  const box = await page.locator('.wizard-dialog').boundingBox();
  const bar = await page.locator('[data-region="safety-bar"]').evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
  expect(bar).toBeGreaterThan(0);
  expect(box).toEqual({ x: 0, y: bar, width: 960, height: 700 - bar });
  await expect(page.locator('.wizard-dot-name')).toHaveText('Machine');
  await shot(page, 'step-2-light-960');
});

test('firmware needed (simulated): no skip, Next held, Update firmware opens Board → Firmware → Update (owner 167)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { worker } = await open(page, [setupRecord({ step: 3, done: [1, 2] })], 3);
  await page.removeLocatorHandler(page.locator('[data-action="firmware-offer-later"]'));
  await connect(page, worker, NEEDED);
  await expect(page.locator('[data-firmware-step="text"]')).toHaveText("Run can't control firmware 450.07. Install 450.06, the newest release Run supports.", { timeout: 15_000 });
  await expect(page.locator('[data-action="wizard-skip"]')).toHaveCount(0);
  await expect(next(page)).toBeDisabled();
  await shot(page, 'step-3-needed-light-1280');
  await page.locator('[data-action="wizard-update"]').click();
  await expect(page.locator('[data-wizard-step]')).toHaveCount(0);
  const row = page.locator('[data-screen="board"] [data-release="tinyg-450.06.hex"]');
  await expect(row).toHaveAttribute('data-release-focus', '');
  // The flash closes the session: back in setup, the step offers no Connect and holds Next and Skip.
  expect(await request(worker, { v: 3, kind: 'close' })).toMatchObject({ ok: true });
  await expect.poll(() => base(worker), { timeout: 10_000 }).toBe('NOT_CONNECTED');
  await page.locator('[data-action="back-to-setup"]').click();
  await expect(step(page, 3)).toBeVisible();
  await expect(page.locator('[data-firmware-step="updating"]')).toBeVisible();
  await expect(page.locator('.wizard [data-region="connect"], .wizard [data-region="firmware-releases"]')).toHaveCount(0);
  await expect(page.locator('[data-action="wizard-skip"]')).toHaveCount(0);
  await expect(next(page)).toBeDisabled();
});

// The local page cannot verify the safety advisory (no environment), so the entry flow answers with its refusal:
// that answer, like the C1 checklist on a hosted page, renders inside the frame and is dismissed from there.
test('step 2 connects from inside the frame: the entry flow’s answer shows in the wizard and is dismissed there', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, [setupRecord({ step: 2, done: [1] })], 2);
  const connect = wizard(page).locator('[data-region="connect"]');
  await connect.locator('[data-action="connect"]').click();
  const refusal = connect.locator('[data-entry="refused"]');
  await expect(refusal.getByRole('alert')).toContainText('safety advisory');
  const frame = await page.locator('.wizard-dialog').boundingBox();
  const box = await refusal.boundingBox();
  expect(box !== null && frame !== null && box.y >= frame.y && box.y + box.height <= frame.y + frame.height).toBe(true);
  await refusal.locator('[data-action="dismiss"]').click();
  await expect(refusal).toHaveCount(0);
  await expect(connect.locator('[data-action="connect"]')).toBeVisible();
  await expect(step(page, 2)).toBeVisible();
});

test('"Run setup again" brings the wizard back for an account that already has a machine', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubAccount(page);
  await fakeRecords(page, [machineRecord(), setupRecord({ dismissed: true, step: 7, done: [1, 2, 3, 4, 5, 6, 7] })]);
  await page.goto('/');
  await page.locator('[data-region="rail"] [data-view="settings"]').click();
  await page.locator('[data-action="run-setup-again"]').click();
  await expect(step(page, 1)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.app')).toHaveAttribute('inert', '');
});

test('resumes on the record step; Close setup dismisses it and Preferences brings it back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { account } = await open(page, [setupRecord({ step: 5, done: [1, 2, 3, 4] })], 5);
  await expect(page.locator('.wizard-steps li[data-mark="done"]')).toHaveCount(4);
  await page.locator('[data-action="wizard-close"]').click();
  await expect(page.locator('[data-wizard-step]')).toHaveCount(0);
  await expect(page.locator('[inert]')).toHaveCount(0);
  await expect.poll(() => (account.records.get('setup:setup')?.content as { dismissed: boolean; step: number } | undefined)?.dismissed, { timeout: 10_000 }).toBe(true);
  expect((account.records.get('setup:setup')?.content as { step: number }).step).toBe(5);
  await page.locator('[data-region="rail"] [data-view="settings"]').click();
  await page.locator('[data-action="run-setup-again"]').click();
  await expect(step(page, 1)).toBeVisible();
});

test('keyboard: focus starts on the heading, Tab reaches the primary and never the workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.locator('#wizard-title')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(next(page)).toBeFocused();
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('.app') ?? null)).toBeNull();
  }
});
