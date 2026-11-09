/**
 * Simple says things in plain words (first-time walk 2026-11-08, C10, C11, C12), in the built app (fake-serial TEST
 * build): the Board card hides the firmware keys (fb, fv, hp…) and the drawing's internal code; the Live job log has
 * no rxm, feedhold or planner queue; the start confirmation names the spindle speed in rpm. Advanced shows the keys.
 */
import { expect, test } from './fixtures.ts';
import { connect, open, phase, zigzag } from './jobFlow.ts';
import { showWorkspace } from './workspace-navigation.ts';

test('Simple hides firmware keys and internal codes; the log and the start confirmation use plain words', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await page.locator('[data-action="ui-level-simple"]').click();
  await showWorkspace(page, 'board');
  const facts = page.locator('.board-facts');
  await expect(facts.locator('[data-board-fact="fb"]')).toBeVisible();
  await expect(facts.locator('.raw-key').first()).toBeHidden();
  await expect(page.locator('[data-screen="board"]')).not.toContainText('OD-5');
  await page.locator('[data-action="ui-level-advanced"]').click();
  await expect(facts.locator('.raw-key').first()).toBeVisible();
  await page.locator('[data-action="ui-level-simple"]').click();
  await showWorkspace(page, 'job');
  await open(page, zigzag(10, [], ['M3 S16000']).replace('M30', 'M5\nM30'));
  await expect(page.locator('[data-safety="C32"]')).toContainText('16,000 rpm');
  for (const box of ['confirm-unhomed', 'confirm-zero', 'confirm-spindle', 'confirm-attended']) {
    const el = page.locator(`[data-job="${box}"]`);
    if ((await el.count()) > 0) await el.check();
  }
  await page.locator('[data-action="start-job"]').click();
  await expect(page.locator('[data-safety="C30"]')).toContainText('starts with 16,000 rpm');
  await expect(page.locator('[data-safety="C30"]')).not.toContainText('S16000');
  await page.locator('[data-safety="C30"] [data-action="motion-confirm"]').click();
  await expect.poll(() => phase(worker), { timeout: 60_000 }).toBe('done');
  await page.locator('[data-tab="live"]').click();
  const log = page.locator('[data-live="events"]');
  await expect(log).toContainText('Sending the job one line at a time.');
  await expect(log).not.toContainText('Streaming in line mode');
  await expect(log).not.toContainText('Line mode put back: rxm');
});
