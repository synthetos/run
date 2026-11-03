/**
 * The Job model's first slice in the built app (fake-serial TEST build;
 * FLOW_ANALYSIS §4 steps 1-4): a project's G-code opens as that project's
 * job with its machine and bed, the one scene shows bed, stock and toolpath
 * in Run (3D and Top) and in Setup, a drawing goes into the job through
 * "Use in Job" with its check first, the job reopens intact after a reload,
 * and Projects shows the job.
 *
 * With RUN_SCREENSHOTS_DIR set, screenshots are written there at 1440 px.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

async function show(page: Page, view: string): Promise<void> {
  await page.locator(`[data-region="rail"] [data-view="${view}"]`).click();
  await expect(page.locator(`[data-screen="${view}"]`)).toBeVisible();
}

const GCODE = ['(plate)', 'G21 G90', 'G0 Z5', 'G0 X10 Y10', 'G1 Z-2 F200', 'G1 X150 F600', 'G1 Y90', 'G1 X10', 'G1 Y10', 'G0 Z5', 'M2', ''].join('\n');
const FIXTURE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect x="0" y="0" width="300" height="200"/><circle cx="25" cy="25" r="3"/><circle cx="275" cy="175" r="3"/><text x="1" y="1">plate</text></svg>';

test('a project file opens as the project’s job on a machine bed; the scene, Use in Job and a reload keep it intact', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const shot = async (name: string): Promise<void> => {
    if (SHOTS === undefined) return;
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/1440-${name}.png` });
  };
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');

  // A machine to plan on (its bed is a placeholder from the travel).
  await show(page, 'machines');
  await page.locator('[data-tab="catalogue"]').click();
  await page.locator('[data-template="xcarve"] [data-action="copy-machine"]').click();
  await expect(page.locator('[data-machine="bed"]')).toHaveAttribute('data-bed', 'placeholder');

  // The project with its G-code and a fixture drawing.
  await show(page, 'projects');
  await page.locator('[data-action="project-new"]').click();
  await page.locator('[data-action="project-rename"]').click();
  await page.locator('[data-project="name-input"]').fill('Mounting plate');
  await page.locator('[data-action="project-save-name"]').click();
  await page.locator('[data-project="file-input"]').setInputFiles([
    { name: 'plate.nc', mimeType: 'text/plain', buffer: Buffer.from(GCODE) },
    { name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(FIXTURE_SVG) },
  ]);
  await expect(page.locator('[data-project-file="fixture.svg"]')).toBeVisible();
  await expect(page.locator('[data-project="no-jobs"]')).toBeVisible();

  // Use in Job: the role menu, then the drawing is checked and shown before it is accepted.
  await page.locator('[data-project-file="fixture.svg"] [data-action="project-use-in-job"]').click();
  await expect(page.locator('[data-project-file="fixture.svg"] [role="menu"]')).toBeVisible();
  await shot('projects-use-in-job');
  await page.locator('[data-project-file="fixture.svg"] [data-use-as="fixture"]').click();
  const card = page.locator('[data-project="import"]');
  await expect(card.locator('[data-import="size"]')).toHaveText('300 × 200 mm');
  await expect(card.locator('[data-import="skipped"]')).toContainText('1 text');
  await card.locator('[data-import="height"]').fill('15');
  await card.locator('[data-action="import-accept"]').click();
  await expect(page.locator('[data-project="import-result"]')).toContainText('fixture.svg is the fixture');

  // The G-code opens as this project's job, on the selected machine's bed, with the file on it.
  await page.locator('[data-project-file="plate.nc"] [data-action="project-open-in-run"]').click();
  await expect(page.locator('[data-screen="run"]')).toBeVisible();
  await expect(page.locator('[data-preview="file-name"]')).toHaveText('plate.nc', { timeout: 30_000 });
  await expect(page.locator('[data-preview="summary"]')).toBeVisible({ timeout: 30_000 });
  const identity = page.locator('[data-job="identity"]');
  await expect(identity.locator('[data-job="project"]')).toHaveText('Mounting plate');
  await expect(identity.locator('[data-job="machine"]')).toContainText('My X-Carve');
  await expect(identity.locator('[data-job="bed"]')).toHaveAttribute('data-bed', 'placeholder');
  await expect(page.locator('[data-screen="run"] [data-scene="bed"]')).toContainText('placeholder');
  await expect(page.locator('[data-screen="run"] [data-preview="canvas"], [data-screen="run"] [data-preview="svg"]')).toHaveCount(1);
  await shot('run-scene-3d');
  await page.locator('[data-screen="run"] [data-preview="view-top"]').click();
  await shot('run-scene-top');

  // Setup edits the same job and shows the same scene with the path on it.
  await show(page, 'setup');
  await expect(page.locator('[data-setup="job-name"]')).toHaveText('plate');
  await expect(page.locator('[data-screen="setup"] [data-scene="bed"]')).toContainText('My X-Carve');
  await expect(page.locator('[data-screen="setup"] [data-preview="canvas"], [data-screen="setup"] [data-preview="svg"]')).toHaveCount(1);
  await expect(page.locator('[data-height="fixture"]')).toHaveText('−50.00');
  await shot('setup-scene');

  // Projects lists the job; it is the open one.
  await show(page, 'projects');
  await expect(page.locator('[data-project-job="plate"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-project-job="plate"]')).toContainText('bed revision 0 (placeholder)');

  // After a reload the job comes back intact: same project, machine, bed and file, without any live fact.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-preview="file-name"]')).toHaveText('plate.nc', { timeout: 30_000 });
  await expect(identity.locator('[data-job="project"]')).toHaveText('Mounting plate');
  await expect(identity.locator('[data-job="machine"]')).toContainText('My X-Carve');
  await show(page, 'setup');
  await expect(page.locator('[data-height="fixture"]')).toHaveText('−50.00');
  await show(page, 'run');
  await shot('run-reopened-job');
});
