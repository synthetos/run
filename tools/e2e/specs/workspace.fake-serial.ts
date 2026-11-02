/**
 * Stage 1 workspace shell in the built app (fake-serial TEST build): one
 * page that never reloads or scrolls, with Pause and Stop job reachable in
 * every view.
 *
 * - Switching views never re-creates the machine worker or touches the
 *   connection: the same worker answers, on the same link epoch, after every
 *   view has been shown.
 * - Pause and Stop job are visible, in the same place and enabled in every
 *   view while another tab of this browser controls a machine (the observer
 *   role: they are never gated by a view), and Stop job reaches the worker.
 * - The document never scrolls at 1280 × 720, in any view.
 *
 * With RUN_SCREENSHOTS_DIR set, screenshots of the shell are written there
 * at 1440 and 1280 px, light and dark.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { STOP_TEXT, w2Label } from '../../../packages/safety/src/strings.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const BOARD = 'SIM-EN-0001';
const VIEWS = ['run', 'setup', 'tools', 'materials', 'board', 'machines', 'projects', 'analyze', 'settings', 'safety'] as const;
const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

interface Status {
  readonly status: { readonly session: { readonly base: string; readonly epoch: number } };
}

async function connectedTab(page: Page): Promise<Worker> {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as Status).status.session.base, { timeout: 10_000 }).toBe('CONNECTED_UNKNOWN');
  return worker;
}

function bangs(worker: Worker): Promise<number> {
  return worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly Entry[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports[0]?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write' && e.data.length === 1 && e.data[0] === 0x21).length;
  });
}

async function show(page: Page, view: (typeof VIEWS)[number]): Promise<void> {
  await page.locator(`[data-region="rail"] [data-view="${view}"]`).click();
  await expect(page.locator(`[data-screen="${view}"]`)).toBeVisible();
}

test('switching views keeps the same machine worker and link, and never navigates', async ({ page }) => {
  const worker = await connectedTab(page);
  const before = ((await request(worker, { v: 3, kind: 'status' })) as Status).status.session.epoch;
  await expect(page.locator('[data-region="machine-strip"] [data-strip="state"]')).toHaveText('Connected · read only', { timeout: 10_000 });
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  for (const view of [...VIEWS, 'run' as const]) await show(page, view);
  expect(navigations).toBe(0);
  const machineWorkers = page.workers().filter((w) => /machine\.worker/.test(w.url()));
  expect(machineWorkers).toHaveLength(1);
  const after = (await request(worker, { v: 3, kind: 'status' })) as Status;
  expect(after.status.session).toMatchObject({ base: 'CONNECTED_UNKNOWN', epoch: before });
  // The board view reads the real probe facts from the same session.
  await show(page, 'board');
  await expect(page.locator('[data-board-fact="id"]')).toHaveText(BOARD);
  await expect(page.locator('[data-board-fact="fb"]')).toHaveText('450.01');
  expect(await request(worker, { v: 3, kind: 'close' })).toMatchObject({ ok: true });
});

test('Pause and Stop job are in the same place and enabled in every view (observer tab), and Stop job reaches the worker', async ({ page }) => {
  const workerA = await connectedTab(page);
  const tabB = await page.context().newPage();
  await tabB.setViewportSize({ width: 1280, height: 720 });
  await tabB.goto('/');
  await expect(tabB.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(tabB.locator('[data-observer="controlled"]')).toContainText(BOARD);
  const pause = tabB.getByRole('button', { name: w2Label(), exact: true });
  const stop = tabB.getByRole('button', { name: STOP_TEXT.stopJob, exact: true });
  let where: { x: number; y: number } | null = null;
  for (const view of VIEWS) {
    await show(tabB, view);
    await expect(pause).toBeEnabled();
    await expect(stop).toBeEnabled();
    await expect(pause).toBeInViewport();
    await expect(stop).toBeInViewport();
    const box = await stop.boundingBox();
    expect(box).not.toBeNull();
    if (where === null) where = { x: box?.x ?? 0, y: box?.y ?? 0 };
    expect({ x: box?.x, y: box?.y }, view).toEqual(where);
  }
  const before = await bangs(workerA);
  await stop.click();
  await expect.poll(() => bangs(workerA)).toBe(before + 1);
  await expect(tabB.locator('[data-stop-outcome="delivered"]')).toContainText(`as ${w2Label()}`);
  await pause.click();
  await expect.poll(() => bangs(workerA)).toBe(before + 2);
});

test('the document never scrolls at 1280 × 720, in any view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await connectedTab(page);
  await page.locator('[data-sample="mounting-plate"]').click();
  await expect(page.locator('[data-preview="summary"]')).toBeVisible({ timeout: 30_000 });
  for (const view of VIEWS) {
    await show(page, view);
    const size = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth, y: scrollY }));
    expect(size.h, view).toBeLessThanOrEqual(size.ih);
    expect(size.w, view).toBeLessThanOrEqual(size.iw);
    expect(size.y, view).toBe(0);
  }
  // The 3D view keeps a usable height on a short screen. This harness opens the port inside the worker,
  // so the page is not LIVE and sees its own worker's first (unidentified) lock released: W29. Dismiss it.
  await show(page, 'run');
  const w29 = page.locator('[data-action="dismiss-w29"]');
  if ((await w29.count()) > 0) await w29.click();
  const viewer = await page.locator('.run-view .viewer').boundingBox();
  expect(viewer?.height ?? 0).toBeGreaterThanOrEqual(220);
});

test('the board backup reads allowlisted settings with GETs only and saves JSON named by board id and date', async ({ page }) => {
  const worker = await connectedTab(page);
  await show(page, 'board');
  await page.locator('[data-board-tab="backups"]').click();
  const button = page.locator('[data-action="backup"]');
  await expect(button).toBeEnabled({ timeout: 15_000 });
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(new RegExp(`^synthetos-settings-${BOARD}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
  const { readFile } = await import('node:fs/promises');
  const backup = JSON.parse(await readFile(await file.path(), 'utf8')) as { format: string; board: { id: string }; units: { g21Sent: boolean }; tokens: Record<string, unknown> };
  expect(backup.format).toBe('synthetos-run-settings-backup');
  expect(backup.board.id).toBe(BOARD);
  expect(backup.units.g21Sent).toBe(false);
  expect(Object.keys(backup.tokens).length).toBeGreaterThan(10);
  const writes = await worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly Entry[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports[0]?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data));
  });
  for (const w of writes) expect(/^\{"?[a-z0-9_]+"?:null\}\n$/.test(w) || w === '\u0005' || w === '!', JSON.stringify(w)).toBe(true);
  await expect(page.locator('[data-backup="saved"]')).toContainText(file.suggestedFilename());
});

for (const width of [1440, 1280] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`screenshots of the shell, ${width} px, ${theme}`, async ({ page }) => {
      test.skip(SHOTS === undefined, 'RUN_SCREENSHOTS_DIR is not set');
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 720 });
      await page.emulateMedia({ colorScheme: theme });
      await connectedTab(page);
      await expect(page.locator('[data-region="machine-strip"] [data-strip="state"]')).toHaveText('Connected · read only', { timeout: 10_000 });
      await page.locator('[data-sample="mounting-plate"]').click();
      await expect(page.locator('[data-preview="summary"]')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/${width}-${theme}-run.png` });
      await page.locator('[data-tab="live"]').click();
      await page.screenshot({ path: `${SHOTS}/${width}-${theme}-run-live.png` });
      for (const view of ['board', 'setup', 'tools', 'materials', 'machines'] as const) {
        await show(page, view);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/${width}-${theme}-${view}.png` });
      }
      await show(page, 'board');
      await page.locator('[data-board-tab="settings"]').click();
      await page.screenshot({ path: `${SHOTS}/${width}-${theme}-board-settings.png` });
    });
  }
}
