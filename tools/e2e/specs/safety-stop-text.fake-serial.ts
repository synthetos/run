/**
 * The Safety view, the Stop job tooltip and the job log say the same thing about Stop job (first-time walk
 * 2026-11-08, S4), in the built app (fake-serial TEST build, where the session has motion control).
 */
import { expect, test } from './fixtures.ts';
import { machineWorker } from './machineWorker.ts';
import { connect } from './jobFlow.ts';
import { showWorkspace } from './workspace-navigation.ts';

test('before a connection the Safety view says what Stop job does in both cases', async ({ page }) => {
  await machineWorker(page);
  await showWorkspace(page, 'safety');
  const p = page.locator('[data-safety-view="stop-job"]');
  await expect(p).toContainText('What Stop job does depends on the connection.');
  await expect(p).toContainText('clears the queue, and turns the spindle and coolant off');
  await expect(p).toContainText('sends a feedhold');
});

test('connected with motion control, the Safety view and the Stop job tooltip both say queue cleared, spindle and coolant off', async ({ page }) => {
  await connect(page);
  await showWorkspace(page, 'safety');
  const p = page.locator('[data-safety-view="stop-job"]');
  await expect(p).toContainText('On the machine connected now, Stop job stops motion, clears the queue, and turns the spindle and coolant off.');
  await expect(p).not.toContainText('sends a feedhold');
  await expect(page.locator('[data-region="machine-strip"] [data-action="stop-job"]')).toHaveAttribute('title', /clears the queue, and turns the spindle and coolant off/);
});
