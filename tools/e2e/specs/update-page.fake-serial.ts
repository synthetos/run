/** Open updater with the fake serial board only; no identity service or workspace mount. */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { stubFirmwareCatalog } from './firmwareCatalogFixture.ts';
import { request } from './machineWorker.ts';
const REPO = resolve(import.meta.dirname, '../../..');
const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 };
const SHOTS = process.env['RUN_UPDATE_SHOTS'];
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(t => document.documentElement.dataset['theme'] = t, theme);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(SHOTS, `${name}-${width}-${theme}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function open(page: Page): Promise<Worker> {
  await page.route('**/firmware/sim/*.hex', route => route.fulfill({ status: 200, contentType: 'text/plain', body: readFileSync(join(REPO, 'firmware/sim', new URL(route.request().url()).pathname.split('/').at(-1)!), 'utf8') }));
  const started = page.waitForEvent('worker', { predicate: w => /\/firmware\.worker-/.test(w.url()) });
  await page.goto('/update/');
  const worker = await started;
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-action=update-connect]')).toBeEnabled();
  return worker;
}
async function board(worker: Worker) {
  await worker.evaluate(() => {
    (globalThis as unknown as { __RUN_FAKE_SERIAL__: unknown }).__RUN_FAKE_SERIAL__ = { ports: [], flashable: { eeprom: { __layout: 10002, st: 1, zsn: 1 }, id: 'SIM-UPDATE-1' } };
  });
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
}
async function checklist(page: Page) {
  await page.locator('[data-release="sim-edge-next-451.00.hex"] button').click();
  await expect(page.locator('[data-region=flash-confirm]')).toBeVisible();
  await shot(page, '03-checklist');
  const saved = page.waitForEvent('download');
  await page.locator('[data-action=checklist-backup]').click();
  await saved;
  const boxes = page.locator('[data-region=flash-confirm] input[type=checkbox]');
  for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).check();
  await page.locator('[data-action=confirm-flash]').click();
  await expect(page.locator('[data-step=backup]')).toBeVisible({ timeout: 30_000 });
}
test('open update completes with local backups, required restore and switch check', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let worker = await open(page);
  await shot(page, '01-connect');
  await expect(page.locator('a[href="/"]')).toHaveCount(0);
  await expect(page.locator('[data-region=rail]')).toHaveCount(0);
  await board(worker);
  await expect(page.locator('[data-release="sim-edge-next-451.00.hex"]')).toBeVisible({ timeout: 20_000 });
  await shot(page, '02-board-release');
  expect(await request(worker, { v: 3, kind: 'motion', command: { op: 'spindleOn', rpm: 1000 } })).toMatchObject({ ok: false });
  await checklist(page);
  await shot(page, '04-backup');
  const download = page.waitForEvent('download');
  await page.locator('[data-step=backup]').getByRole('button', { name: 'Download backup' }).click();
  expect((await download).suggestedFilename()).toMatch(/^synthetos-settings-/);
  await page.locator('[data-action=backup-continue]').click();
  await expect(page.locator('[data-step=progress]')).toBeVisible({ timeout: 60_000 });
  await shot(page, '05-progress');
  await expect(page.locator('[data-post-flash=restoreRequired]')).toBeVisible({ timeout: 120_000 });
  await shot(page, '06-restore');
  await page.locator('[data-action=restore-position-verify]').click();
  // Closing the page must not discard the required restore. Preserve only the fake board's hardware state.
  const savedBoard = await worker.evaluate(() => {
    const d = (globalThis as unknown as { __RUN_FAKE_SERIAL__: { board: { device: { memory: Uint8Array; eeprom: Record<string, number> } } } }).__RUN_FAKE_SERIAL__.board.device;
    return { flash: Array.from(d.memory.slice(0, 0x30000)), eeprom: { ...d.eeprom } };
  });
  worker = await open(page);
  await worker.evaluate(saved => { (globalThis as unknown as { __RUN_FAKE_SERIAL__: unknown }).__RUN_FAKE_SERIAL__ = { ports: [], flashable: { flash: new Uint8Array(saved.flash), eeprom: saved.eeprom, id: 'SIM-UPDATE-1' } }; }, savedBoard);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect(page.locator('[data-post-flash=restoreRequired]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('a[href="/"]')).toHaveCount(0);
  await shot(page, '06b-resumed-restore');
  await page.locator('[data-action=restore-after-flash]').click();
  await expect(page.locator('[data-dialog=apply-confirm]')).toBeVisible();
  await shot(page, '06c-restore-confirm');
  await expect(page.locator('[data-region=safety-bar]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('E-stop');
  const dialog = await page.locator('.apply-confirm').boundingBox();
  expect(dialog!.y).toBeGreaterThanOrEqual(0);
  const ticks = page.locator('[data-dialog=apply-confirm] input[type=checkbox]');
  for (let i = 0; i < await ticks.count(); i++) await ticks.nth(i).check();
  if (await page.locator('#apply-typed').count()) await page.locator('#apply-typed').fill('WRITE');
  await page.locator('[data-action=confirm-apply]').click();
  await expect(page.locator('[data-step=mains]')).toBeVisible({ timeout: 60_000 });
  await shot(page, '07-mains');
  await page.locator('[data-action=mains-confirm]').check();
  await page.locator('[data-action=switch-test-start]').click();
  await shot(page, '08-switches');
  await worker.evaluate(() => {
    const r = (globalThis as unknown as { __RUN_FAKE_SERIAL__: { board: { device: { setInput(n: number, closed: boolean): void } } } }).__RUN_FAKE_SERIAL__;
    r.board.device.setInput(5, true);
  });
  await expect(page.locator('[data-step=switches]')).toContainText('release it', { timeout: 10_000 });
  await worker.evaluate(() => {
    const r = (globalThis as unknown as { __RUN_FAKE_SERIAL__: { board: { device: { setInput(n: number, closed: boolean): void } } } }).__RUN_FAKE_SERIAL__;
    r.board.device.setInput(5, false);
  });
  await expect(page.locator('[data-action=switch-test-done]')).toBeEnabled({ timeout: 10_000 });
  await page.locator('[data-action=switch-test-done]').click();
  await expect(page.locator('[data-step=done]')).toContainText('451.00');
  await expect(page.locator('[data-step=done] a')).toHaveCount(2);
  await shot(page, '09-done');
  expect(errors).toEqual([]);
});

test('interrupted update stays in recovery and retries the same checked image', async ({ page }) => {
  test.setTimeout(240_000);
  const worker = await open(page);
  await board(worker);
  await expect(page.locator('[data-release="sim-edge-next-451.00.hex"]')).toBeVisible({ timeout: 20_000 });
  await checklist(page);
  await page.locator('[data-action=backup-continue]').click();
  await expect.poll(() => worker.evaluate(() => {
    const b = (globalThis as unknown as { __RUN_FAKE_SERIAL__: { board?: { device: { xboot: { pageWrites: readonly unknown[] } } } } }).__RUN_FAKE_SERIAL__.board;
    return b?.device.xboot.pageWrites.length ?? 0;
  }), { timeout: 90_000 }).toBeGreaterThan(30);
  await worker.evaluate(() => {
    (globalThis as unknown as { __RUN_FAKE_SERIAL__: { board: { endpoint: { disconnect(reason: string): void } } } }).__RUN_FAKE_SERIAL__.board.endpoint.disconnect('USB pulled');
  });
  await expect(page.locator('[data-step=recovery]')).toBeVisible({ timeout: 30_000 });
  await shot(page, '10-interrupted');
  await page.getByRole('button', { name: 'Try the update again' }).click();
  await expect(page.locator('[data-safety=W49]')).toBeVisible({ timeout: 20_000 });
  await shot(page, '11-recovery');
  await worker.evaluate(() => {
    const b = (globalThis as unknown as { __RUN_FAKE_SERIAL__: { board: { endpoint: { reconnect(): void }; device: { powerCycle(): void } } } }).__RUN_FAKE_SERIAL__.board;
    b.endpoint.reconnect(); b.device.powerCycle();
  });
  await expect(page.locator('[data-post-flash=restoreRequired]')).toBeVisible({ timeout: 120_000 });
});

test('unsupported browser offers no Connect', async ({ page }) => {
  await page.addInitScript(() => {
    // Remove the capability only in this test's browser realm.
    Object.defineProperty(Navigator.prototype, 'serial', { get: () => undefined, configurable: true });
  });
  await page.goto('/update/');
  await expect(page.locator('[data-step=unsupported]')).toBeVisible();
  await expect(page.locator('[data-action=update-connect]')).toHaveCount(0);
  await shot(page, '12-unsupported');
});

test('disconnecting at the saved-backup confirmation cancels before boot entry', async ({ page }) => {
  test.setTimeout(60_000);
  const worker = await open(page);
  await board(worker);
  await expect(page.locator('[data-release="sim-edge-next-451.00.hex"]')).toBeVisible({ timeout: 20_000 });
  await checklist(page);
  await page.locator('[data-action=update-disconnect]').click();
  await expect(page.locator('[data-step=backup]')).toHaveCount(0);
  await expect(page.locator('[data-action=update-connect]')).toBeEnabled();
  expect(await worker.evaluate(() => {
    const d = (globalThis as unknown as { __RUN_FAKE_SERIAL__: { board: { device: { history: string[]; xboot: { pageWrites: unknown[] } } } } }).__RUN_FAKE_SERIAL__.board.device;
    return { writes: d.xboot.pageWrites.length, history: d.history };
  })).toMatchObject({ writes: 0 });
});


test('the update page lists five GitHub releases with dates and prerelease labels', async ({ page }) => {
  const capture = process.env['RUN_GITHUB_CATALOG_CAPTURE'];
  if (capture) await stubFirmwareCatalog(page, JSON.parse(readFileSync(capture, 'utf8')) as unknown);
  const worker = await open(page);
  await worker.evaluate(() => {
    (globalThis as unknown as { __RUN_FAKE_SERIAL__: unknown }).__RUN_FAKE_SERIAL__ = { ports: [], next: { build: { fb: 450.06, fv: 0.97, hv: 8, layout: 10002 } } };
  });
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect(page.locator('[data-step=release] [data-release]')).toHaveCount(5);
  for (const fb of ['450.06', '450.05', '450.04', '450.03', '450.02']) {
    const row = page.locator(`[data-release="tinyg-${fb}.hex"]`);
    await expect(row).toContainText('Pre-release');
    await expect(row.locator('summary')).toHaveText('Release notes');
    await expect(row.locator('button')).toHaveText(`Install ${fb}`);
  }
  await shot(page, 'github-releases');
});
