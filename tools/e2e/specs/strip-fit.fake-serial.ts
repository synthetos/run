/**
 * The machine strip never clips Pause or Stop job (SAFETY §4.1; first-time walk 2026-11-08, S1), in the built app
 * (fake-serial TEST build). While a job runs with the spindle on, the Spindle readout is at its longest
 * ("On · CW · 16 000 rpm commanded"); at every width from 1024 px up, and on a phone, both stop buttons are
 * wholly inside the window, at their full size, and nothing in the strip covers them. The readouts give way
 * instead (they shrink and end in an ellipsis, with the whole value as a title).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { connect, open, phase, session, start, zigzag } from './jobFlow.ts';

const STOP = '[data-region="machine-strip"] [data-action="stop-job"]';
const PAUSE = '[data-region="machine-strip"] [data-safety="W2"]';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The button's box, and whether its centre and its four inner corners hit the button itself (nothing covers it). */
async function measure(page: Page, selector: string): Promise<{ box: Box; uncovered: boolean }> {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const points: [number, number][] = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 2, r.top + 2],
      [r.right - 2, r.top + 2],
      [r.left + 2, r.bottom - 2],
      [r.right - 2, r.bottom - 2],
    ];
    const uncovered = points.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === el || el.contains(hit));
    });
    return { box: { x: r.left, y: r.top, width: r.width, height: r.height }, uncovered };
  });
}

async function expectStopsWhole(page: Page, width: number): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  for (const selector of [PAUSE, STOP]) {
    const { box, uncovered } = await measure(page, selector);
    expect(box.x, `${selector} starts inside the window at ${width} px`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${selector} ends inside the window at ${width} px`).toBeLessThanOrEqual((viewport?.width ?? 0) + 0.5);
    expect(box.height, `${selector} keeps its height at ${width} px`).toBeGreaterThanOrEqual(42);
    expect(uncovered, `nothing covers ${selector} at ${width} px`).toBe(true);
    if (width > 650) expect(box.width, `${selector} keeps its width at ${width} px`).toBeGreaterThanOrEqual(118);
  }
}

test('while a job runs with the spindle on, Pause and Stop job are whole and uncovered at 1024, 1280, 1440 and 390 px', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, zigzag(120, [], ['M3 S16000', 'M8']).replace('M30', 'M5\nM9\nM30'));
  await start(page);
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('running');
  // The board reports the spindle on: the Spindle readout is at its longest.
  await expect(page.locator('[data-region="machine-strip"] [data-readout="Spindle"]')).toContainText('rpm', { timeout: 10_000 });
  for (const level of ['advanced', 'simple'] as const) {
    await page.locator(`[data-action="ui-level-${level}"]`).click();
    for (const [width, height] of [[1024, 720], [1280, 720], [1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      await expectStopsWhole(page, width);
      // Coolant is on: its readout shows at every width (owner, 2026-11-08), and still never pushes the stops out.
      await expect(page.locator('[data-region="machine-strip"] [data-readout="Coolant"]'), `Coolant at ${String(width)} px`).toBeVisible();
    }
  }
  // A shortened readout still says all of it, as its title.
  await page.setViewportSize({ width: 1024, height: 720 });
  await expect(page.locator('[data-region="machine-strip"] [data-readout="Spindle"]')).toHaveAttribute('title', /rpm/);
  expect((await session(worker)).job?.phase).toBe('running');
});
