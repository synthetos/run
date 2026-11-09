/**
 * T-S137 (E). The travel check at the job card (OD-24, owner 2026-11-08: "Block when homed, warn when not"): the
 * simulated board is not homed by a cycle, so a file past its X travel (0..150 mm) asks C40 before Start, and Start
 * stays unavailable until it is ticked. With TRAVEL_SHOTS set to a directory, the start check is captured in Simple
 * and Advanced at 1280x720 and 390x844.
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
      await page.locator('[data-safety~="C40"]').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: `${SHOTS}/travel-${level}-${w}x${h}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-action="ui-level-advanced"]').click();
}

test('a file past the X travel on a board not homed by a cycle asks C40 before Start', async ({ page }) => {
  await connect(page);
  await open(page, 'G21 G90\nG1 X200 F600\nM30\n', 'past-x.nc');
  const c40 = page.locator('[data-safety~="C40"]');
  await expect(c40).toContainText("Run cannot check this job against the machine's travel: line 2: X would reach machine 200 mm, beyond its travel limit of 150 mm, and the X position was not set by a homing cycle in this connection. Start only if you have checked that every move fits the machine.");
  for (const box of ['confirm-unhomed', 'confirm-zero', 'confirm-attended']) {
    const el = page.locator(`[data-job="${box}"]`);
    if ((await el.count()) > 0) await el.check();
  }
  // Not homed as well: C40 and C36 are one box (owner, 2026-11-08), so one blocker and no separate C36.
  await expect(page.locator('[data-safety~="C40"]')).toHaveAttribute('data-safety', 'C40 C36');
  await expect(page.locator('[data-safety~="C40"]')).toContainText('The machine is not homed, so soft limits may not protect it.');
  await expect(page.locator('[data-safety="C36"]')).toHaveCount(0);
  await expect(page.locator('[data-job="blockers"] [data-blocker]')).toHaveAttribute('data-blocker', 'travel');
  await expect(page.locator('[data-action="start-job"]')).toBeDisabled();
  await shots(page);
  await page.locator('[data-job="confirm-travel"]').check();
  await expect(page.locator('[data-job="blockers"]')).toHaveCount(0);
  await expect(page.locator('[data-action="start-job"]')).toBeEnabled();
});
