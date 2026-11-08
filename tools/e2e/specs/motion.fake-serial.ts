/**
 * Phase 2 bench motion in the built app (fake-serial TEST build, loopback: the motion flag is on and the
 * signed bench channel approves the simulated edge-next board). SAFETY §4.4, §4.5b; T-S89–T-S92 end to end:
 *
 * - a jog step from the jog panel, and a press-and-hold jog that stops on release with `!` then `%`;
 * - keyboard jog while the panel has focus, and a held key released by the window losing focus;
 * - Set zero (C16, G10 L20 P1) and Go to zero (C25, Z first in machine coordinates);
 * - spindle on (C24) and off, coolant;
 * - Pause and Resume of this session's jog; Stop job clears the queue, then spindle and coolant off.
 *
 * The page is not LIVE here (the worker is opened directly, as in the other fake-serial specs), so Pause,
 * Stop job and Resume go to the worker as requests; the jog, zero and spindle controls are driven in the page.
 * With RUN_SCREENSHOTS_DIR set, the jog panel, the zero controls and the spindle card are captured at 1440.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { STOP_TEXT } from '../../../packages/safety/src/strings.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

interface Status {
  readonly status: { readonly session: { readonly base: string; readonly live: { readonly dist?: number }; readonly reports: { readonly phase: string }; readonly notices: { readonly motion?: { readonly text: string } }; readonly motion: { readonly held: boolean } | null } };
}

async function status(worker: Worker): Promise<Status['status']['session']> {
  return ((await request(worker, { v: 3, kind: 'status' })) as Status).status.session;
}

/** Every write to the simulated board, as text. */
function writes(worker: Worker): Promise<string[]> {
  return worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly Entry[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports.at(-1)?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data));
  });
}

/** Writes that are not GETs or ENQ: the motion lines and the realtime bytes. */
async function motionWrites(worker: Worker, from = 0): Promise<string[]> {
  return (await writes(worker)).slice(from).filter((w) => !w.startsWith('{"') && w !== '{sr:null}\n' && w !== '\x05');
}

/** The simulated board's own state. */
function board(worker: Worker): Promise<{ position: number[]; hold: number; spindle: string; coolant: { mist: boolean; flood: boolean } }> {
  return worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: { snapshot(): unknown } } }[] } }).__RUN_FAKE_SERIAL__;
    return registry?.ports.at(-1)?.endpoint.device.snapshot() as { position: number[]; hold: number; spindle: string; coolant: { mist: boolean; flood: boolean } };
  });
}

async function connected(page: Page): Promise<Worker> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  // These specs drive the Advanced pane (tabs); Simple is the default (OD-13).
  await page.locator('[data-action="ui-level-advanced"]').click();
  await expect.poll(async () => (await status(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  // The connect-time report configuration (amendment 2026-11-02) has finished: only motion is written from here.
  await expect.poll(async () => (await status(worker)).reports.phase, { timeout: 10_000 }).toBe('done');
  // The tag carries W34 behind its (?) help, so its text is more than the label (OD-13).
  await expect(page.locator('[data-position="homing"]')).toContainText('Not homed', { timeout: 10_000 });
  return worker;
}

async function tab(page: Page, id: 'jog' | 'zero' | 'spindle'): Promise<void> {
  await page.locator(`[data-tab="${id}"]`).click();
  await expect(page.locator(`#insp-pane-${id}`)).toBeVisible();
}

/** A screenshot of one inspector section at 1440 wide, on a viewport tall enough to show all of it. */
async function shot(page: Page, selector: string, name: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.waitForTimeout(200);
  await page.locator(selector).screenshot({ path: `${SHOTS as string}/${name}-1440.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function idle(worker: Worker): Promise<void> {
  await expect.poll(async () => (await status(worker)).base, { timeout: 15_000 }).toMatch(/^IDLE_/);
}

test('a jog step from the panel, with the unhomed warning; a hold jog stops on release with ! then %', async ({ page }) => {
  const worker = await connected(page);
  await tab(page, 'jog');
  // W34 is the Not-homed tag's help (OD-13): registered text present, shown on hover or focus, not a box.
  await expect(page.locator('[data-safety="W34"]')).toHaveCount(1);
  const from = (await writes(worker)).length;
  await page.locator('.sec-jog [aria-label="Step size"] button', { hasText: /^1$/ }).click();
  await page.getByRole('button', { name: 'X+', exact: true }).click();
  await idle(worker);
  // G21 on its own answered line before the first piece (independent review 2026-11-03, R2).
  expect(await motionWrites(worker, from)).toEqual(['G21\n', 'G21 G91 G1 X1 F1000\n', 'G90\n']);
  expect((await board(worker)).position[0]).toBeCloseTo(1, 3);

  const hold = (await writes(worker)).length;
  await page.locator('.sec-jog [aria-label="Step size"] button', { hasText: 'Hold' }).click();
  const yPlus = page.getByRole('button', { name: 'Y+', exact: true });
  await yPlus.scrollIntoViewIfNeeded();
  const box = await yPlus.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 10, (box?.y ?? 0) + 10);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  // The release reaches the worker after the page's own round trip: wait for the stop to finish, not only for idle.
  await expect.poll(async () => (await motionWrites(worker, hold)).at(-1), { timeout: 15_000 }).toBe('G90\n');
  await idle(worker);
  const w = await motionWrites(worker, hold);
  expect(w[0]).toBe('G21\n');
  expect(w[1]).toMatch(/^G21 G91 G1 Y\d/);
  expect(w.slice(w.indexOf('!'))).toEqual(['!', '%', 'G90\n']);
  expect(w).not.toContain('G91\n');
  expect((await board(worker)).hold).toBe(0);
  // The board itself reports absolute distance once its next report prints (the hold jog started inside the
  // window where the step's last report still showed G91: SAFETY §4.5b as amended 2026-11-08).
  await expect.poll(async () => (await status(worker)).live.dist, { timeout: 5000 }).toBe(0);
  const y = (await board(worker)).position[1] as number;
  expect(y).toBeGreaterThan(0);
  expect(y).toBeLessThan(30);
  if (SHOTS !== undefined) await shot(page, '.sec-jog', 'jog-panel');
});

test('keyboard jog only while the panel has focus; a held key is released when the window loses focus', async ({ page }) => {
  const worker = await connected(page);
  await tab(page, 'jog');
  const from = (await writes(worker)).length;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  expect(await motionWrites(worker, from)).toEqual([]);
  await page.locator('[data-jog="panel"]').focus();
  await page.keyboard.press('ArrowRight');
  await idle(worker);
  expect((await motionWrites(worker, from)).slice(0, 2)).toEqual(['G21\n', 'G21 G91 G1 X1 F1000\n']);

  await page.locator('.sec-jog [aria-label="Step size"] button', { hasText: 'Hold' }).click();
  await page.locator('[data-jog="panel"]').focus();
  const held = (await writes(worker)).length;
  await page.keyboard.down('PageUp');
  await expect.poll(async () => (await status(worker)).motion !== null).toBe(true);
  // The units line goes first (R2); wait for the first piece so that the release ends a jog that was moving.
  await expect.poll(async () => (await motionWrites(worker, held)).some((x) => /^G21 G91 G1 Z\d/.test(x)), { timeout: 10_000 }).toBe(true);
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  await idle(worker);
  await page.keyboard.up('PageUp');
  const w = await motionWrites(worker, held);
  expect(w[0]).toBe('G21\n');
  expect(w[1]).toMatch(/^G21 G91 G1 Z\d/);
  expect(w).toContain('!');
  expect(w).toContain('%');
});

test('Set zero (G10 L20 P1) and Go to zero (Z first, then X and Y, then Z), each confirmed', async ({ page }) => {
  const worker = await connected(page);
  await tab(page, 'jog');
  await page.locator('.sec-jog [aria-label="Step size"] button', { hasText: /^10$/ }).click();
  await page.getByRole('button', { name: 'X+, Y+', exact: true }).click();
  await idle(worker);
  await tab(page, 'zero');
  const from = (await writes(worker)).length;
  // Zero all lives on the Position readout (OD-13); the Offsets tab keeps the per-axis rows.
  await page.getByRole('button', { name: 'Set X, Y and Z work zero here' }).click();
  await expect(page.locator('[data-safety="C16"]')).toContainText('This offset is saved on the controller.');
  await expect(page.locator('[data-action="motion-cancel"]')).toBeFocused();
  await page.locator('[data-action="motion-confirm"]').click();
  await expect.poll(async () => motionWrites(worker, from)).toEqual(['G10 L20 P1 X0 Y0 Z0\n']);
  await expect(page.locator('[data-zero-offset="x"]')).not.toHaveText('—', { timeout: 5000 });

  await tab(page, 'jog');
  await page.getByRole('button', { name: 'X−', exact: true }).click();
  await idle(worker);
  await tab(page, 'zero');
  const go = (await writes(worker)).length;
  await page.getByRole('button', { name: 'Go to X, Y and Z zero' }).click();
  await expect(page.locator('[data-safety="C25"]')).toContainText('then X and Y to work 0, then Z down to work 0');
  if (SHOTS !== undefined) await shot(page, '.sec-zero', 'zero-controls');
  await page.locator('[data-action="motion-confirm"]').click();
  await idle(worker);
  const lines = await motionWrites(worker, go);
  // Explicit absolute millimetres on their own line before the G53 move, the modes put back at the end (R1).
  expect(lines[0]).toBe('G90 G21\n');
  expect(lines[1]).toMatch(/^G53 G0 Z-?\d/);
  expect(lines.slice(2)).toEqual(['G90 G0 X0 Y0\n', 'G90 G0 Z0\n', 'G90\n']);
  const p = (await board(worker)).position;
  expect(p[0]).toBeCloseTo(10, 3);
  expect(p[1]).toBeCloseTo(10, 3);
});

test('spindle on asks C24 and sends M3 S; Off sends M5; coolant mist M7 and off M9', async ({ page }) => {
  const worker = await connected(page);
  await tab(page, 'spindle');
  const from = (await writes(worker)).length;
  await page.getByRole('button', { name: 'CW', exact: true }).click();
  await expect(page.locator('[data-safety="C24"]')).toContainText('Spindle will start (CW, S10000). Hands clear?');
  if (SHOTS !== undefined) await shot(page, '.sec-spindle', 'spindle-card');
  await page.locator('[data-action="motion-confirm"]').click();
  await expect.poll(async () => (await board(worker)).spindle).toBe('cw');
  await page.getByRole('button', { name: 'Off', exact: true }).click();
  await expect.poll(async () => (await board(worker)).spindle).toBe('off');
  await page.getByRole('button', { name: 'Mist' }).click();
  await expect.poll(async () => (await board(worker)).coolant.mist).toBe(true);
  await expect(page.getByRole('button', { name: 'Mist' })).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  await page.getByRole('button', { name: 'Mist' }).click();
  await expect.poll(async () => (await board(worker)).coolant.mist).toBe(false);
  expect(await motionWrites(worker, from)).toEqual(['M3 S10000\n', 'M5\n', 'M7\n', 'M9\n']);
  await expect(page.locator('.sec-spindle .tag')).toHaveText('Commanded');
});

test('Pause holds this session\'s jog and Resume continues it; Stop job clears the queue, then spindle and coolant off', async ({ page }) => {
  const worker = await connected(page);
  await tab(page, 'jog');
  await page.locator('.sec-jog [aria-label="Step size"] button', { hasText: /^100$/ }).click();
  const from = (await writes(worker)).length;
  await page.getByRole('button', { name: 'X+', exact: true }).click();
  await expect.poll(async () => (await status(worker)).base).toBe('JOGGING');
  await expect.poll(async () => (await board(worker)).position[0] as number).toBeGreaterThan(0.5);
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'feedhold' })).toMatchObject({ ok: true });
  await expect.poll(async () => (await status(worker)).base, { timeout: 5000 }).toBe('HELD');
  expect((await status(worker)).notices.motion?.text).toBe(STOP_TEXT.paused);
  expect(await request(worker, { v: 3, kind: 'motion', command: { op: 'resume' } })).toMatchObject({ ok: true });
  await expect.poll(async () => (await motionWrites(worker, from)).includes('~')).toBe(true);
  expect((await status(worker)).notices.motion?.text).toBe(STOP_TEXT.resumed);
  await idle(worker);

  await page.locator('.sec-jog [aria-label="Step size"] button', { hasText: /^100$/ }).click();
  const stop = (await writes(worker)).length;
  await page.getByRole('button', { name: 'X−', exact: true }).click();
  await expect.poll(async () => (await status(worker)).base).toBe('JOGGING');
  await page.waitForTimeout(400);
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'stopJob' })).toMatchObject({ ok: true });
  await idle(worker);
  const w = await motionWrites(worker, stop);
  expect(w.slice(w.indexOf('!'))).toEqual(['!', '%', 'M5\n', 'M9\n', 'G90\n']);
  expect((await status(worker)).notices.motion?.text).toBe(STOP_TEXT.stopped);
  await expect(page.locator('[data-region="machine-strip"]')).toContainText(STOP_TEXT.stopped);
  expect((await board(worker)).hold).toBe(0);
  expect((await board(worker)).spindle).toBe('off');
  await expect(page.locator('body')).not.toContainText(/requested/i);
});
