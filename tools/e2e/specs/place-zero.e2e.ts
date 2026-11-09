/**
 * Place job and the file's own zero (owner, 2026-11-09, OD-28: CAM owns the toolpath and the file's zero; run
 * owns where that zero goes on the stock). A centre-zero file (like the docklight housing) is pre-selected at the
 * centre with a note; picking a corner instead hangs the toolpath off the stock and offers "Use centre", which
 * never happens by itself; the zero depth moves the planned zero down; a corner file on the same job is
 * pre-selected at its corner; an unclear file says so and keeps the pick. "Use the machine's work zero" is not
 * offered without a board.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

const rect = (x0: number, x1: number, y0: number, y1: number, header: readonly string[] = []): string =>
  [...header, 'G21 G90', 'T1 M6', 'G0 Z5', `G0 X${x0} Y${y0}`, 'G1 Z-2 F300', `G1 X${x1}`, `G1 Y${y1}`, `G1 X${x0}`, `G1 Y${y0}`, 'G0 Z5', 'M30'].join('\n');
export const CENTRE_FILE = rect(-70, 70, -40, 40, ['(housing_top)', '(T1 D=3.175 FLAT)']);
export const CORNER_FILE = rect(0, 100, 0, 60);
const UNCLEAR_FILE = rect(30, 150, 20, 80);

async function openFile(page: Page, name: string, text: string): Promise<void> {
  await page.locator('[data-region="preview"] [data-preview="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('[data-preview="file-name"]')).toHaveText(name);
}

const point = (place: Locator, name: string): Locator => place.getByRole('radio', { name, exact: true });
const zOf = (t: string): number => Number(/Z (-?[\d.]+)/.exec(t)?.[1]);

test('a centre-zero file is placed at the centre, a wrong corner offers "Use centre", and the depth moves zero down', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await openFile(page, 'housing_top.nc', CENTRE_FILE);
  await page.locator('[data-job-step="place"]').click();
  const place = page.locator('[data-job-panel="place"]');
  await expect(place).toContainText('Your CAM program chose where zero is. Pick the same point on your stock.');
  await expect(place.locator('[data-place="file-zero"]')).toHaveText('Zero in this file looks like the centre of the part, at the stock top (X −70…+70, Y −40…+40).');
  await expect(point(place, 'center')).toHaveAttribute('aria-checked', 'true');
  await expect(place.locator('[data-place="mismatch"]')).toHaveCount(0);
  // No board: the machine's work zero is not offered.
  await expect(place.locator('[data-place="zero-source"]')).toHaveCount(0);
  // The user picks the front-left corner: the toolpath hangs off, and run offers the file's zero without taking it.
  await point(place, 'front left').click();
  const mismatch = place.locator('[data-place="mismatch"]');
  await expect(mismatch).toContainText('The toolpath hangs off the stock. Zero in this file looks like the centre.');
  await expect(point(place, 'front left')).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await ready(page);
  await page.locator('[data-job-step="place"]').click();
  await expect(point(place, 'front left')).toHaveAttribute('aria-checked', 'true');
  await mismatch.getByRole('button', { name: 'Use centre' }).click();
  await expect(point(place, 'center')).toHaveAttribute('aria-checked', 'true');
  await expect(mismatch).toHaveCount(0);
  // The zero depth: CAM set to the model top inside a thicker blank.
  await page.locator('[data-action="ui-level-advanced"]').click();
  const planned = place.locator('[data-job="planned-zero"]');
  const before = zOf(await planned.innerText());
  const depth = place.locator('[data-place="z-offset"]');
  await expect(depth).toContainText('Zero is');
  await expect(depth).toContainText('below the stock top');
  await depth.getByRole('spinbutton').fill('2');
  await depth.getByRole('spinbutton').press('Tab');
  await expect.poll(async () => zOf(await planned.innerText())).toBeCloseTo(before - 2, 2);
  await page.reload();
  await ready(page);
  await page.locator('[data-job-step="place"]').click();
  await expect(place.locator('[data-place="z-offset"]').getByRole('spinbutton')).toHaveValue('2');
  await place.getByRole('button', { name: 'Stock bottom' }).click();
  await expect(place.locator('[data-place="z-offset"]')).toContainText('above the stock bottom');
});

test('a corner file on the same job is placed at its corner; an unclear file says so and keeps the pick', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await openFile(page, 'housing_top.nc', CENTRE_FILE);
  await page.locator('[data-job-step="place"]').click();
  const place = page.locator('[data-job-panel="place"]');
  await expect(point(place, 'center')).toHaveAttribute('aria-checked', 'true');
  await openFile(page, 'plate.nc', CORNER_FILE);
  await expect(place.locator('[data-place="file-zero"]')).toHaveText('Zero in this file looks like the front-left corner of the part, at the stock top (X 0…+100, Y 0…+60).');
  await expect(point(place, 'front left')).toHaveAttribute('aria-checked', 'true');
  // The user's own pick for this file is kept: an unclear file leaves it, and so does opening this file again.
  await point(place, 'back right').click();
  await expect(place.locator('[data-place="mismatch"]')).toContainText('Use front-left corner');
  await openFile(page, 'odd.nc', UNCLEAR_FILE);
  const note = place.locator('[data-place="file-zero"]');
  await expect(note).toHaveAttribute('data-confidence', 'unclear');
  await expect(note).toHaveText('Zero in this file is not clear (X +30…+150, Y +20…+80). It is not at a corner or the centre. Keep your pick.');
  await expect(point(place, 'back right')).toHaveAttribute('aria-checked', 'true');
  await openFile(page, 'plate.nc', CORNER_FILE);
  await expect(note).toHaveAttribute('data-confidence', 'clear');
  await expect(point(place, 'back right')).toHaveAttribute('aria-checked', 'true');
});
