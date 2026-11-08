/**
 * The 3D marker's tool in the browser (docs/design/tool-sim.md, slice 1): the key names the active tool at
 * the scrubbed line, from the tool table in this browser (seed: T1 flat, T3 ball, T4 V-bit). A T number not
 * in the table gets a note and a link that adds it to the tool table, where its T number can be changed; a
 * file that cuts before its first tool change says the tool shown is a placeholder. With no board, a scrubbed
 * line puts a planned tool there and the key says it is a preview.
 */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

const CHANGES = ['G21 G90', 'T9 M6', 'G1 X10 F600', 'T1 M6', 'G1 X20', 'T3', 'M6', 'G1 Y10', 'T4 M6', 'G1 Z-1', 'M30'].join('\n');

async function open(page: import('@playwright/test').Page, name: string, text: string): Promise<void> {
  await page.locator('[data-region="preview"] [data-preview="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('[data-preview="file-name"]')).toHaveText(name);
}

test('the key follows the active tool at the scrubbed line; an unknown T number offers the tool table', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await open(page, 'changes.nc', CHANGES);
  const tool = sheet.locator('[data-scene="tool"]');
  // Nothing scrubbed: the tool the job starts cutting with (line 3, after T9 M6), which the table does not have.
  await expect(tool).toHaveAttribute('data-active-tool', 'T9');
  await expect(tool).toHaveAttribute('data-tool-shape', 'generic');
  await expect(sheet.locator('[data-scene="tool-note"]')).toContainText('T9 is not in your tool table');

  const scrubber = sheet.locator('[data-preview="scrubber"]');
  const at = async (line: number, t: string, shape: string): Promise<void> => {
    await scrubber.fill(String(line));
    await expect(sheet.locator('[data-preview="scrub-line"]')).toHaveText(`file line ${String(line)}`);
    await expect(tool).toHaveAttribute('data-active-tool', t);
    await expect(tool).toHaveAttribute('data-tool-shape', shape);
  };
  await at(5, 'T1', 'flat');
  await expect(sheet.locator('[data-scene="tool-preview"]')).toHaveText('Tool at the scrubbed line (preview)');
  await expect(sheet.locator('[data-preview="marker-readout"]')).toHaveCount(0);
  // Simple (the default level) names the tool in plain words, not its catalogue name.
  await expect(tool).toHaveText('T1 · 3.175 mm flat end mill');
  await expect(sheet.locator('[data-scene="tool-note"]')).toHaveCount(0);
  // T3 alone selects; the M6 on the next line changes.
  await at(6, 'T1', 'flat');
  await at(7, 'T3', 'ball');
  await at(10, 'T4', 'v');

  await at(3, 'T9', 'generic');
  await sheet.locator('[data-action="add-tool-number"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-view', 'library');
  const inspector = page.locator('.tools-view [aria-label="Selected tool"]');
  await expect(inspector.locator('h2')).toHaveText('T9 · New tool 9');
  // A T number another tool has is refused with its name, and nothing is swapped.
  const number = inspector.locator('[data-tool-field="number"]');
  await number.fill('3');
  await number.press('Enter');
  await expect(inspector.locator('[data-tool-field="number-error"]')).toHaveText('T3 is already 3.175 mm ball nose. Give that tool another number first.');
  await expect(inspector.locator('h2')).toHaveText('T9 · New tool 9');
  await number.fill('12');
  await number.press('Enter');
  await expect(inspector.locator('h2')).toHaveText('T12 · New tool 9');
});

test('a file that cuts before any tool change says the tool shown is a placeholder', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await open(page, 'no-change.nc', ['G21 G90', 'G1 X5 F600', 'T1 M6', 'G1 X6', 'M30'].join('\n'));
  const sheet = page.locator('[data-region="preview"]');
  await expect(sheet.locator('[data-scene="tool"]')).toHaveAttribute('data-active-tool', 'unknown');
  await expect(sheet.locator('[data-scene="tool-note"]')).toHaveText('No tool change before the first cut: the tool shown is a placeholder.');
});
