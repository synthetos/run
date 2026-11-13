import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';
import { resolve } from 'node:path';

const screens = resolve('../../logs');
for (const theme of ['light', 'dark'] as const) {
  test(`Run polish and top-layer help in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await ready(page);
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await expect(page.locator('[data-sample]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Step 3 opens your file.' })).toBeVisible();
    await page.screenshot({ path: `${screens}/polish-machine-${theme}.png` });
    const help = page.getByRole('button', { name: 'About spindle and coolant readouts' });
    const sameHeight = async (): Promise<void> => {
      const spindle = await page.getByRole('group', { name: 'Spindle direction', exact: true }).getByRole('button').first().boundingBox();
      const coolant = await page.getByRole('group', { name: 'Coolant', exact: true }).getByRole('button').first().boundingBox();
      expect(coolant?.height).toBe(spindle?.height);
    };
    await sameHeight();
    await help.hover();
    await expect(page.locator('#spindle-help')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.locator('#spindle-help')).not.toBeVisible();
    await help.click();
    const popover = page.locator('#spindle-help');
    await expect(popover).toBeVisible();
    const checkBox = async (): Promise<void> => {
      // Resize events settle on the next browser frame after setViewportSize.
      await expect.poll(async () => popover.evaluate(el => {
        const b = el.getBoundingClientRect();
        return { inside: b.x >= 0 && b.y >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
          topmost: el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) };
      })).toEqual({ inside: true, topmost: true });
    };
    await checkBox();
    await page.screenshot({ path: `${screens}/polish-help-compact-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(popover).not.toBeVisible();
    await page.getByRole('button', { name: 'Step 3 opens your file.' }).click();
    await expect(page.locator('[data-job-step="place"]')).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('[data-sample]')).toHaveCount(2);
    await page.screenshot({ path: `${screens}/polish-file-${theme}.png` });
    await page.locator('[data-action="ui-level-advanced"]').click();
    const detail = page.locator('[data-action="preview-detail"]');
    await expect(detail).toHaveText('Fine');
    await detail.focus();
    await expect(page.locator('#preview-detail-help')).toBeVisible();
    await expect(page.locator('#preview-detail-help')).toContainText('Coarse (faster on big files)');
    await detail.click();
    await expect(detail).toHaveText('Coarse');
    await expect(detail).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-tab="spindle"]').click();
    await sameHeight();
    await help.click();
    await checkBox();
    await page.setViewportSize({ width: 1100, height: 650 });
    await checkBox();
    await page.setViewportSize({ width: 390, height: 844 });
    await checkBox();
    await page.screenshot({ path: `${screens}/polish-help-mobile-${theme}.png` });
    await page.setViewportSize({ width: 1280, height: 720 });
    await checkBox();
    await page.screenshot({ path: `${screens}/polish-help-full-${theme}.png` });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `${screens}/polish-detail-${theme}.png` });
    // The owner measured the pattern, not the offset or the bed dimensions.
    await page.locator('[data-region="rail"] [data-view="library"]').click();
    await page.locator('[data-tab="catalogue"]').click();
    await page.locator('[data-template="xcarve"] [data-action="copy-machine"]').click();
    await page.locator('[data-bed="hole-grid"] summary').click();
    await expect(page.locator('[data-bed="hole-grid"]')).toContainText('Not measured');
    await page.locator('[data-action="bed-grid-save"]').click();
    await expect(page.locator('[data-bed="hole-grid"] [role="status"]')).toContainText('Saved 121 holes');
    // Give the full form room beneath the Library's sticky heading for the review screenshot.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.locator('[data-bed="hole-grid"] summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${screens}/polish-grid-${theme}.png` });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('[data-action="job-use-machine"]').click();
    await page.locator('[data-job-step="machine"]').click();
    const bed = page.locator('[data-setup="bed"]');
    await expect(bed.locator('circle')).toHaveCount(121);
    await bed.locator('svg').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${screens}/polish-bed-${theme}.png` });
  });
}
