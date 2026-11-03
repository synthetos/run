/**
 * Settings writes in the built app (fake-serial TEST build; SAFETY §4.6,
 * H57-H63, T-S99, amendment 2026-11-02). The simulated edge-next board
 * persists writes and stalls while its EEPROM is written.
 *
 * Edit a setting in the Board view, apply it: the backup is downloaded
 * first, the value is written once and read back, the board's EEPROM holds
 * it, and no byte was lost to the stall. Then revert: the backed-up value is
 * written back the same way. Every write on the wire is a GET, `!`, ENQ or
 * exactly one of the settings lines the user confirmed.
 *
 * With RUN_SETTINGS_SHOTS set to a directory, screenshots at 1440 px of the
 * pending changes tray, the high-risk confirmation and the settings table
 * are written there.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { isReportConfig } from './helpers.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const SHOTS = process.env['RUN_SETTINGS_SHOTS'];

interface Status {
  readonly status: { readonly session: { readonly base: string; readonly classification: { readonly mode: string } | null } };
}

async function connectedTab(page: Page): Promise<Worker> {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  // Loopback is the bench: the motion flag is on too, so the identified board rests in IDLE_UNHOMED.
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as Status).status.session.base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  expect(((await request(worker, { v: 3, kind: 'status' })) as Status).status.session.classification?.mode).toBe('full');
  return worker;
}

/** The simulated board's state, read inside the worker. */
function board(worker: Worker): Promise<{ eeprom: Record<string, unknown>; ram: unknown; lost: number; eepromWrites: number; writes: string[] }> {
  return worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    interface Device {
      readonly settings: { readonly eeprom: Record<string, unknown>; get(k: string): unknown };
      readonly eepromLostBytes: number;
      readonly eepromWrites: number;
    }
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: Device; transcript: { entries(): readonly Entry[] } } }[] } }).__RUN_FAKE_SERIAL__;
    const port = registry?.ports.at(-1);
    if (port === undefined) throw new Error('no fake port');
    const d = port.endpoint.device;
    return {
      eeprom: { ...d.settings.eeprom },
      ram: d.settings.get('xfr'),
      lost: d.eepromLostBytes,
      eepromWrites: d.eepromWrites,
      writes: port.endpoint.transcript.entries().filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data)),
    };
  });
}

async function openBoard(page: Page): Promise<void> {
  await page.locator('[data-region="rail"] [data-view="board"]').click();
  await expect(page.locator('[data-screen="board"]')).toBeVisible();
  const w29 = page.locator('[data-action="dismiss-w29"]');
  if ((await w29.count()) > 0) await w29.click();
}

test('edit a setting, apply: backup downloaded first, written once and read back, persisted; then revert from the backup', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await connectedTab(page);
  await openBoard(page);
  await page.locator('[data-board-tab="axes"]').click();
  const edit = page.locator('#board-pane-axes [data-action="toggle-edit"]');
  await expect(edit).toBeEnabled({ timeout: 20_000 });
  const before = await board(worker);
  const old = before.eeprom['xfr'];
  expect(typeof old).toBe('number');
  const next = (old as number) - 100;
  await edit.click();
  const field = page.locator('#board-pane-axes [data-setting-edit="xfr"]');
  await field.fill(String(next));
  await field.press('Tab');

  // The pending changes tray shows the diff; Apply is enabled (switch on, board idle and approved).
  const tray = page.locator('[data-region="pending-changes"]');
  await expect(tray).toBeVisible();
  await expect(tray.locator('[data-pending-key="xfr"]')).toBeVisible();
  await expect(tray.locator('[data-settings-write="ready"]')).toBeVisible();
  const apply = tray.locator('[data-action="apply-settings"]');
  await expect(apply).toBeEnabled();

  // A high-risk change (switch type) needs its consequence ticked and WRITE typed: shown, then cancelled.
  await page.locator('[data-board-tab="inputs"]').click();
  await page.locator('#board-pane-inputs [data-action="toggle-edit"]').click();
  const st = before.eeprom['st'] === 1 ? '0' : '1';
  await page.locator('#board-pane-inputs [data-setting-edit="st"]').selectOption(st);
  await expect(tray.locator('[data-pending-key="st"]')).toHaveClass(/high-risk/);
  if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/settings-pending-tray-1440.png` });
  await apply.click();
  const dialog = page.locator('[data-dialog="apply-confirm"]');
  await expect(dialog.locator('[data-risk-key="st"]')).toContainText('always pressed or never pressed');
  await expect(dialog.locator('[data-action="confirm-apply"]')).toBeDisabled();
  if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/settings-high-risk-confirm-1440.png` });
  await dialog.locator('[data-action="cancel-apply"]').click();
  await tray.locator('[data-pending-key="st"] [data-action="remove-pending"]').click();
  await expect(tray.locator('[data-pending-key="st"]')).toHaveCount(0);

  // Apply the one change: the backup is downloaded before anything is written.
  await apply.click();
  await expect(dialog).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.locator('[data-action="confirm-apply"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^synthetos-settings-SIM-EN-0001-\d{4}-\d{2}-\d{2}-before-write-\d{6}\.json$/);
  const { readFile } = await import('node:fs/promises');
  const backup = JSON.parse(await readFile(await file.path(), 'utf8')) as { tokens: Record<string, unknown>; unanswered: unknown[] };
  expect(backup.tokens['xfr']).toBe(old);
  expect(backup.unanswered).toEqual([]);
  await expect(tray.locator('[data-apply="done"]')).toBeVisible({ timeout: 20_000 });
  await expect(tray.locator('[data-apply-step="xfr"]')).toHaveAttribute('data-step-status', 'verified');
  let after = await board(worker);
  expect(after.eeprom['xfr']).toBe(next);
  expect(after.lost).toBe(0);
  const setLines = (w: readonly string[]): string[] => w.filter((x) => /^\{"[a-z0-9_]+":-?[0-9.]+\}\n$/.test(x));
  expect(setLines(after.writes)).toEqual([`{"xfr":${next}}\n`]);
  // The read-back follows the write directly.
  const at = after.writes.indexOf(`{"xfr":${next}}\n`);
  expect(after.writes[at + 1]).toBe('{"xfr":null}\n');
  for (const w of after.writes) expect(/^\{"?[a-z0-9_]+"?:null\}\n$/.test(w) || /^\{"[a-z0-9_]+":-?[0-9.]+\}\n$/.test(w) || w === '\u0005' || w === '!' || isReportConfig(w), JSON.stringify(w)).toBe(true);

  // Revert writes the backed-up value back, read back the same way.
  await tray.locator('[data-action="revert-settings"]').click();
  await expect(tray.locator('[data-apply="done"][data-apply-mode="revert"]')).toBeVisible({ timeout: 20_000 });
  after = await board(worker);
  expect(after.eeprom['xfr']).toBe(old);
  expect(setLines(after.writes)).toEqual([`{"xfr":${next}}\n`, `{"xfr":${old as number}}\n`]);
  expect(after.lost).toBe(0);
  // The write and the revert, plus the status report list run set at connect (amendment 2026-11-02, H64).
  expect(after.eepromWrites).toBe(3);

  if (SHOTS !== undefined) {
    await page.locator('[data-action="clear-apply"]').click();
    await page.locator('[data-board-tab="settings"]').click();
    await page.locator('[aria-label="Search settings"]').fill('x');
    await page.screenshot({ path: `${SHOTS}/settings-all-settings-1440.png` });
  }
});
