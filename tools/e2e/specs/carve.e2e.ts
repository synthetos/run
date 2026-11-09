/**
 * The stock carving in the browser (docs/design/tool-sim.md, slice 2): a file cut with a V-bit that is in the
 * tool table (seed: T4, 12.7 mm, 90°) carves the stock in the carve worker. With nothing scrubbed the whole
 * job is carved; scrubbing moves the carve back and forward. The key's carve line carries what the carve has
 * reached (`data-carved-through`, the file line; `data-carve-lowest`, the lowest top in the path frame), so
 * nothing here reads pixels. A T number not in the table carves nothing and the key names the lines. A file
 * with no tool change carves nothing until the user chooses the tool already in the spindle in Analyze.
 */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

// Lines: 1 units, 2 the V-bit, 3-4 rapids above the stock, 5 a plunge to 1 mm deep, 6-9 a rectangle, 10 up, 11 end.
const V_FILE = ['G21 G90', 'T4 M6', 'G0 Z5', 'G0 X10 Y10', 'G1 Z-1 F300', 'G1 X40', 'G1 Y30', 'G1 X10', 'G1 Y10', 'G0 Z5', 'M30'].join('\n');

/**
 * The lowest top a 90° V at Z -1 leaves on the 0.125 mm grid, whose cell centres sit 0.0625 mm off whole
 * millimetres: a cut along a line leaves −1 + 0.0625, the plunge alone −1 + 0.0625·√2.
 */
const CUT = (-1 + 0.0625).toFixed(3);
const PLUNGE = (-1 + 0.0625 * Math.SQRT2).toFixed(3);

async function open(page: import('@playwright/test').Page, name: string, text: string): Promise<void> {
  await page.locator('[data-region="preview"] [data-preview="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('[data-preview="file-name"]')).toHaveText(name);
}

test('the stock is carved with the V-bit from the tool table, and the carve follows the scrubber', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await open(page, 'v-rect.nc', V_FILE);
  const carve = sheet.locator('[data-scene="carve"]');
  // Simple (the default level) does not show the carving detail; the hooks are there at both levels.
  await expect(carve).toBeHidden();
  await expect(carve).toHaveAttribute('data-carve-cell', '0.125');
  // Nothing scrubbed: the whole job, down near the V-bit's tip 1 mm below the stock top (cell centres are
  // 0.0625 mm off the path, so the deepest cell is 0.9375 mm deep under a 90° V).
  await expect(carve).toHaveAttribute('data-carve-done', 'true');
  await expect(carve).toHaveAttribute('data-carve-lowest', CUT);
  const whole = Number(await carve.getAttribute('data-carved-through'));
  expect(whole).toBeGreaterThanOrEqual(10);
  await expect(sheet.locator('[data-scene="carve-note"]')).toHaveCount(0);

  const scrubber = sheet.locator('[data-preview="scrubber"]');
  const carvedAt = async (line: number, lowest: string): Promise<void> => {
    await scrubber.fill(String(line));
    await expect(sheet.locator('[data-preview="scrub-line"]')).toHaveText(`file line ${String(line)}`);
    await expect(carve).toHaveAttribute('data-carved-through', String(line));
    await expect(carve).toHaveAttribute('data-carve-done', 'true');
    await expect(carve).toHaveAttribute('data-carve-lowest', lowest);
  };
  // Back to before the plunge: the stock is uncut again.
  await carvedAt(4, '0.000');
  await carvedAt(5, PLUNGE);
  await carvedAt(7, CUT);
  await carvedAt(3, '0.000');
  await carvedAt(9, CUT);
});

test('a tool that is not in the tool table carves nothing, and the key names the lines', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await open(page, 't9.nc', V_FILE.replace('T4 M6', 'T9 M6'));
  const carve = sheet.locator('[data-scene="carve"]');
  await expect(carve).toHaveAttribute('data-carve-done', 'true');
  await expect(carve).toHaveAttribute('data-carve-lowest', '0.000');
  await expect(sheet.locator('[data-scene="carve-note"]')).toHaveText('Lines 5–9 not carved: T9 is not in your tool table');
});

test('a file with no tool change is carved once the user chooses the tool already in the spindle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await open(page, 'no-m6.nc', V_FILE.replace('T4 M6', '(the tool is already in the spindle)'));
  const carve = sheet.locator('[data-scene="carve"]');
  await expect(carve).toHaveAttribute('data-carve-done', 'true');
  await expect(carve).toHaveAttribute('data-carve-lowest', '0.000');
  await expect(sheet.locator('[data-scene="carve-note"]')).toHaveText('Lines 5–9 not carved: no tool chosen. Choose the tool in the spindle in Analyze');

  await page.locator('[data-region="rail"] [data-view="analyze"]').click();
  const view = page.locator('[data-screen="analyze"]');
  for (const op of await view.locator('[data-advisor-operation]').all()) await op.locator('[data-advisor-field="tool"]').selectOption('4');
  await page.locator('[data-region="rail"] [data-view="job"]').click();
  await expect(carve).toHaveAttribute('data-carve-done', 'true');
  await expect(carve).toHaveAttribute('data-carve-lowest', CUT);
  await expect(sheet.locator('[data-scene="carve-note"]')).toHaveCount(0);
});

test('a cut below the stock is named in the key as a preview of the planned setup', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  // The sample stock is 6.35 mm thick with its zero on top: line 5 cuts to Z -6.95, 0.6 mm under its bottom.
  await open(page, 'through.nc', ['G21 G90', 'T1 M6', 'G0 Z5', 'G0 X20 Y20', 'G1 Z-6.95 F300', 'G1 X60', 'G0 Z5', 'M30'].join('\n'));
  const note = sheet.locator('[data-scene="below-stock-note"]');
  await expect(note).toHaveText('The tool goes 0.6 mm below the stock at line 5 (preview, from the planned setup)');
  await expect(note).toHaveAttribute('data-below-line', '5');
  // Scrubbed back before that line, the note goes with the carve.
  await sheet.locator('[data-preview="scrubber"]').fill('4');
  await expect(sheet.locator('[data-scene="carve"]')).toHaveAttribute('data-carved-through', '4');
  await expect(note).toHaveCount(0);
});

test('the key: Simple shows the tool by its library name and the notes that matter; Advanced adds the bed, detail and links', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await open(page, 'v-rect.nc', V_FILE);
  const key = sheet.locator('.scene-key-line');
  await expect(sheet.locator('[data-scene="carve"]')).toHaveAttribute('data-carve-done', 'true');
  // Simple (the default level).
  // C4: the library's name, as in Advanced and the tool table.
  await expect(key.locator('[data-scene="tool"]')).toHaveText('T4 · 90° V-bit');
  // C2: the bed's size, and that it is not measured yet; never "not set" while a size shows.
  await expect(key.locator('[data-scene="bed"]')).toHaveText('Bed 790 × 790 mm (not measured yet)');
  await expect(key.locator('[data-scene="pick-hint"]')).toHaveText('Click the bed, fixture or stock to change it');
  await expect(key.locator('nav.scene-links')).toHaveCount(0);
  await expect(key).not.toContainText('Carving');
  await expect(key).not.toContainText('revision');
  await expect(sheet.locator('[data-preview="mode"]')).toHaveCount(0);
  await expect(sheet.locator('[data-preview="dialect"]')).toHaveCount(0);
  // Advanced.
  await page.locator('[data-action="ui-level-advanced"]').click();
  await expect(key.locator('[data-scene="bed"]')).toHaveText('Bed · 790 × 790 mm · not measured yet');
  await expect(key.locator('[data-scene="tool"]')).toHaveText('T4 · 90° V-bit');
  await expect(key.locator('[data-scene="carve"]')).toHaveText('Carving detail 0.125 mm');
  await expect(key.locator('[data-scene-link]')).toHaveCount(3);
  await expect(key.locator('[data-scene="pick-hint"]')).toHaveCount(0);
  await expect(sheet.locator('.viewer-options')).toContainText('Read as:');
  await expect(sheet.locator('[data-preview="dialect"] option:checked')).toHaveText('TinyG edge-next');
  await expect(sheet.locator('[data-preview="mode"] option:checked')).toHaveText('Auto (simpler above 300,000 lines)');
});

