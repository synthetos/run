/**
 * Report a problem, the Console command line and Projects in the built app
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
 * - A new project takes a G-code file and opens it in Run.
 *
 * With RUN_SCREENSHOTS_DIR set, screenshots of the three features are
 * written there at 1440 px, light and dark.
 */
import type { Page, Worker } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const BOARD = 'SIM-EN-0001';
const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

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

test('a new project takes a G-code file and opens it in Run', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await show(page, 'projects');
  const create = page.locator('[data-action="project-new"]');
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.locator('[data-project="detail"]')).toBeVisible();
  await page.locator('[data-action="project-rename"]').click();
  await page.locator('[data-project="name-input"]').fill('Fixture plate');
  await page.locator('[data-action="project-save-name"]').click();
  await expect(page.locator('[data-project="name"]')).toHaveText('Fixture plate');
  const gcode = ['(fixture plate test)', 'G21 G90', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X40 F600', 'G1 Y30', 'G1 X0', 'G1 Y0', 'G0 Z5', 'M2', ''].join('\n');
  await page.locator('[data-project="file-input"]').setInputFiles({ name: 'plate-test.nc', mimeType: 'text/plain', buffer: Buffer.from(gcode) });
  const row = page.locator('[data-project-file="plate-test.nc"]');
  await expect(row).toBeVisible();
  await expect(row.locator('[data-project="file-role"]')).toHaveValue('gcode');
  await expect(page.locator('[data-project="usage"]')).toContainText('of 500 MB');
  const axe = await new AxeBuilder({ page }).include('[data-screen="projects"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  // It survives a reload (IndexedDB).
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await show(page, 'projects');
  await expect(page.locator('[data-project-row="Fixture plate"]')).toBeVisible();
  await page.locator('[data-project-file="plate-test.nc"] [data-action="project-open-in-run"]').click();
  await expect(page.locator('[data-screen="run"]')).toBeVisible();
  await expect(page.locator('[data-preview="file-name"]')).toHaveText('plate-test.nc', { timeout: 30_000 });
  await expect(page.locator('[data-preview="summary"]')).toBeVisible({ timeout: 30_000 });
});

/** A PNG made in the page (a 2400 × 1600 gradient), to show the 2000 px re-encode. */
async function samplePhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = new OffscreenCanvas(2400, 1600);
    const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 2400, 1600);
    g.addColorStop(0, '#c9c3b6');
    g.addColorStop(1, '#6f7c86');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2400, 1600);
    ctx.fillStyle = '#9aa3aa';
    ctx.fillRect(500, 420, 1400, 760);
    ctx.fillStyle = '#3d454c';
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      ctx.beginPath();
      ctx.arc(640 + i * 225, 560 + j * 240, 38, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob = await c.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

for (const theme of ['light', 'dark'] as const) {
  test(`screenshots of report, console and projects, 1440 px, ${theme}`, async ({ page }) => {
    test.skip(SHOTS === undefined, 'RUN_SCREENSHOTS_DIR is not set');
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    const shot = async (name: string): Promise<void> => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/1440-${theme}-${name}.png` });
    };
    const worker = await connectedTab(page);
    await openSample(page);

    // Console with replies.
    await page.locator('[data-tab="console"]').click();
    const input = page.locator('[data-console="input"]');
    for (const line of ['$xvm', 'g0 x10']) {
      await input.fill(line);
      await input.press('Enter');
    }
    await expect(page.locator('[data-console-reply="answered"]').first()).toBeVisible({ timeout: 10_000 });
    await input.fill('?');
    await input.press('Enter');
    await expect(page.locator('[data-console-reply="answered"]').nth(1)).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-console-entry="read"]').first().locator('.cl-raw > summary').click();
    await page.locator('.cl-log').evaluate((el) => el.scrollTo(0, 0));
    await input.fill('$xv');
    await shot('console');
    await input.fill('');
    await page.locator('.cl-log').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await shot('console-replies');

    // Report from a notice.
    await resetBoard(worker);
    await expect(page.locator('[data-event-notice]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-action="report-event"]').click();
    const dialog = page.locator('[data-region="report"] [role="dialog"]');
    await dialog.locator('[data-report-kind="firmware"]').click();
    await shot('report-triage');
    await dialog.locator('[data-action="report-next"]').click();
    await dialog.locator('#report-happened').fill('The board printed its start-up banner while idle, about a minute after connecting. Nothing was running.');
    await dialog.locator('#report-steps').fill('1. Connect\n2. Leave it idle for a minute');
    await expect.poll(() => dialog.locator('[data-report-item="transcript"] input').isChecked(), { timeout: 5000 }).toBe(true);
    await dialog.locator('[data-report-item="board"] .report-preview > summary').click();
    await dialog.locator('[data-report-item="gcode"] .report-preview > summary').click();
    await dialog.locator('[data-report-item="gcode"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot('report-preview');
    await dialog.locator('[data-report="scope-whole"]').click();
    await expect(page.locator('[data-report="consent"]')).toBeVisible();
    await shot('report-consent');
    await page.locator('[data-action="consent-excerpt"]').click();
    await dialog.locator('[data-action="report-close"]').click();

    // Projects: list, detail, upload.
    await show(page, 'projects');
    await page.locator('[data-action="project-new"]').click();
    await page.locator('[data-action="project-rename"]').click();
    await page.locator('[data-project="name-input"]').fill('Fixture plate, 6061');
    await page.locator('[data-action="project-save-name"]').click();
    await page.locator('[data-action="project-edit-description"]').click();
    await page.locator('[data-project="description-input"]').fill('A 300 × 200 mm fixture plate for the router, drilled on a 50 mm grid.\n\n- 5 mm holes, tapped M6 by hand\n- Faced both sides first\n\nNext time: **slow the drill** to 0.04 mm/rev. Notes on the [forum thread](https://synthetos.com/forum/).');
    await page.locator('[data-action="project-save-description"]').click();
    const plate = Buffer.from(['(fixture plate)', 'G21 G90', 'G0 Z5', 'G0 X25 Y25', 'G81 Z-6 R2 F120', 'X75', 'X125', 'G80', 'M2', ''].join('\n'));
    await page.locator('[data-project="file-input"]').setInputFiles([
      { name: 'plate-drill.nc', mimeType: 'text/plain', buffer: plate },
      { name: 'plate-outline.dxf', mimeType: 'application/dxf', buffer: Buffer.from('0\nSECTION\n0\nEOF\n') },
      { name: 'plate.jpg', mimeType: 'image/png', buffer: await samplePhoto(page) },
    ]);
    await expect(page.locator('[data-project-image]')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('[data-project-file="plate-drill.nc"] [data-project="file-note"]').fill('Drilling, T5 5 mm drill');
    await page.locator('[data-project="detail"] .link-form input[type="text"]').fill('Fixture drawing');
    await page.locator('[data-project="detail"] .link-form input[type="url"]').fill('https://example.com/fixture-plate.pdf');
    await page.locator('[data-action="project-add-link"]').click();
    await page.locator('[data-project="setup"] select[aria-label="Material"]').selectOption({ label: 'Aluminium 6061-T6' });
    await page.locator('[data-action="project-use-stock"]').click();
    await page.locator('[data-project="setup"] .tool-chip').nth(4).click();
    const huge = test.info().outputPath('huge-surfacing.nc');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(huge, Buffer.alloc(51 * 1024 * 1024, 0x47));
    await page.locator('[data-project="file-input"]').setInputFiles(huge);
    await expect(page.locator('.upload-errors li')).toHaveCount(1);
    await page.locator('[data-project="detail"] .project-sections h2').nth(1).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot('projects-upload');
    await page.locator('[data-action="project-new"]').click();
    await page.locator('[data-action="project-new"]').click();
    await page.locator('[data-project-row="Fixture plate, 6061"]').click();
    await page.locator('[data-project="detail"]').evaluate((el) => el.scrollTo(0, 0));
    await shot('projects-detail');
    await page.locator('[data-project-row="Project 3"]').click();
    await shot('projects-list');
  });
}
