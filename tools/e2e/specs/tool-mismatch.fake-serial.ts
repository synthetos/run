/**
 * The file says T1 is a 6 mm end mill, the tool table's T1 is 3.175 mm (tool-mismatch, 2026-11-10), in the built app
 * (fake-serial TEST build), with a file in the docklight housing's style (SolidCraft headers): a Needs you note in
 * Notes with [Edit T1] and [Use the file's tool], the same as a Ready row on the Run step (never blocking), Edit T1
 * opening the tool, and "Use the file's tool" asking first and then making T1 the file's 6 mm end mill, the old T1
 * kept under a free number. With RUN_SCREENSHOTS_DIR set, the note, the row and the confirmation in both themes.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { connect, open } from './jobFlow.ts';

const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

/** Docklight-style: SolidCraft's operation comments name each tool. T1 is 6 mm here, 3.175 mm in the seed table; T2 matches the seed's 6 mm. */
const DOCKLIGHT_STYLE = [
  '(docklight-housing-top)',
  'G17 G21 G90 G94 G54',
  '(Boss top: T1 D6 flat end mill)',
  'M5',
  'T1 M6',
  'G0 Z5',
  'G0 X0 Y0',
  'G1 Z-0.5 F300',
  'G1 X10 F600',
  'G1 Y10',
  'G0 Z5',
  '(O-ring groove: T2 D6 flat end mill)',
  'M5',
  'T2 M6',
  'G0 X5 Y5',
  'G1 Z-0.3 F300',
  'G1 X8 F600',
  'G0 Z5',
  'M30',
  '',
].join('\n');

const note = (page: Page) => page.locator('[data-note="tool-mismatch/1"]');

async function notesTab(page: Page): Promise<void> {
  await page.locator('[data-tab="notes"]').click();
  await expect(note(page)).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test(`the file’s T1 against the table’s: the note, the Ready row, and Use the file’s tool (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme });
    await connect(page);
    await open(page, DOCKLIGHT_STYLE, 'docklight-style.gcode');

    // The Ready row on the Run step: needs you, never blocking, with the note's buttons.
    const row = page.locator('[data-ready-item="tool"]');
    await expect(row).toHaveAttribute('data-mark', 'needs');
    await expect(row.locator('[data-ready-summary="tool"]')).toHaveText('T1 doesn’t match the file.');
    await expect(row.locator('[data-action="ready-edit-tool"]')).toHaveText('Edit T1');
    await expect(row.locator('[data-action="ready-use-file-tool"]')).toHaveText('Use the file’s tool');
    if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/tool-mismatch-ready-${theme}.png` });

    // The note, under Needs you: the file's words, the table's, and that the 3D view draws the table's tool.
    await notesTab(page);
    await expect(note(page)).toContainText('The file says T1 is a 6 mm end mill.');
    await expect(note(page)).toContainText('Your tool table’s T1 is 3.175 mm. The 3D view draws your table’s tool.');
    await expect(note(page).locator('[data-note-action="tool-edit-1"]')).toHaveText('Edit T1');
    await expect(note(page).locator('[data-note-action="tool-use-file-1"]')).toHaveText('Use the file’s tool');
    await expect(page.locator('[data-note="tool-mismatch/2"]')).toHaveCount(0);
    if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/tool-mismatch-note-${theme}.png` });

    // Use the file's tool asks first; Cancel changes nothing.
    await note(page).locator('[data-note-action="tool-use-file-1"]').click();
    const ask = page.locator('[data-region="tool-file-confirm"]');
    await expect(ask).toContainText('Use the file’s tool for T1?');
    await expect(ask.locator('[data-tool-file="plan"]')).toHaveText(/^A new tool, 6 mm end mill, becomes T1\. Your .+ moves to T\d+\.$/);
    if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/tool-mismatch-confirm-${theme}.png` });
    await ask.locator('[data-action="tool-file-cancel"]').click();
    await expect(ask).toHaveCount(0);
    await expect(note(page)).toBeVisible();

    // From the Ready row this time; confirmed, T1 is the file's tool and the note and the row go.
    await page.locator('[data-ready-item="tool"] [data-action="ready-use-file-tool"]').click();
    await ask.locator('[data-action="tool-file-confirm"]').click();
    await expect(note(page)).toHaveCount(0);
    await expect(page.locator('[data-ready-item="tool"]')).not.toHaveAttribute('data-mark', 'needs');

    // The tool table: T1 is the 6 mm end mill from the file.
    await page.locator('[data-region="rail"] [data-view="library"]').click();
    await page.locator('#library-tab-tools').click();
    await expect(page.locator('[data-tool-row="1"]')).toContainText('6 mm end mill');
  });
}

test('Edit T1 opens T1 in the tool table', async ({ page }) => {
  await connect(page);
  await open(page, DOCKLIGHT_STYLE, 'docklight-style.gcode');
  await notesTab(page);
  await note(page).locator('[data-note-action="tool-edit-1"]').click();
  await expect(page.locator('#library-tab-tools')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-tool-row="1"]')).toHaveAttribute('aria-selected', 'true');
});
