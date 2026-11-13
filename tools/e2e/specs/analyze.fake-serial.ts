/**
 * Analyze slice 1 (docs/design/ANALYZE.md): with no board, profile, material inputs or tool, an opened file already
 * shows what it does and what to fix. Connecting adds the board's rapid speeds, labelled "Board settings". A newer
 * file replaces the older one's report. One operation card holds the plunge and the cut. A finding opens Job at its
 * line, by keyboard.
 * Visiting Analyze writes nothing to the board. With ANALYZE_SHOTS set to a directory, Analyze is captured in Simple
 * and Advanced, light and dark, at 1280x720 and 390x844.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';
import { connect, open } from './jobFlow.ts';

const SHOTS = process.env['ANALYZE_SHOTS'];

/** One operation: a plunge, a long cut, a dense run of short moves and a slow finishing pass. */
function job(): string {
  const lines = ['(01 Pocket)', 'G21 G90 G17', 'S12000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X100 F1500'];
  for (let i = 0; i < 120; i++) lines.push(`G1 X${(100 + (i % 2 === 0 ? 0.3 : 0)).toFixed(1)} Y${(i * 0.3).toFixed(1)} F1500`);
  lines.push('G1 X50 F300', 'G4 P1', 'G0 Z5', 'M5', 'M30');
  return `${lines.join('\n')}\n`;
}

function writes(worker: Worker): Promise<string[]> {
  return worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly Entry[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports.at(-1)?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data));
  });
}

async function analyze(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.locator('[data-region="rail"] [data-view="analyze"]').click();
  const view = page.locator('[data-screen="analyze"]');
  await expect(view).toBeVisible();
  return view;
}

async function contained(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
  expect(size.h).toBeLessThanOrEqual(size.ih);
  expect(size.w).toBeLessThanOrEqual(size.iw);
}

async function shots(page: Page): Promise<void> {
  if (SHOTS === undefined) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((s) => { document.documentElement.dataset['theme'] = s; }, scheme);
    for (const level of ['simple', 'advanced'] as const) {
      await page.locator(`[data-action="ui-level-${level}"]`).click();
      for (const [w, h] of [[1280, 720], [390, 844]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(300);
        await page.locator('[data-screen="analyze"] .scroll-region').evaluate((el) => { el.scrollTop = 0; });
        await page.screenshot({ path: `${SHOTS}/analyze-${level}-${scheme}-${w}x${h}.png` });
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('[data-action="ui-level-simple"]').click();
}

test('disconnected, no inputs: a lower bound, what to fix with links, one operation with its regimes', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await ready(page);
  // Disconnected: the file opens in the preview (no board check).
  await page.locator('[data-job-step="run"]').click();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'pocket.nc', mimeType: 'text/plain', buffer: Buffer.from(job()) });
  const view = await analyze(page);
  const summary = view.locator('[data-analyze="summary"]');
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary.locator('[data-analyze="time"]')).toHaveText(/^At least \d+ s$/);
  await expect(summary.locator('[data-analyze="connect"]')).toHaveText('Connect to get a closer time.');
  await expect(summary.locator('[data-analyze="help-line"]')).toHaveText(['Real time is longer.', 'Rapids aren’t timed yet.', 'The machine slows for short moves and corners.', '1 dwell adds 1 s.']);
  await expect(summary.locator('[data-fact="rapid-time"]')).toHaveText(/^\d+ mm rapids$/);
  await expect(view).not.toContainText('Unavailable');
  await expect(view).not.toContainText('Not known');
  // What to fix: the tiny moves first, then the slow pass; each says what to do and links to Job.
  const fixes = view.locator('[data-fix]');
  await expect(fixes).toHaveCount(2);
  const tiny = view.locator('[data-fix="tiny"]');
  await expect(tiny.locator('h3')).toHaveText('Most of this file is short moves'); // about 0.3 mm each
  await expect(tiny.locator('.analyze-todo p')).toHaveText(['Turn on arcs and smoothing in your CAM.']);
  await tiny.locator('[data-fix-details] summary').click();
  await expect(tiny.locator('[data-fix-details] li').first()).toHaveText(/^Half are under /);
  // One operation card, with the plunge and the cuts under it; questions one at a time.
  const ops = view.locator('[data-advisor-operation]');
  await expect(ops).toHaveCount(1);
  await expect(ops.first().locator('h3')).toHaveText('Pocket');
  await expect(ops.first().locator('[data-regime="plunge"]')).toHaveCount(1);
  await expect(ops.first().locator('[data-regime="cut"]')).toHaveCount(2);
  await expect(view.locator('[data-analyze="advice"] [data-advisor="question"]')).toHaveCount(2); // the machine, and the spindle tool
  await expect(view.locator('[data-action="advisor-engine"]')).toHaveCount(0);
  await contained(page);
  // Keyboard: "Go to line" opens Job with the G-code list at that line.
  const go = tiny.locator('[data-action="go-to-line"]');
  const line = await go.getAttribute('data-line');
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="job"]')).toBeVisible();
  await expect(page.locator('[data-preview="scrub-line"]')).toHaveText(`file line ${line ?? ''}`);
  // "Show on toolpath" opens Job too.
  await analyze(page);
  await view.locator('[data-fix="slow"] [data-action="show-on-toolpath"]').click();
  await expect(page.locator('[data-screen="job"]')).toBeVisible();
  // Advanced: the dense sections, the move-rate table and one line instead of a table of unknowns; still no engine picker.
  await page.locator('[data-action="ui-level-advanced"]').click();
  const adv = await analyze(page);
  await expect(adv.locator('[data-analyze="histogram"]')).toBeVisible();
  await expect(adv.locator('[data-analyze="axis-settings"]')).toHaveText('Speeds not read yet.');
  await expect(adv.locator('[data-action="advisor-engine"]')).toHaveCount(0);
  await page.locator('[data-action="ui-level-simple"]').click();
});

test('connected: "Board settings" times the rapids; a newer file replaces the report; nothing is written to the board', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const worker = await connect(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, job(), 'pocket.nc');
  const before = (await writes(worker)).length;
  const view = await analyze(page);
  const summary = view.locator('[data-analyze="summary"]');
  await expect(summary.locator('[data-fact="rapid-time"]')).toHaveText(/^\d+ mm rapids \(\d+ s\)$/);
  await expect(summary.locator('[data-analyze="help-line"]')).toContainText(['Board settings']);
  await expect(summary.locator('[data-analyze="connect"]')).toHaveCount(0);
  await page.locator('[data-action="ui-level-advanced"]').click();
  await expect(view.locator('[data-analyze="axis-settings"]')).toContainText('Board settings');
  await page.locator('[data-action="ui-level-simple"]').click();
  await contained(page);
  await shots(page);
  // Visiting Analyze (and every level and theme) sent nothing but the status reads the session always makes.
  const after = (await writes(worker)).slice(before).filter((w) => !/^\{"?[a-z0-9]+"?:null\}\n?$/.test(w) && w !== '\x05');
  expect(after).toEqual([]);
  // A newer file: its report replaces the older one's.
  await page.locator('[data-region="rail"] [data-view="job"]').click();
  await open(page, '(01 Facing)\nG21 G90\nS10000 M3\nG0 X0 Y0 Z2\nG1 Z0 F300\nG1 X50 F900\nM5\nM30\n', 'facing.nc');
  const fresh = await analyze(page);
  await expect(fresh.locator('[data-advisor-operation] h3')).toHaveText(['Facing']);
  await expect(fresh.locator('[data-fix="tiny"]')).toHaveCount(0);
});

/** A saved board reading (Analyze keeps the last one): the Shapeoko 2 defaults, with every planner setting. */
const SAVED_READING = {
  v: 1,
  value: {
    dialect: 'tinyg-en', boardId: 'EN-1', unit: 1,
    vm: { X: 16000, Y: 16000, Z: 1000 }, fr: { X: 16000, Y: 16000, Z: 1000 }, jm: { X: 5000, Y: 5000, Z: 50 }, jd: { X: 0.01, Y: 0.01, Z: 0.01 },
    ja: 2000000, ct: 0.01, spu: { X: 40, Y: 40, Z: 755.9293 }, at: Date.UTC(2026, 10, 9, 14, 2),
  },
};

test('a saved board reading: the firmware model times the file, "About …", and says where the settings came from', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.evaluate((r) => { localStorage.setItem('run.ws.analysis.board-reading.v1', JSON.stringify(r)); }, SAVED_READING);
  await page.reload();
  await ready(page);
  await page.locator('[data-job-step="run"]').click();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'pocket.nc', mimeType: 'text/plain', buffer: Buffer.from(job()) });
  const view = await analyze(page);
  const summary = view.locator('[data-analyze="summary"]');
  await expect(summary.locator('[data-analyze="time"]')).toHaveText(/^About \d+ s$/, { timeout: 15_000 });
  await expect(summary.locator('[data-analyze="estimate"]')).toHaveText('From your machine’s settings.');
  await expect(summary.locator('[data-analyze="help-line"]').nth(1)).toContainText('Settings: Last read ');
  await contained(page);
  // A zigzag of 0.1 mm moves: the speed card takes in the tiny-moves numbers, one fix, the tags behind Details.
  const zigzag = ['G21 G90 G17', 'G0 X0 Y0', 'G1 Z-1 F600', ...Array.from({ length: 1000 }, (_, i) => `G1 X${(i % 2) * 0.1} Y${(i * 0.05).toFixed(2)} F3000`), 'M30'].join('\n');
  await page.locator('[data-region="rail"] [data-view="job"]').click();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'zigzag.nc', mimeType: 'text/plain', buffer: Buffer.from(zigzag) });
  const again = await analyze(page);
  const speed = again.locator('[data-fix="speed"]');
  await expect(speed.locator('h3')).toHaveText(/^(Mostly|Often) speeding up and slowing down \(\d+%\)$/, { timeout: 15_000 });
  await expect(speed.locator('.analyze-todo p')).toHaveText(['Turn on arcs and smoothing in your CAM.']);
  await expect(again.locator('[data-fix="tiny"]')).toHaveCount(0);
  await expect(again.locator('[data-fact="rapid-time"]')).toHaveCount(0); // G0 to where it already is: no rapids chip
  if (SHOTS !== undefined) {
    await speed.locator('[data-fix-details] summary').click();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((c) => { document.documentElement.dataset['theme'] = c; }, scheme);
      await page.screenshot({ path: `${SHOTS}/speed-${scheme}-1280x720.png` });
    }
  }
});

// A local file (ANALYZE_FILE, never committed) captured into ANALYZE_SHOTS.
const LOCAL_FILE = process.env['ANALYZE_FILE'];
test('a local file: Analyze in Simple and Advanced, light and dark, 1280x720 and 390x844', async ({ page }) => {
  test.skip(LOCAL_FILE === undefined || SHOTS === undefined, 'set ANALYZE_FILE and ANALYZE_SHOTS');
  test.setTimeout(120_000);
  const { readFileSync } = await import('node:fs');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  if (process.env['ANALYZE_SAVED_READING'] === '1') {
    await page.evaluate((r) => { localStorage.setItem('run.ws.analysis.board-reading.v1', JSON.stringify(r)); }, SAVED_READING);
    await page.reload();
  }
  await ready(page);
  await page.locator('[data-job-step="run"]').click();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'local.nc', mimeType: 'text/plain', buffer: readFileSync(LOCAL_FILE as string) });
  const view = await analyze(page);
  await expect(view.locator('[data-analyze="summary"]')).toBeVisible({ timeout: 60_000 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((c) => { document.documentElement.dataset['theme'] = c; }, scheme);
    for (const level of ['simple', 'advanced'] as const) {
      await page.locator(`[data-action="ui-level-${level}"]`).click();
      for (const [w, hgt] of [[1280, 720], [390, 844]] as const) {
        await page.setViewportSize({ width: w, height: hgt });
        await page.waitForTimeout(300);
        // Back to the top: the scroll region, and the page itself (a phone scrolls the page).
        await page.locator('[data-screen="analyze"] .scroll-region').evaluate((el) => { el.scrollTop = 0; });
        await page.locator('[data-screen="analyze"] .view-head').evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await expect(page.locator('[data-screen="analyze"] [data-analyze="time"]')).toBeInViewport();
        await page.screenshot({ path: `${SHOTS as string}/local-${level}-${scheme}-${w}x${hgt}.png` });
        // Further down: the findings' links, then the operations.
        for (const part of ['links', 'advice', 'details'] as const) {
          const target = part === 'links' ? page.locator('[data-screen="analyze"] [data-fix] [data-action="go-to-line"]').first() : page.locator(`[data-screen="analyze"] [data-analyze="${part}"]`);
          if ((await target.count()) === 0) continue;
          await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await page.screenshot({ path: `${SHOTS as string}/local-${level}-${scheme}-${w}x${hgt}-${part}.png` });
        }
      }
    }
  }
  // Behind the (?) and a card's Details, both themes.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('[data-action="ui-level-simple"]').click();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((c) => { document.documentElement.dataset['theme'] = c; }, scheme);
    await page.locator('[data-screen="analyze"] .scroll-region').evaluate((el) => { el.scrollTop = 0; });
    await page.locator('[data-screen="analyze"] [data-analyze="summary"] [data-action="context-help"]').hover();
    await page.screenshot({ path: `${SHOTS as string}/local-simple-${scheme}-1280x720-help.png` });
    const more = page.locator('[data-screen="analyze"] [data-fix-details]').first();
    await more.locator('summary').click();
    await more.evaluate((el) => el.closest('.analyze-fix')?.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${SHOTS as string}/local-simple-${scheme}-1280x720-fix-details.png` });
    await more.locator('summary').click();
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { document.documentElement.dataset['theme'] = 'light'; });
  await page.locator('[data-action="ui-level-simple"]').click();
  // "Show on toolpath": Job with the lines highlighted on the toolpath. The phone width lays Job out again and the
  // preview reloads the file; wait for that to settle first.
  await page.waitForTimeout(3000);
  // The tiny-moves card, or the speed card that took it in.
  const dense = page.locator('[data-screen="analyze"] :is([data-fix="tiny"], [data-fix="speed"]):has([data-action="show-on-toolpath"])').first();
  await expect(dense).toBeVisible({ timeout: 30_000 });
  // The preview may still be reloading after the phone layout: click until Job opens.
  await expect(async () => {
    await page.locator('[data-region="rail"] [data-view="analyze"]').click();
    await dense.locator('[data-action="show-on-toolpath"]').click();
    await expect(page.locator('[data-screen="job"]')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS as string}/local-job-toolpath-1280x720.png` });
  await page.locator('[data-action="ui-level-simple"]').click();
});

test('blocked source line 96 has plain repairs and links from Analyze and Notes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const lines = ['G21 G90 G17', 'G0 X0 Y0 Z5', ...Array.from({ length: 93 }, (_, i) => `G1 X${i % 10} F600`), 'M30', 'G0 X20', 'M30'];
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'joined.nc', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) });
  const view = await analyze(page);
  await expect(view.locator('[data-analyze="blocked"]')).toContainText('Program end (M2/M30) at line 96');
  await expect(view.locator('[data-analyze="no-fixes"]')).toHaveCount(0);
  await expect(view).toContainText('Fix the blocked lines first (1).');
  await page.screenshot({ path: testInfo.outputPath('blocked-analyze.png') });
  await view.getByRole('button', { name: 'Show in G-code' }).first().click();
  const jobView = page.locator('[data-screen="job"]');
  await expect(jobView).toBeVisible();
  await expect(jobView.locator('[data-line="96"]')).toBeInViewport({ ratio: 1 });
  await expect(jobView.locator('[data-gcode="finding-detail"]')).toContainText('Fix: remove the extra M2/M30');
  const explanation = jobView.getByRole('region', { name: 'Finding for line 96', exact: true });
  await jobView.locator('[data-gcode="follow"]').focus();
  await page.keyboard.press('Tab');
  await expect(explanation).toBeFocused();
  expect(await explanation.evaluate(el => {
    const css = getComputedStyle(el);
    return { style: css.outlineStyle, width: css.outlineWidth, offset: css.outlineOffset };
  })).toEqual({ style: 'solid', width: '2px', offset: '-2px' });
  await page.keyboard.press('Tab');
  await expect(jobView.locator('[data-preview="list"]')).toBeFocused();

  await page.screenshot({ path: testInfo.outputPath('blocked-line-96.png') });
  await jobView.getByRole('tab', { name: /^Notes/ }).click();
  await expect(jobView.locator('[data-note="blocked-file"]')).toContainText('This file has 1 line that stops it from running (line 96).');
  await page.screenshot({ path: testInfo.outputPath('blocked-notes.png') });
  await jobView.locator('[data-note="blocked-file"]').getByRole('button', { name: 'Show it' }).click();
  await expect(jobView.locator('[data-line="96"]')).toBeInViewport({ ratio: 1 });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(t => { document.documentElement.dataset['theme'] = t; }, theme);
    const notice = jobView.locator('[data-notice^="tool-note/"]');
    await expect(notice).toBeVisible();
    const close = await notice.locator('button.dismiss').boundingBox();
    const body = await notice.locator('.dismissable-body').boundingBox();
    expect(close!.y).toBeLessThan(body!.y + 10);
    expect(close!.x).toBeGreaterThan(body!.x + body!.width - 30);
    await page.screenshot({ path: testInfo.outputPath(`blocked-line-note-${theme}.png`) });
    await analyze(page);
    await page.screenshot({ path: testInfo.outputPath(`blocked-analyze-${theme}.png`) });
    await view.getByRole('button', { name: 'Show in G-code' }).first().click();
    await jobView.getByRole('tab', { name: /^Notes/ }).click();
    await page.screenshot({ path: testInfo.outputPath(`blocked-notes-${theme}.png`) });
    await jobView.locator('[data-note="blocked-file"]').getByRole('button', { name: 'Show it' }).click();
  }
});
