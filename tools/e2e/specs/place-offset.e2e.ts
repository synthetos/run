/**
 * Place job's offset (owner, 2026-11-09): after picking a corner, "Move in from the corner" X and Y move the job
 * inward; the margins to each stock edge and (in Advanced) the planned zero follow at once, and the offset comes back
 * with the job after a reload.
 */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

// T1 (3.175 mm) cuts a 20 × 10 mm rectangle from the zero.
const FILE = ['G21 G90', 'T1 M6', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F300', 'G1 X20', 'G1 Y10', 'G1 X0', 'G1 Y0', 'G0 Z5', 'M30'].join('\n');

test('an offset from the corner moves the job in: the margins and the planned zero follow, and it is kept', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('[data-region="preview"] [data-preview="file"]').setInputFiles({ name: 'rect.nc', mimeType: 'text/plain', buffer: Buffer.from(FILE) });
  await expect(page.locator('[data-preview="file-name"]')).toHaveText('rect.nc');
  await page.locator('[data-job-step="place"]').click();
  const place = page.locator('[data-job-panel="place"]');
  await place.getByRole('radio', { name: 'front left', exact: true }).click();
  const offset = place.locator('[data-setup="place-offset"]');
  await expect(offset).toContainText('Move in from the corner');
  const margins = place.locator('[data-place="margins"]');
  // At the corner the cut's edge, less the 1.6 mm radius, runs past the stock.
  await expect(margins).toHaveText('Left −1.6 mm · Front −1.6 mm · Right 158.4 mm · Back 108.4 mm');
  await expect(place.locator('[data-place="past-edge"]')).toHaveText('The cut goes 1.6 mm past the left edge. The cut goes 1.6 mm past the front edge.');
  await expect(place.locator('[data-place="margins-tool"]')).toHaveText('Includes the tool’s 1.6 mm radius.');
  await expect(place.locator('[data-job="planned-zero"]')).toHaveCount(0);
  await page.locator('[data-action="ui-level-advanced"]').click();
  const zeroBefore = await place.locator('[data-job="planned-zero"]').innerText();
  const x = offset.getByLabel('X');
  await x.fill('5');
  await x.press('Tab');
  const y = offset.getByLabel('Y');
  await y.fill('5');
  await y.press('Tab');
  await expect(margins).toHaveText('Left 3.4 mm · Front 3.4 mm · Right 153.4 mm · Back 103.4 mm');
  await expect(place.locator('[data-place="past-edge"]')).toHaveCount(0);
  const zeroAfter = await place.locator('[data-job="planned-zero"]').innerText();
  const xOf = (t: string): number => Number(/X (-?[\d.]+)/.exec(t)?.[1]);
  expect(xOf(zeroAfter) - xOf(zeroBefore)).toBeCloseTo(5, 2);
  // Kept with the job.
  await page.reload();
  await ready(page);
  await page.locator('[data-job-step="place"]').click();
  await expect(page.locator('[data-job-panel="place"] [data-setup="place-offset"]').getByLabel('X')).toHaveValue('5');
  await expect(page.locator('[data-job-panel="place"] [data-job="planned-zero"]')).toHaveText(zeroAfter);
  // The centre moves in machine directions.
  await page.locator('[data-job-panel="place"]').getByRole('radio', { name: 'center', exact: true }).click();
  await expect(page.locator('[data-job-panel="place"] [data-setup="place-offset"]')).toContainText('Move from centre');
  await expect(page.locator('[data-job-panel="place"] [data-place="clamps"]')).toHaveText('Clamp clearance is not checked. Look before you start.');
  await expect(page.locator('[data-job-panel="place"] [data-place="travel"]')).toHaveText('Travel is checked when a machine is connected and homed.');
});
