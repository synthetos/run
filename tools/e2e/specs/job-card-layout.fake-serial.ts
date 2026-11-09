/**
 * The Run job card while a job runs (fake-serial TEST build), at the width of the Job panel (about 260 px), at
 * about 530 px, and as a wide strip (about 900 px): Pause and Stop job (and Resume when shown) sit fully inside the card and
 * never on top of a fact's label or value (SAFETY §4.1: always visible, easy to hit). Owner report 2026-11-07:
 * in the narrow panel the facts were crushed and the buttons drawn over them.
 *
 * With RUN_SCREENSHOTS_DIR set, the card and the panel are captured at each width.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { connect, open, phase, start, zigzag } from './jobFlow.ts';

const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (b === null) throw new Error('not rendered');
  return b;
}

function inside(inner: Box, outer: Box): boolean {
  const e = 0.5;
  return inner.x >= outer.x - e && inner.y >= outer.y - e && inner.x + inner.width <= outer.x + outer.width + e && inner.y + inner.height <= outer.y + outer.height + e;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Sets the Job panel's column to `width` px through the CSSOM (an inline <style> would meet the page's CSP). */
async function panelWidth(page: Page, width: number | null): Promise<void> {
  await page.locator('.job-grid').evaluate((el, w) => {
    (el as HTMLElement).style.gridTemplateColumns = w === null ? '' : `${w}px minmax(260px, 1fr)`;
  }, width);
}

async function checkCard(page: Page, label: string): Promise<number> {
  const card = page.locator('[data-job="status"]');
  await card.scrollIntoViewIfNeeded();
  const cardBox = await box(card);
  const controls = card.locator('.job-controls button');
  expect(await controls.count()).toBeGreaterThanOrEqual(2);
  await expect(card.locator('[data-machine-control="job-pause"]')).toBeVisible();
  await expect(card.locator('[data-machine-control="job-stop"]')).toBeVisible();
  const facts = await card.locator('.job-facts dt, .job-facts dd').all();
  expect(facts).toHaveLength(8);
  const factBoxes = await Promise.all(facts.map(box));
  for (const f of factBoxes) expect(inside(f, cardBox), `${label}: a fact runs out of the card`).toBe(true);
  for (const button of await controls.all()) {
    const b = await box(button);
    const name = await button.textContent();
    expect(inside(b, cardBox), `${label}: ${name} is not fully inside the card`).toBe(true);
    expect(b.height, `${label}: ${name} is too small to hit`).toBeGreaterThanOrEqual(36);
    expect(b.width, `${label}: ${name} is stretched`).toBeLessThan(160);
    for (const f of factBoxes) expect(intersects(b, f), `${label}: ${name} overlaps a fact`).toBe(false);
  }
  // Nothing in the card is clipped by the panel's scroll box.
  const scroller = await box(page.locator('.job-panel-scroll'));
  expect(cardBox.x).toBeGreaterThanOrEqual(scroller.x - 0.5);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(scroller.x + scroller.width + 0.5);
  if (SHOTS !== undefined) {
    await card.screenshot({ path: `${SHOTS}/job-card-${label}.png` });
    await page.locator('#job-work-panel').screenshot({ path: `${SHOTS}/job-panel-${label}.png` });
  }
  return cardBox.width;
}

test('Pause and Stop job never overlap the job facts and stay inside the card, at every width', async ({ page }) => {
  test.setTimeout(240_000); // The longer job (600 moves) and a slow shared CI runner need the room.
  const worker = await connect(page);
  // Long enough that a slow CI runner is still cutting when the wide layout is measured.
  await open(page, zigzag(600));
  await start(page);
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('running');
  await expect(page.locator('[data-job="status"] [data-machine-control="job-stop"]')).toBeVisible();
  // Long values, as on the bench: "file line 146 (141 of …)" and "about 2 min 44 s (estimate)".
  await expect(page.locator('[data-job="line"]')).toContainText('file line', { timeout: 10_000 });

  const narrow = await checkCard(page, 'narrow');
  expect(narrow).toBeGreaterThan(220);
  expect(narrow).toBeLessThan(300);

  await page.setViewportSize({ width: 1900, height: 1000 });
  await panelWidth(page, 560);
  await checkCard(page, 'medium');
  await panelWidth(page, 930);
  const wide = await checkCard(page, 'wide');
  expect(wide).toBeGreaterThan(850);
  expect(wide).toBeLessThan(960);
  // Wide is one strip: the controls share a row with the facts.
  const stop = await box(page.locator('[data-job="status"] [data-machine-control="job-stop"]'));
  const line = await box(page.locator('[data-job="line"]'));
  expect(intersects({ ...stop, x: line.x, width: line.width }, line)).toBe(true);

  await panelWidth(page, null);
});
