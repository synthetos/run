/**
 * T-S137 (E). The travel check at the job card (OD-24, owner 2026-11-08: "Block when homed, warn when not"): the
 * simulated board is not homed by a cycle, so a file past its X travel (0..150 mm) is asked about at Start, as a
 * modal with a plain title, the registered C41 under Details, Start anyway and Cancel (owner, 2026-11-09). Not homed
 * as well, C40 and C36 are one answer, C41.
 * With TRAVEL_SHOTS set to a directory, the start check is captured in Simple and Advanced at 1280x720 and 390x844.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { connect, open } from './jobFlow.ts';

const SHOTS = process.env['TRAVEL_SHOTS'];

async function shots(page: Page): Promise<void> {
  if (SHOTS === undefined) return;
  for (const level of ['simple', 'advanced'] as const) {
    await page.locator(`[data-action="ui-level-${level}"]`).click();
    for (const [w, h] of [[1280, 720], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      await page.locator('[data-safety~="C40"], [data-safety~="C41"]').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: `${SHOTS}/travel-${level}-${w}x${h}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-action="ui-level-advanced"]').click();
}

test('a file past the X travel on a board not homed: Start asks it as one question (C41, which also answers C36), with Start anyway and Cancel', async ({ page }) => {
  await connect(page);
  await open(page, 'G21 G90\nG1 X200 F600\nM30\n', 'past-x.nc');
  await expect(page.locator('[data-ready-item="travel"]')).toHaveAttribute('data-mark', 'needs');
  await expect(page.locator('[data-ready-summary="travel"]')).toHaveText('Line 2 goes past the X limit. Start asks.');
  // The one tick leaves out C36: the travel answer covers it (owner, 2026-11-08: one box when both apply).
  await expect(page.locator('[data-job="confirm-start"]')).not.toContainText('every axis');
  await page.locator('[data-job="confirm-start-box"]').check();
  await page.locator('[data-action="start-job"]').click();
  const modal = page.locator('[data-safety="C41"]');
  await expect(modal.locator('.choice-title')).toHaveText('This job goes past the X limit.');
  await expect(modal).toContainText('Line 2 moves X to 200 mm. X stops at 150 mm. X isn’t homed, so its position may be off.');
  // The registered C41 stays one click away, under Details.
  await expect(modal.locator('[data-full="C41"]')).toHaveText("X isn't homed, so Run can't check its travel and soft limits may not protect it. Line 2: X would reach 200 mm, past its 150 mm limit. I've checked where every axis is and that every move fits.");
  await shots(page);
  await modal.locator('[data-action="travel-start"]').click();
  await expect(page.locator('[data-safety="C30"]')).toBeVisible();
  await page.locator('[data-safety="C30"] [data-action="motion-cancel"]').click();
});
