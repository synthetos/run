/**
 * The Job view's layout (first-time walk 2026-11-08: B3, B4, C18, P4), in the built app (fake-serial TEST build).
 *
 * - 1280 × 720 and 1440 × 900, Simple and Advanced: the page never scrolls, the job card is never under the strip, the 3D view
 *   keeps at least 270 px, and what sits over the drawing (the key's notes, the key line, the live readout) is one
 *   stack in which nothing overlaps anything else or the view's toolbar;
 * - one small bar over the drawing (settings menu, Not homed chip, notes pill) and the legend; no readout or Hide key;
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
  return (await rects(page, [selector]))[0] ?? null;
}

/** Every selector's box from one frame, so a reflow between two reads can never pair boxes from different layouts. */
async function rects(page: Page, selectors: readonly string[]): Promise<(Rect | null)[]> {
  return page.evaluate((list) => list.map((s) => {
    const el = document.querySelector(s);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    // What shows: inside the key's scrolling part, only the part in view.
    const clip = el.closest('.viewer-overlay-scroll')?.getBoundingClientRect();
    const top = clip === undefined ? r.top : Math.max(r.top, clip.top);
    const bottom = clip === undefined ? r.bottom : Math.min(r.bottom, clip.bottom);
    return bottom <= top ? null : { x: r.left, y: top, w: r.width, h: bottom - top };
  }), selectors);
}

/**
 * Waits until what sits over the drawing has settled: with the key open, the stock carve is done (its note joins the
 * key line when it finishes, and the stack reflows), and the overlay's pieces keep the same boxes over two frames.
 */
async function overlaySettled(page: Page): Promise<void> {
  if (await page.locator('[data-preview="overlay"] [data-scene="carve"]').count() > 0) {
    await expect(page.locator('[data-preview="overlay"] [data-scene="carve"]')).toHaveAttribute('data-carve-done', 'true', { timeout: 30_000 });
  }
  await page.waitForFunction(() => {
    const w = window as unknown as { __overlayBoxes?: string; __overlaySame?: number };
    const boxes = ['[data-preview="overlay"]', '.viewer-overlay-bar [data-action="open-notes"]', '.scene-key-line', '.viewer-overlay-bar', '[data-preview="drawing"]']
      .map((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r === undefined ? '-' : [r.left, r.top, r.width, r.height].map((n) => n.toFixed(1)).join(','); })
      .join('|');
    w.__overlaySame = boxes === w.__overlayBoxes ? (w.__overlaySame ?? 0) + 1 : 0;
    w.__overlayBoxes = boxes;
    return w.__overlaySame >= 2;
  }, undefined, { polling: 'raf', timeout: 15_000 });
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
  await expect(page.locator('.viewer-overlay-bar')).toBeVisible({ timeout: 10_000 });
  return worker;
}

for (const [level, width, height] of [['simple', 1280, 720], ['advanced', 1280, 720], ['simple', 1440, 900], ['advanced', 1440, 900]] as const) {
  test(`${String(width)} × ${String(height)} (${level}): no page scroll, the 3D view keeps its height, the overlay never overlaps`, async ({ page }) => {
    await openSample(page, width, height);
    await page.locator(`[data-action="ui-level-${level}"]`).click();
    await overlaySettled(page);
    const doc = await page.evaluate(() => ({ scroll: document.scrollingElement?.scrollHeight ?? 0, inner: innerHeight, top: document.scrollingElement?.scrollTop ?? 0 }));
    expect(doc.scroll, 'the page does not scroll').toBeLessThanOrEqual(doc.inner);
    const overlaid = ['.scene-key-line', '.viewer-overlay-bar'];
    const [strip, card, canvas, top, ...over] = await rects(page, ['[data-region="machine-strip"]', '.job-view .job-card', '[data-preview="drawing"]', '.job-view .viewer-top', ...overlaid]);
    expect(card?.y ?? 0, 'the job card starts below the strip').toBeGreaterThanOrEqual((strip?.y ?? 0) + (strip?.h ?? 0) - 0.5);
    expect(canvas?.h ?? 0, 'the 3D view keeps a usable height').toBeGreaterThanOrEqual(270);
    const pieces = overlaid.map((s, i) => [s, over[i] ?? null] as const).filter((p): p is readonly [string, Rect] => p[1] !== null);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    for (const [s, r] of pieces) {
      expect(overlap(r, top as Rect), `${s} is clear of the toolbar`).toBe(false);
      expect(r.x + r.w, `${s} stays inside the drawing`).toBeLessThanOrEqual((canvas?.x ?? 0) + (canvas?.w ?? 0) + 0.5);
      for (const [t, q] of pieces) if (s < t) expect(overlap(r, q), `${s} and ${t} do not overlap`).toBe(false);
    }
  });
}

test('the viewer carries one small bar and the legend; its notes are counted in view; the job comes back after a reload', async ({ page }) => {
  await openSample(page, 1280, 720);
  const pill = page.locator('.viewer-overlay-bar [data-action="open-notes"]');
  await expect(pill).toHaveText(/^\d+ notes?$/);
  await expect(page.locator('.viewer-overlay-bar [data-preview="position-chip"]')).toHaveText('Not homed');
  await expect(page.locator('[data-preview="marker-readout"], [data-action="key-toggle"]')).toHaveCount(0);
  await overlaySettled(page);
  // From the reload on, note whether a sample button is drawn once the page is ready: the job's file comes back
  // with the page, and until it has, the prompt says the file is opening rather than offering the samples for a
  // moment. (The prerendered page shows the samples until the stores load, before the page is ready.)
  await page.addInitScript(() => {
    const root = document.documentElement;
    const frame = (): void => {
      if (root.dataset['ready'] === 'true' && document.querySelector('[data-sample]') !== null) root.dataset['sampleSeen'] = 'true';
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-preview="drawing"]')).toBeVisible({ timeout: 15_000 });
  await expect(pill).toHaveText(/^\d+ notes?$/, { timeout: 15_000 });
  await expect(page.locator('[data-preview="reopening"]')).toHaveCount(0);
  await expect(page.locator('[data-sample]')).toHaveCount(0);
  expect(await page.locator('html').getAttribute('data-sample-seen'), 'no sample button flashes while the job reopens').toBeNull();
  await overlaySettled(page);
  await expect(page.locator('.scene-key-line')).toHaveCount(1);
});

test('Expand gives the 3D view the Job area; Shrink puts the panels back', async ({ page }) => {
  await openSample(page, 1280, 720);
  await overlaySettled(page);
  const before = (await rect(page, '[data-preview="drawing"]')) as Rect;
  await page.locator('[data-action="preview-expand"]').click();
  await expect(page.locator('.job-work-panel')).toBeHidden();
  await expect(page.locator('.job-view .job-card')).toBeHidden();
  await expect.poll(async () => (await rect(page, '[data-preview="drawing"]'))?.h ?? 0).toBeGreaterThan(before.h + 150);
  await expect(page.locator('[data-region="machine-strip"] [data-action="stop-job"]')).toBeVisible();
  // Expanded, the drawing stays below the strip and its stop controls.
  const [drawing, strip] = await rects(page, ['[data-preview="drawing"]', '[data-region="machine-strip"]']);
  expect(overlap(drawing as Rect, strip as Rect)).toBe(false);
  await page.locator('[data-action="preview-expand"]').click();
  await expect(page.locator('.job-work-panel')).toBeVisible();
  await expect.poll(async () => (await rect(page, '[data-preview="drawing"]'))?.h ?? 0).toBeLessThan(before.h + 5);
});

for (const level of ['simple', 'advanced'] as const) {
  test(`390 × 844 (${level}): the Job view stacks with no overlap, every step in view, the key under the drawing`, async ({ page }) => {
    await openSample(page, 390, 844);
    await page.locator(`[data-action="ui-level-${level}"]`).click();
    await overlaySettled(page);
    const parts = ['.job-view .job-card', '.job-view .job-step-bar', '.job-view .canvas-column', '.job-view .job-work-panel', '.job-view > .run-inspector'];
    const boxes = await rects(page, parts);
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
    const under = ['.viewer-overlay-bar [data-action="open-notes"]', '.scene-key-line'];
    const [drawing, ...below] = await rects(page, ['[data-preview="drawing"]', ...under]);
    under.forEach((s, i) => {
      const r = below[i] ?? null;
      if (r !== null) expect(overlap(r, drawing as Rect), `${s} is under the drawing, not on it`).toBe(false);
    });
  });
}
