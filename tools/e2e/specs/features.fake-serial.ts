/**
 * Report a problem and the Console command line in the built app
 * (fake-serial TEST build).
 *
 * - A fault notice (the simulated board resets: a banner after ready) offers
 *   "Report this". The dialog triages, redacts the board id before the
 *   preview, keeps the G-code excerpt as the default and asks before the
 *   whole file, and builds a pre-filled issue link on the allowlisted repo.
 *   Reporting writes nothing to the board.
 * - Typing $xvm in the Console sends one allowlisted GET ({"xvm":null}) and
 *   shows the answer in plain words, with the raw JSON one click away.
 *   Motion typed there is shown and never sent.
 */
import type { Page, Worker } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const BOARD = 'SIM-EN-0001';

interface Status {
  readonly status: { readonly session: { readonly base: string; readonly overlays: readonly string[] } };
}

async function connectedTab(page: Page): Promise<Worker> {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as Status).status.session.base, { timeout: 10_000 }).toBe('CONNECTED_UNKNOWN');
  await expect(page.locator('[data-region="machine-strip"] [data-strip="state"]')).toHaveText('Connected · read only', { timeout: 10_000 });
  const w29 = page.locator('[data-action="dismiss-w29"]');
  if ((await w29.count()) > 0) await w29.click();
  return worker;
}

/** Everything the page's worker wrote to the simulated board, as text. */
function hostWrites(worker: Worker): Promise<string[]> {
  return worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly Entry[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports[0]?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data));
  });
}

/** The simulated board resets while connected: the session sees a banner after ready (FAULT). */
async function resetBoard(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: { resetBoard(): void } } }[] } }).__RUN_FAKE_SERIAL__;
    registry?.ports[0]?.endpoint.device.resetBoard();
  });
}

async function show(page: Page, view: string): Promise<void> {
  await page.locator(`[data-region="rail"] [data-view="${view}"]`).click();
  await expect(page.locator(`[data-screen="${view}"]`)).toBeVisible();
}

async function openSample(page: Page): Promise<void> {
  await show(page, 'run');
  await page.locator('[data-sample="mounting-plate"]').click();
  await expect(page.locator('[data-preview="summary"]')).toBeVisible({ timeout: 30_000 });
}

test('a fault notice opens the report: triage, redacted preview, the G-code consent, and an allowlisted issue link', async ({ page }) => {
  const worker = await connectedTab(page);
  await openSample(page);
  const before = (await hostWrites(worker)).length;
  await resetBoard(worker);
  const notice = page.locator('[data-event-notice]');
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice).toHaveAttribute('data-event-notice', 'fault');
  await notice.locator('[data-action="report-event"]').click();

  const dialog = page.locator('[data-region="report"] [role="dialog"]');
  await expect(dialog).toHaveAttribute('data-report-step', 'triage');
  // The dialog covers the views only: the machine strip with Pause and Stop job stays uncovered.
  const strip = await page.locator('[data-region="machine-strip"]').boundingBox();
  const wrap = await page.locator('[data-region="report"]').boundingBox();
  expect((wrap?.y ?? 0) >= (strip?.y ?? 0) + (strip?.height ?? 0) - 1).toBe(true);
  await dialog.locator('[data-report-kind="run"]').click();
  await dialog.locator('[data-action="report-next"]').click();
  await expect(dialog).toHaveAttribute('data-report-step', 'write');
  await expect(dialog.locator('#report-title')).toHaveValue(/^FAULT bannerAfterReady: /);

  // Every collected item is redacted before the preview: the board id never appears.
  await expect(dialog.locator('[data-report-item="board"] input')).toBeChecked();
  await expect(dialog.locator('[data-report-item="event"] input')).toBeChecked();
  await expect(dialog.locator('[data-report-item="settings"] input')).not.toBeChecked();
  await expect(dialog.locator('[data-report-preview="board"]')).toContainText('board id: 0X0000-XXX');
  await expect.poll(() => dialog.locator('[data-report-item="transcript"] input').isChecked(), { timeout: 5000 }).toBe(true);
  const previews = await dialog.locator('[data-report-preview]').allTextContents();
  expect(previews.join('\n')).not.toContain(BOARD);
  expect(previews.join('\n')).toContain('0X0000-XXX');

  // G-code: the excerpt is the default; the whole file needs the consent step, every time.
  await expect(dialog.locator('[data-report="file-name"]')).toHaveText('mounting-plate.nc');
  await expect(dialog.locator('[data-report="scope-excerpt"]')).toBeChecked();
  await dialog.locator('[data-report="scope-whole"]').click();
  const consent = page.locator('[data-report="consent"]');
  await expect(consent).toContainText('Upload the whole G-code file to this issue? Issues are public: anyone can read and download it.');
  await expect(consent.locator('[data-action="consent-excerpt"]')).toBeFocused();
  await expect(consent.locator('[data-action="consent-excerpt"]')).toHaveText('Only 25 lines around the problem');
  await consent.locator('[data-action="consent-excerpt"]').click();
  await expect(consent).toHaveCount(0);
  await expect(dialog.locator('[data-report="scope-excerpt"]')).toBeChecked();
  await dialog.locator('[data-report="scope-whole"]').click();
  await expect(consent).toBeVisible();
  await consent.locator('[data-action="consent-whole"]').click();
  await expect(dialog.locator('[data-report="scope-whole"]')).toBeChecked();

  const axe = await new AxeBuilder({ page }).include('[data-region="report"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

  // Filing: a pre-filled link on synthetos/run, opened in a new tab with noopener; nothing is fetched.
  await dialog.locator('#report-happened').fill('The board reset while it was idle.');
  const open = dialog.locator('[data-report="open"]');
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', /noopener/);
  const href = (await open.getAttribute('href')) ?? '';
  const url = new URL(href);
  expect(url.origin + url.pathname).toBe('https://github.com/synthetos/run/issues/new');
  expect([...url.searchParams.keys()]).toEqual(['title', 'body']);
  expect(url.searchParams.get('body')).toContain('The board reset while it was idle.');
  expect(url.searchParams.get('body')).toContain('<details>');
  expect(url.searchParams.get('body')).not.toContain(BOARD);
  expect(href.length).toBeLessThanOrEqual(8000);

  // Download report files: a zip.
  const download = page.waitForEvent('download');
  await dialog.locator('[data-action="report-download"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^run-report-.*\.zip$/);
  const { readFile } = await import('node:fs/promises');
  const zip = await readFile(await file.path());
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.includes(Buffer.from('report.md'))).toBe(true);
  expect(zip.includes(Buffer.from('mounting-plate.nc'))).toBe(true);
  expect(zip.includes(Buffer.from(BOARD))).toBe(false);

  // Reporting sent nothing to the board.
  const writes = (await hostWrites(worker)).slice(before);
  for (const w of writes) expect(/^\{"?[a-z0-9_]+"?:null\}\n$/.test(w) || w === '\u0005', JSON.stringify(w)).toBe(true);
  await dialog.locator('[data-action="report-close"]').click();
  await expect(page.locator('[data-region="report"]')).toHaveCount(0);
});

test('the account menu, Safety and the Board view open the report; the forum target copies the report', async ({ page }) => {
  await connectedTab(page);
  await page.locator('.account-button').click();
  await page.locator('[data-action="report-problem"]').first().click();
  const dialog = page.locator('[data-region="report"] [role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-report-kind="question"]').click();
  await dialog.locator('[data-action="report-next"]').click();
  await dialog.locator('#report-title').fill('How do I home Z only?');
  await dialog.locator('#report-happened').fill('Not sure where to start.');
  const open = dialog.locator('[data-report="open"]');
  await expect(open).toHaveAttribute('href', 'https://synthetos.com/forum/new/');
  await dialog.locator('[data-action="report-close"]').click();
  await show(page, 'board');
  await page.locator('[data-action="report-board"]').click();
  await expect(dialog).toHaveAttribute('data-report-step', 'write');
  await expect(dialog.locator('.report-sub')).toContainText('synthetos/TinyG');
  await dialog.locator('[data-action="report-close"]').click();
  await show(page, 'safety');
  await page.locator('[data-screen="safety"] [data-action="report-problem"]').click();
  await expect(dialog).toHaveAttribute('data-report-step', 'triage');
});

test('the Console turns $xvm into {"xvm":null}, sends it as a read and shows the answer in plain words', async ({ page }) => {
  const worker = await connectedTab(page);
  await page.locator('[data-tab="console"]').click();
  const input = page.locator('[data-console="input"]');
  await input.fill('$xv');
  await expect(page.locator('#cl-suggest [role="option"]').first()).toContainText('xvm');
  await expect(page.locator('[data-console="hint"]')).toContainText('X maximum velocity');
  await input.press('Tab');
  await expect(input).toHaveValue('$xvm');
  await expect(page.locator('[data-console="preview"]')).toHaveText('{"xvm":null}');
  const before = (await hostWrites(worker)).length;
  await input.press('Enter');
  const reply = page.locator('[data-console-entry="read"]').last();
  await expect(reply.locator('[data-console-reply="answered"]')).toBeVisible({ timeout: 10_000 });
  await expect(reply.locator('[data-console-key="xvm"]')).toContainText('X maximum velocity');
  await reply.locator('.cl-raw > summary').click();
  await expect(reply.locator('[data-console-raw]')).toContainText('"xvm"');
  await expect.poll(async () => (await hostWrites(worker)).slice(before)).toContain('{"xvm":null}\n');

  // Motion and writes are shown, never sent; realtime characters are refused.
  const mark = (await hostWrites(worker)).length;
  await input.fill('g0 x10');
  await input.press('Enter');
  await expect(page.locator('[data-console-reply="motion"]').last()).toContainText('Motion arrives with motion control');
  await input.fill('$xvm=5000');
  await input.press('Enter');
  await expect(page.locator('[data-console-reply="write"]').last()).toContainText('Settings writes arrive in a later phase');
  await input.fill('!');
  await input.press('Enter');
  await expect(page.locator('[data-console-reply="refused"]').last()).toContainText('Pause and Stop job');
  const axe = await new AxeBuilder({ page }).include('[data-region="console-line"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  await input.press('ArrowUp');
  await expect(input).toHaveValue('!');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('$xvm=5000');
  const writes = (await hostWrites(worker)).slice(mark);
  for (const w of writes) expect(/^\{"?[a-z0-9_]+"?:null\}\n$/.test(w) || w === '\u0005', JSON.stringify(w)).toBe(true);
});
