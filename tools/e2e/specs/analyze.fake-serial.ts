/**
 * Analyze slice 1 (docs/design/ANALYZE.md): with no board, profile, material inputs or tool, an opened file already
 * shows what it does. Connecting adds the board's rapid speeds, labelled "Board settings". A newer file replaces the
 * older one's report. One operation card holds the plunge and the cut. A region opens Job at its line, by keyboard.
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

test('disconnected, no inputs: a useful summary, one operation with its regimes, regions linked to Job by keyboard', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await ready(page);
  // Disconnected: the file opens in the preview (no board check).
  await page.locator('[data-job-step="run"]').click();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'pocket.nc', mimeType: 'text/plain', buffer: Buffer.from(job()) });
  const view = await analyze(page);
  await expect(view.locator('[data-analyze="summary"]')).toBeVisible({ timeout: 15_000 });
  const summary = view.locator('[data-analyze="summary"]');
  await expect(summary.locator('[data-analyze="time"]')).toHaveText('Time not known yet');
  await expect(summary).toContainText('At programmed speeds. Acceleration not included.');
  await expect(summary.locator('[data-fact="feed-time"]')).toContainText('From the file');
  await expect(summary.locator('[data-fact="feed-mm"]')).not.toContainText('0 mm');
  await expect(summary.locator('[data-analyze="missing"]')).toContainText('Connect your machine to improve the time estimate.');
  await expect(view).not.toContainText('Unavailable');
  // One operation card, with the plunge and the cuts under it.
  const ops = view.locator('[data-advisor-operation]');
  await expect(ops).toHaveCount(1);
  await expect(ops.first().locator('h3')).toContainText('Pocket');
  await expect(ops.first().locator('[data-regime="plunge"]')).toHaveCount(1);
  await expect(ops.first().locator('[data-regime="cut"]')).toHaveCount(2);
  // Cutting advice asks one question at a time; the motion summary never waits for it.
  await expect(view.locator('[data-analyze="advice"] [data-advisor="question"]')).toHaveCount(2); // the machine question, and the spindle tool
  // The AI picker is not in Simple.
  await expect(view.locator('[data-action="advisor-engine"]')).toHaveCount(0);
  await contained(page);
  // Regions: the dense run and the slow pass, each a button. Keyboard: focus, Enter, and Job shows that line.
  const regions = view.locator('[data-action="show-region"]');
  await expect(regions).toHaveCount(2);
  const dense = view.locator('[data-region-kind="dense"]');
  await expect(dense).toContainText('The machine may not reach the feed here, and the stream may not keep up.');
  await expect(dense).not.toContainText(' 0 mm each');
  await expect(dense).toContainText('In your CAM, allow longer moves');
  await expect(dense).toContainText('Show in Job');
  const line = await dense.getAttribute('data-from-line');
  await dense.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="job"]')).toBeVisible();
  await expect(page.locator('[data-preview="scrub-line"]')).toHaveText(`file line ${line ?? ''}`);
  // Advanced: the histogram, the motion settings with sources, and the AI demonstration.
  await page.locator('[data-action="ui-level-advanced"]').click();
  const adv = await analyze(page);
  await expect(adv.locator('[data-analyze="histogram"]')).toBeVisible();
  await expect(adv.locator('[data-analyze="axis-settings"]')).toContainText('Not known');
  await expect(adv.locator('[data-action="advisor-engine"] option[value="mock-ai"]')).toHaveText('AI (demonstration only)');
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
  await expect(summary.locator('[data-fact="rapid-time"]')).toContainText('Board settings');
  await expect(summary.locator('[data-analyze="time"]')).toContainText('About ');
  await page.locator('[data-action="ui-level-advanced"]').click();
  await expect(view.locator('[data-analyze="axis-settings"]')).toContainText('Board settings');
  await page.locator('[data-action="ui-level-simple"]').click();
  await contained(page);
  await shots(page);
  // Visiting Analyze (and every level and theme) sent nothing new except the status polls the session always makes.
  const after = (await writes(worker)).slice(before).filter((w) => !/^\{"?[a-z0-9]+"?:null\}\n?$/.test(w) && w !== '\x05');
  expect(after).toEqual([]);
  // A newer file: its report replaces the older one's.
  await page.locator('[data-region="rail"] [data-view="job"]').click();
  await open(page, '(01 Facing)\nG21 G90\nS10000 M3\nG0 X0 Y0 Z2\nG1 Z0 F300\nG1 X50 F900\nM5\nM30\n', 'facing.nc');
  const fresh = await analyze(page);
  await expect(fresh.locator('[data-advisor-operation] h3')).toHaveText([/Facing/]);
  await expect(fresh.locator('[data-region-kind="dense"]')).toHaveCount(0);
});

// A local file (ANALYZE_FILE, never committed) captured in Simple at 1280x720 into ANALYZE_SHOTS.
const LOCAL_FILE = process.env['ANALYZE_FILE'];
test('a local file: Analyze in Simple at 1280x720', async ({ page }) => {
  test.skip(LOCAL_FILE === undefined || SHOTS === undefined, 'set ANALYZE_FILE and ANALYZE_SHOTS');
  test.setTimeout(120_000);
  const { readFileSync } = await import('node:fs');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await ready(page);
  await page.locator('[data-job-step="run"]').click();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'local.nc', mimeType: 'text/plain', buffer: readFileSync(LOCAL_FILE as string) });
  const view = await analyze(page);
  await expect(view.locator('[data-analyze="summary"]')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS as string}/local-simple-light-1280x720.png` });
  await page.locator('[data-action="ui-level-advanced"]').click();
  await page.screenshot({ path: `${SHOTS as string}/local-advanced-light-1280x720.png` });
  await page.locator('[data-action="ui-level-simple"]').click();
});
