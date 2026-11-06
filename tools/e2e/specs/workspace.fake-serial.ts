import { showWorkspace, workspaceDestination } from './workspace-navigation.ts';
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
import { isReportConfig } from './helpers.ts';
import { STOP_TEXT, w2Label } from '../../../packages/safety/src/strings.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const BOARD = 'SIM-EN-0001';
const VIEWS = ['job', 'library', 'board', 'projects', 'analyze', 'settings', 'safety'] as const;
const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

interface Status {
  readonly status: { readonly session: { readonly base: string; readonly epoch: number } };
}

async function connectedTab(page: Page): Promise<Worker> {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as Status).status.session.base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
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

async function show(page: Page, view: string): Promise<void> {
  await showWorkspace(page, view);
}

/** The rail marks exactly the shown view, and no other rail button looks selected. */
async function expectRailOn(page: Page, requested: string): Promise<void> {
  const view = workspaceDestination(requested);
  const current = page.locator('[data-region="rail"] [aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute('data-view', view);
  await page.mouse.move(700, 5);
  const looks = await page.locator('[data-region="rail"] button').evaluateAll((els) => els.map((el) => ({ view: el.getAttribute('data-view'), bg: getComputedStyle(el).backgroundColor })));
  const selected = looks.find((l) => l.view === view)?.bg;
  for (const l of looks) if (l.view !== view) expect(l.bg, `${l.view ?? ''} looks selected while ${view} is shown`).not.toBe(selected);
}

test('switching views keeps the same machine worker and link, and never navigates', async ({ page }) => {
  const worker = await connectedTab(page);
  const before = ((await request(worker, { v: 3, kind: 'status' })) as Status).status.session.epoch;
  await expect(page.locator('[data-region="machine-strip"] [data-strip="state"]')).toHaveText('Machine idle', { timeout: 10_000 });
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  for (const view of [...VIEWS, 'run' as const]) {
    await show(page, view);
    await expectRailOn(page, view);
  }
  expect(navigations).toBe(0);
  const machineWorkers = page.workers().filter((w) => /machine\.worker/.test(w.url()));
  expect(machineWorkers).toHaveLength(1);
  const after = (await request(worker, { v: 3, kind: 'status' })) as Status;
  expect(after.status.session).toMatchObject({ base: 'IDLE_UNHOMED', epoch: before });
  // The board view reads the real probe facts from the same session.
  await show(page, 'board');
  await expect(page.locator('[data-board-fact="id"]')).toHaveText(BOARD);
  await expect(page.locator('[data-board-fact="fb"]')).toHaveText('450.02');
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
  await expect(tabB.locator('[data-stop-outcome="delivered"]')).toContainText(`${STOP_TEXT.stopJob} delivered to ${BOARD}.`);
  await pause.click();
  await expect.poll(() => bangs(workerA)).toBe(before + 2);
});

test('Pause and Stop job turn prominent, in the safety-bar colours only, while a machine may be moving (W29), in both themes', async ({ page }) => {
  await connectedTab(page);
  const tabB = await page.context().newPage();
  await tabB.goto('/');
  await expect(tabB.locator('[data-observer="controlled"]')).toContainText(BOARD);
  await page.close();
  await expect(tabB.locator('[data-safety="W29"]')).toBeVisible();
  const pause = tabB.locator('[data-region="stop-controls"] [data-safety="W2"]');
  const stop = tabB.locator('[data-region="stop-controls"] [data-action="stop-job"]');
  await expect(pause).toHaveAttribute('data-prominent', 'true');
  await expect(stop).toHaveAttribute('data-prominent', 'true');
  await expect(pause).toBeEnabled();
  await expect(stop).toBeEnabled();
  for (const theme of ['light', 'dark'] as const) {
    await tabB.emulateMedia({ colorScheme: theme });
    const look = (el: Element): { bg: string; border: string; fg: string } => ({ bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor, fg: getComputedStyle(el).color });
    expect(await pause.evaluate(look), theme).toEqual({ bg: 'rgb(255, 158, 27)', border: 'rgb(17, 17, 17)', fg: 'rgb(17, 17, 17)' });
    expect(await stop.evaluate(look), theme).toEqual({ bg: 'rgb(17, 17, 17)', border: 'rgb(17, 17, 17)', fg: 'rgb(255, 255, 255)' });
  }
});

test('Disconnect is in the machine strip in every view: disconnecting from a non-Run view closes the port and offers Connect again', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const worker = await connectedTab(page);
  const strip = page.locator('[data-region="machine-strip"]');
  const disconnect = strip.locator('[data-action="disconnect"]');
  for (const view of VIEWS) {
    await show(page, view);
    await expect(disconnect, view).toBeVisible();
    await expect(disconnect, view).toBeEnabled();
    await expect(disconnect, view).toBeInViewport();
  }
  await show(page, 'board');
  await disconnect.click();
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as Status).status.session.base, { timeout: 10_000 }).toBe('NOT_CONNECTED');
  // The simulated port itself is closed (a closed Web Serial port has no streams).
  const streams = await worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { readable: unknown; writable: unknown }[] } }).__RUN_FAKE_SERIAL__;
    const port = registry?.ports.at(-1);
    return port === undefined ? 'no port' : { readable: port.readable, writable: port.writable };
  });
  expect(streams).toEqual({ readable: null, writable: null });
  await expect(disconnect).toHaveCount(0);
  await expect(strip.locator('[data-state="not-connected"]')).toBeVisible();
  await show(page, 'run');
  await expect(page.locator('[data-region="strip-connection"] [data-region="connect"] [data-entry="idle"] [data-action="connect"]')).toBeVisible();
  await expect(strip.locator('[data-disconnect="refused"]')).toHaveCount(0);
});

test('the notice raised after Stop job sits above the panels and the 3D canvas: its centre point hits it, and W1 stays visible', async ({ page }) => {
  await connectedTab(page);
  const tabB = await page.context().newPage();
  await tabB.setViewportSize({ width: 1280, height: 720 });
  await tabB.goto('/');
  await expect(tabB.locator('[data-observer="controlled"]')).toContainText(BOARD);
  // A loaded job puts the job card and the 3D preview right under the strip, where the notice appears.
  await tabB.locator('[data-sample="mounting-plate"]').click();
  await tabB.locator('[data-job-step="check"]').click();
  await expect(tabB.locator('[data-preview="summary"]')).toBeVisible({ timeout: 30_000 });
  // The owner's tab was LIVE, so it had no observer row above the view. This harness can only press Stop job
  // from an observer tab; take that row out of the layout so the job card sits right under the strip, as it did.
  await tabB.locator('[data-region="overlay-banners"]').evaluate((el) => (el as HTMLElement).style.setProperty('display', 'none', 'important'));
  await tabB.getByRole('button', { name: STOP_TEXT.stopJob, exact: true }).click();
  const notice = tabB.locator('[data-stop-outcome]');
  await expect(notice).toBeVisible();
  // Loopback has the Phase 2 motion flag: Stop job runs the flush sequence, and the line says it went out.
  await expect(notice).toHaveText(`${STOP_TEXT.stopJob} delivered to ${BOARD}.`);
  const covered = (selector: string): Promise<{ readonly points: number; readonly overCard: number; readonly hidden: readonly string[] }> =>
    tabB.locator(selector).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      // The panels the notice lies over: the job card, and since the machine pane became a rail (OD-13) that rail too.
      const panels = ['.job-card', '.run-inspector'].map((s) => document.querySelector(s)?.getBoundingClientRect() ?? null).filter((p): p is DOMRect => p !== null);
      const hidden: string[] = [];
      let points = 0;
      let overCard = 0;
      // The centre point, and a grid across the whole element, all land on the element itself.
      const xs = [r.left + r.width / 2, ...Array.from({ length: 9 }, (_, i) => r.left + 3 + ((r.width - 6) * i) / 8)];
      const ys = [r.top + r.height / 2, ...Array.from({ length: 5 }, (_, i) => r.top + 3 + ((r.height - 6) * i) / 4)];
      for (const x of xs) {
        for (const y of ys) {
          points += 1;
          if (panels.some((card) => x >= card.left && x <= card.right && y >= card.top && y <= card.bottom)) overCard += 1;
          const top = document.elementFromPoint(x, y);
          if (top === null || !(top === el || el.contains(top))) hidden.push(`${Math.round(x)},${Math.round(y)} ${top?.tagName ?? ''}.${top?.className ?? ''}`);
        }
      }
      return { points, overCard, hidden };
    });
  const n = await covered('[data-stop-outcome]');
  // The notice lies over the job card or the machine pane (the panels that used to cover it), so the hit test means something.
  expect(n.overCard).toBeGreaterThan(n.points / 3);
  expect(n.hidden).toEqual([]);
  expect((await covered('[data-region="safety-bar"] [data-safety="W1"]')).hidden).toEqual([]);
});

test('the document never scrolls at 1280 × 720, in any view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await connectedTab(page);
  await page.locator('[data-sample="mounting-plate"]').click();
  await page.locator('[data-job-step="check"]').click();
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
  for (const w of writes) expect(/^\{"?[a-z0-9_]+"?:null\}\n$/.test(w) || w === '\u0005' || w === '!' || isReportConfig(w), JSON.stringify(w)).toBe(true);
  await expect(page.locator('[data-backup="saved"]')).toContainText(file.suggestedFilename());
});

for (const width of [1440, 1280] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`screenshots of the shell, ${width} px, ${theme}`, async ({ page }) => {
      test.skip(SHOTS === undefined, 'RUN_SCREENSHOTS_DIR is not set');
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 720 });
      await page.emulateMedia({ colorScheme: theme });
      await connectedTab(page);
      await expect(page.locator('[data-region="machine-strip"] [data-strip="state"]')).toHaveText('Machine idle', { timeout: 10_000 });
      const w29 = page.locator('[data-action="dismiss-w29"]');
      if ((await w29.count()) > 0) await w29.click();
      const shot = (name: string): Promise<Buffer> => page.screenshot({ path: `${SHOTS}/${width}-${theme}-${name}.png` });
      await page.locator('[data-sample="mounting-plate"]').click();
      await page.locator('[data-job-step="check"]').click();
      await expect(page.locator('[data-preview="summary"]')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await shot('run');
      await page.locator('.job-more > summary').click();
      await shot('run-job-details');
      await page.locator('.job-more > summary').click();
      await page.locator('[data-tab="live"]').click();
      await shot('run-live');
      await page.locator('[data-tab="gcode"]').click();
      if (width !== 1440) return;
      await show(page, 'setup');
      await page.waitForTimeout(300);
      await shot('setup');
      await show(page, 'tools');
      await page.locator('[data-tab="buy"]').click();
      await shot('tools-links');
      await show(page, 'materials');
      await shot('materials');
      await page.locator('[data-action="new-material"]').click();
      await shot('materials-new');
      await page.locator('[data-region="material-form"] [data-tab="cutting"]').click();
      await shot('materials-new-cutting');
      await page.locator('[data-region="material-form"] [data-action="cancel-material"]').last().click();
      await show(page, 'board');
      await expect(page.locator('[data-board-fact="id"]')).toHaveText(BOARD);
      await shot('board-overview');
      await page.locator('[data-pin="J7.3"]').click();
      await page.locator('[data-pin="J6.3"]').hover();
      await shot('board-pin');
      await page.locator('[data-pin="M2.3"]').click();
      await shot('board-motor-pin');
      for (const tab of ['motors', 'axes', 'inputs', 'io', 'comms', 'settings', 'backups', 'firmware'] as const) {
        await page.locator(`[data-board-tab="${tab}"]`).click();
        await page.waitForTimeout(150);
        await shot(`board-${tab}`);
      }
      await show(page, 'machines');
      await page.locator('[data-tab="catalogue"]').click();
      await page.locator('[data-action="copy-machine"]').first().click();
      await page.locator('[data-action="ui-level-advanced"]').click();
      await shot('machines-tinyg');
    });
  }
}
