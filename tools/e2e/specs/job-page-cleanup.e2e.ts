/**
 * The Job page cleanup (docs/superpowers/specs/2026-11-16-first-run-design.md §7): no "No file open" bar above the
 * steps, the file opens at step 3, step 4 hints what Check does, the footer keeps only the version, and the
 * reassurance lines are gone. RUN_SCREENSHOTS=1 writes the walkthrough pictures to
 * docs/design/screenshots/job-page-cleanup/.
 */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

const SCREENSHOTS = process.env['RUN_SCREENSHOTS'] === '1';
const SHOT_DIR = new URL('../../../docs/design/screenshots/job-page-cleanup/', import.meta.url).pathname;
const SIGNED_IN = { account: { subject: 'usr_owner', display: '@owner', canConnect: true }, signIn: true };

test('the Job page opens on the steps; the file lives at step 3; Check hints its verdict; the footer is the version', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); // The footer hides on laptop heights (800 px and under).
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route('**/api/session', (route) => route.fulfill({ json: SIGNED_IN }));
  await page.goto('/'); await ready(page);
  await expect(page.locator('.job-card, .job-files-drawer, [data-action="job-files"], [data-action="job-projects"]')).toHaveCount(0);
  await expect(page.locator('.job-step-bar [data-job-step]')).toHaveCount(5);
  await expect(page.locator('[data-job-step="check"] small')).toHaveText('Review the safety verdict');
  const footer = page.locator('.footer');
  await expect(footer.locator('[data-version]')).toBeVisible();
  await expect(footer).not.toContainText('Review settings');
  await expect(footer).not.toContainText('saved in this browser');
  // The file block waits at step 3; its picker is in the tree all along, for the viewer's "Open a file" prompt.
  const file = page.locator('[data-job-panel="file"]');
  await expect(file).toBeHidden();
  await expect(page.locator('[data-preview="file"]')).toHaveCount(1);
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
    await expect(page.locator('.job-step-bar')).toBeVisible();
    if (SCREENSHOTS) await page.screenshot({ path: `${SHOT_DIR}job-light-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[data-job-step="place"]').click();
  await expect(file).toBeVisible();
  await expect(file.locator('h2')).toHaveText('File');
  await expect(file.locator('.file-button')).toHaveText(/Open a file/);
  await expect(file.locator('[data-action="job-close"]')).toHaveCount(0);
  await expect(page.locator('[data-action="job-open-file"]')).toBeVisible();
  if (SCREENSHOTS) await page.screenshot({ path: `${SHOT_DIR}job-step3-light-1280.png` });
  // Opening a sample fills the block: the name, its lines, Open another and Close job.
  await page.locator('[data-sample="test-square"]').click();
  await expect(file.locator('[data-preview="file-name"]')).toHaveText('test-square.nc');
  await expect(file.locator('.file-button')).toHaveText(/Open another/);
  await expect(file.locator('[data-action="job-close"]')).toBeEnabled();
  await expect(file.locator('[data-job="save-target"]')).toBeVisible();
  if (SCREENSHOTS) await page.locator('#job-work-panel').screenshot({ path: `${SHOT_DIR}file-block-open-light.png` });
  // With a file open the name and Close job follow the user to every step (a finished run is closed from step 5).
  await page.locator('[data-job-step="run"]').click();
  await expect(file).toBeVisible();
  await expect(file.locator('[data-preview="file-name"]')).toHaveText('test-square.nc');
  await expect(file.locator('[data-action="job-close"]')).toBeVisible();
  await expect(file.locator('.file-button')).toBeHidden();
  await expect(file.locator('h2')).toHaveCount(0);
  await page.locator('[data-job-step="place"]').click();
  await file.locator('[data-action="job-close"]').click();
  await expect(file.locator('[data-preview="file-name"]')).toHaveText('none');
  await expect(page.locator('[data-job-step="machine"]')).toHaveAttribute('aria-current', 'step');
});
