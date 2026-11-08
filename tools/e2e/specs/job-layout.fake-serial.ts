/**
 * The Job view's layout (first-time walk 2026-11-08: B3, B4, C18, P4), in the built app (fake-serial TEST build).
 *
 * - 1280 × 720, Simple and Advanced: the page never scrolls, the job card is never under the strip, the 3D view
 *   keeps at least 270 px, and what sits over the drawing (the key's notes, the key line, the live readout) is one
 *   stack in which nothing overlaps anything else or the view's toolbar;
 * - the key hides and shows (remembered across a reload), and when hidden a count of its notes stays in view;
 * - Expand gives the drawing the Job area and Shrink puts it back;
 * - 390 × 844: the parts of the Job view stack in one scrolling column and none overlaps another; all five steps
 *   are wholly in view; the key and the readout sit under the drawing, not on it.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { PORT, session } from './jobFlow.ts';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

async function rect(page: Page, selector: string): Promise<Rect | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0 ? null : { x: r.left, y: r.top, w: r.width, h: r.height };
  }, selector);
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
}

async function openSample(page: Page, width: number, height: number): Promise<Worker> {
  await page.setViewportSize({ width, height });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  await page.locator('[data-sample="mounting-plate"], [data-sample]').first().click();
  await expect(page.locator('[data-preview="drawing"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-preview="marker-readout"]')).toBeVisible({ timeout: 10_000 });
  return worker;
}

for (const level of ['simple', 'advanced'] as const) {
  test(`1280 × 720 (${level}): no page scroll, the 3D view keeps its height, the overlay never overlaps`, async ({ page }) => {
    await openSample(page, 1280, 720);
    await page.locator(`[data-action="ui-level-${level}"]`).click();
    await page.waitForTimeout(200);
    const doc = await page.evaluate(() => ({ scroll: document.scrollingElement?.scrollHeight ?? 0, inner: innerHeight, top: document.scrollingElement?.scrollTop ?? 0 }));
    expect(doc.scroll, 'the page does not scroll').toBeLessThanOrEqual(doc.inner);
    const strip = await rect(page, '[data-region="machine-strip"]');
    const card = await rect(page, '.job-view .job-card');
    expect(card?.y ?? 0, 'the job card starts below the strip').toBeGreaterThanOrEqual((strip?.y ?? 0) + (strip?.h ?? 0) - 0.5);
    const canvas = await rect(page, '[data-preview="drawing"]');
    expect(canvas?.h ?? 0, 'the 3D view keeps a usable height').toBeGreaterThanOrEqual(270);
    const top = await rect(page, '.job-view .viewer-top');
    const pieces = (await Promise.all(['[data-scene="notes"]', '.scene-key-line', '[data-preview="marker-readout"]', '.viewer-overlay-bar'].map(async (s) => [s, await rect(page, s)] as const))).filter((p): p is readonly [string, Rect] => p[1] !== null);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (const [s, r] of pieces) {
      expect(overlap(r, top as Rect), `${s} is clear of the toolbar`).toBe(false);
      expect(r.x + r.w, `${s} stays inside the drawing`).toBeLessThanOrEqual((canvas?.x ?? 0) + (canvas?.w ?? 0) + 0.5);
      for (const [t, q] of pieces) if (s < t) expect(overlap(r, q), `${s} and ${t} do not overlap`).toBe(false);
    }
  });
}

test('the key hides and shows, remembered across a reload; hidden, its notes are still counted in view', async ({ page }) => {
  await openSample(page, 1280, 720);
  await expect(page.locator('[data-scene="notes"]')).toBeVisible();
  await page.locator('[data-action="key-toggle"]').click();
  await expect(page.locator('[data-scene="notes"]')).toHaveCount(0);
  await expect(page.locator('.scene-key-line')).toHaveCount(0);
  await expect(page.locator('[data-preview="key-notes-count"]')).toHaveText(/^\d+ notes?$/);
  await expect(page.locator('[data-preview="marker-readout"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  // The job's file comes back with the page; open the sample again only if it did not.
  if ((await page.locator('[data-sample]').count()) > 0) await page.locator('[data-sample]').first().click();
  await expect(page.locator('[data-action="key-toggle"]')).toHaveText('Show key', { timeout: 15_000 });
  await expect(page.locator('[data-scene="notes"]')).toHaveCount(0);
  await page.locator('[data-action="key-toggle"]').click();
  await expect(page.locator('.scene-key-line')).toBeVisible();
  await expect(page.locator('[data-action="key-toggle"]')).toHaveText('Hide key');
});

test('Expand gives the 3D view the Job area; Shrink puts the panels back', async ({ page }) => {
  await openSample(page, 1280, 720);
  const before = (await rect(page, '[data-preview="drawing"]')) as Rect;
  await page.locator('[data-action="preview-expand"]').click();
  await expect(page.locator('.job-work-panel')).toBeHidden();
  await expect(page.locator('.job-view .job-card')).toBeHidden();
  await expect.poll(async () => (await rect(page, '[data-preview="drawing"]'))?.h ?? 0).toBeGreaterThan(before.h + 150);
  await expect(page.locator('[data-region="machine-strip"] [data-action="stop-job"]')).toBeVisible();
  // Expanded, the drawing stays below the strip and its stop controls.
  expect(overlap((await rect(page, '[data-preview="drawing"]')) as Rect, (await rect(page, '[data-region="machine-strip"]')) as Rect)).toBe(false);
  await page.locator('[data-action="preview-expand"]').click();
  await expect(page.locator('.job-work-panel')).toBeVisible();
  await expect.poll(async () => (await rect(page, '[data-preview="drawing"]'))?.h ?? 0).toBeLessThan(before.h + 5);
});

for (const level of ['simple', 'advanced'] as const) {
  test(`390 × 844 (${level}): the Job view stacks with no overlap, every step in view, the key under the drawing`, async ({ page }) => {
    await openSample(page, 390, 844);
    await page.locator(`[data-action="ui-level-${level}"]`).click();
    await page.waitForTimeout(200);
    const parts = ['.job-view .job-card', '.job-view .job-step-bar', '.job-view .canvas-column', '.job-view .job-work-panel', '.job-view > .run-inspector'];
    const boxes = (await Promise.all(parts.map((s) => rect(page, s)))) as (Rect | null)[];
    for (let i = 0; i < parts.length; i++) {
      expect(boxes[i], `${parts[i] as string} is shown`).not.toBeNull();
      for (let j = i + 1; j < parts.length; j++) expect(overlap(boxes[i] as Rect, boxes[j] as Rect), `${parts[i] as string} and ${parts[j] as string} do not overlap`).toBe(false);
    }
    const bar = (await rect(page, '.job-view .job-step-bar')) as Rect;
    const steps = await page.locator('.job-view .job-step-bar button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, w: r.width }; }));
    expect(steps).toHaveLength(5);
    for (const s of steps) {
      expect(s.x).toBeGreaterThanOrEqual(bar.x - 0.5);
      expect(s.x + s.w).toBeLessThanOrEqual(bar.x + bar.w + 0.5);
    }
    const drawing = (await rect(page, '[data-preview="drawing"]')) as Rect;
    for (const s of ['[data-scene="notes"]', '.scene-key-line', '[data-preview="marker-readout"]']) {
      const r = await rect(page, s);
      if (r !== null) expect(overlap(r, drawing), `${s} is under the drawing, not on it`).toBe(false);
    }
  });
}
