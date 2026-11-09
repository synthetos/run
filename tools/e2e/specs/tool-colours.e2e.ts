/**
 * Colour by tool in the 3D view (owner, 2026-11-09): the key's legend lists the tools the file uses, in the order
 * it uses them, each with its colour slot; a tool not in the tool table is listed with the neutral colour and says
 * so. Clicking an entry makes that tool's lines stand out, and clicking it again shows them all. The colours
 * themselves are drawn in WebGL, so this checks the legend and its slots, not pixels.
 */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

const FILE = ['G21 G90', 'T4 M6', 'G0 Z5', 'G0 X20 Y20', 'G1 Z-1 F300', 'G1 X40', 'G0 Z5', 'T1 M6', 'G0 X20 Y40', 'G1 Z-1 F300', 'G1 X40', 'G0 Z5', 'T9 M6', 'G0 X20 Y60', 'G1 Z-1 F300', 'G1 X40', 'G0 Z5', 'T4 M6', 'G0 X20 Y80', 'G1 Z-1 F300', 'G1 X40', 'G0 Z5', 'M30'].join('\n');

test('the key lists the tools by colour in the order the file uses them; an unknown tool is neutral', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await sheet.locator('[data-preview="file"]').setInputFiles({ name: 'three-tools.nc', mimeType: 'text/plain', buffer: Buffer.from(FILE) });
  const legend = sheet.locator('[data-scene="tool-legend"]');
  const entries = legend.locator('.tool-legend-entry');
  await expect(entries).toHaveText(['T4 · 90° V-bit', 'T1 · 3.175 mm 2-flute up-cut', 'T9 · not in your tool table']);
  // T4 comes back at the end with its own colour: it is listed once.
  expect(await entries.evaluateAll((els) => els.map((e) => e.getAttribute('data-tool-slot')))).toEqual(['1', '2', '0']);
  await expect(entries.nth(2)).toHaveClass(/unknown/);
  await entries.nth(1).click();
  await expect(entries.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await entries.nth(1).click();
  await expect(entries.nth(1)).toHaveAttribute('aria-pressed', 'false');
});

test('a file with one tool has no legend: its lines are that tool colour', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const sheet = page.locator('[data-region="preview"]');
  await sheet.locator('[data-preview="file"]').setInputFiles({ name: 'one-tool.nc', mimeType: 'text/plain', buffer: Buffer.from(['G21 G90', 'T1 M6', 'G0 X10 Y10', 'G1 Z-1 F300', 'G1 X20', 'M30'].join('\n')) });
  await expect(sheet.locator('[data-scene="tool"]')).toHaveAttribute('data-active-tool', 'T1');
  await expect(sheet.locator('[data-scene="tool-legend"]')).toHaveCount(0);
});
