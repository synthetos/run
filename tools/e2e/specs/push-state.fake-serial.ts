/**
 * Push-driven state, homing, offsets and the ways out of "state unknown" in the built app (fake-serial TEST build,
 * loopback: motion and the report configuration are on; the signed bench channel approves the simulated
 * edge-next board). Amendment 2026-11-02; SAFETY H64-H69; T-S101-T-S106 end to end:
 *
 * - connect: the full state read, the status report list written once (W35 in the Connect card), the heartbeat
 *   turned on, and then nothing written while idle;
 * - homing from the Home tab (C4, G28.2 for the configured axes only), and IDLE_HOMED;
 * - the UNKNOWN banner after a reconnect: "I've checked the machine", and "Home machine";
 * - offsets: G55 (C29), Set work zero in G55 (G10 L20 P2), a temporary offset (G92, C27) and its clear (G92.1, C28).
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;

/** Homing switches at the maximum end of X and Z, with a short travel so homing takes about a second. */
const HOMING_EEPROM = { __layout: 10002, xsx: 1, xsv: 1500, xtm: 20, zsx: 1, zsv: 1500, ztm: 10 };

interface Session {
  readonly base: string;
  readonly overlays: readonly string[];
  readonly live: { readonly coor?: number; readonly home?: number; readonly srList?: readonly string[] };
  readonly reports: { readonly phase: string; readonly heartbeatMs: number | null };
  readonly motion: unknown;
}

async function session(worker: Worker): Promise<Session> {
  return ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: Session } }).status.session;
}

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

/** Sets the options of the next simulated board (test build only). */
async function nextBoard(worker: Worker, options: Record<string, unknown>): Promise<void> {
  await worker.evaluate((o) => {
    const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
    scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
    scope.__RUN_FAKE_SERIAL__.next = o;
  }, options);
}

async function connect(page: Page, options: { readonly board?: Record<string, unknown>; readonly unknown?: boolean } = {}): Promise<Worker> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await machineWorker(page);
  if (options.board !== undefined) await nextBoard(worker, options.board);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT, ...(options.unknown === true ? { previousSessionEnded: true } : {}) })).toMatchObject({ ok: true });
  // These specs drive the Advanced pane (tabs); Simple is the default (OD-13).
  await page.locator('[data-action="ui-level-advanced"]').click();
  await expect.poll(async () => (await session(worker)).reports.phase, { timeout: 10_000 }).toBe('done');
  return worker;
}

async function tab(page: Page, id: 'home' | 'zero'): Promise<void> {
  await page.locator(`[data-tab="${id}"]`).click();
  await expect(page.locator(`#insp-pane-${id}`)).toBeVisible();
}

async function confirm(page: Page, safety: string): Promise<void> {
  const card = page.locator(`.motion-confirm[data-safety="${safety}"]`);
  await expect(card).toBeVisible();
  await card.locator('[data-action="motion-confirm"]').click();
}

test('connect reads the state once, sets the status report list (W35) and the heartbeat, then writes nothing while idle', async ({ page }) => {
  const worker = await connect(page);
  const w = await writes(worker);
  expect(w.filter((x) => x.startsWith('{sr:{'))).toHaveLength(1);
  expect(w).toContain('{"rt":{"hb":1}}\n');
  for (const t of ['mpo', 'pos', 'g92', 'coor', 'spe', 'sv', 'si']) expect(w, t).toContain(`{"${t}":null}\n`);
  const s = await session(worker);
  expect(s.reports.heartbeatMs).toBe(1000);
  expect(s.live.srList).toContain('mpox');
  await expect(page.locator('[data-reports="sr"][data-safety="W35"]')).toContainText('status report list to include machine position and spindle/coolant');
  // Wait for the settings read of the page to finish, then nothing polls.
  await page.waitForTimeout(1500);
  const quiet = (await writes(worker)).length;
  await page.waitForTimeout(4000);
  expect((await writes(worker)).slice(quiet)).toEqual([]);
  expect((await session(worker)).overlays).toEqual([]);
});

test('Home all from the Home tab: C4 names the configured axes, one G28.2, then IDLE_HOMED', async ({ page }) => {
  const worker = await connect(page, { board: { eeprom: HOMING_EEPROM } });
  await tab(page, 'home');
  const homeAll = page.locator('.sec-home button', { hasText: /^Home all$/ });
  await expect(homeAll).toBeEnabled({ timeout: 10_000 });
  await expect(page.locator('[data-home-config="y"]')).toHaveText('none');
  await expect(page.locator('[data-home-config="y"]')).toHaveAttribute('title', 'no switch is set for homing');
  const from = (await writes(worker)).length;
  await homeAll.click();
  await expect(page.locator('.motion-confirm[data-safety="C4"]')).toContainText('Home X and Z? The machine will move each axis toward its homing switch');
  await confirm(page, 'C4');
  await expect(page.locator('[data-home-state="x"]')).toHaveText('yes', { timeout: 15_000 });
  await expect(page.locator('[data-home-state="z"]')).toHaveText('yes');
  // Y has no switch, so the machine is not homed as a whole: IDLE_UNHOMED.
  await expect.poll(async () => (await session(worker)).base, { timeout: 5_000 }).toBe('IDLE_UNHOMED');
  const g = (await writes(worker)).slice(from).filter((x) => x.startsWith('G'));
  expect(g).toEqual(['G28.2 X0 Z0\n']);
});

test('after a reconnect the UNKNOWN banner offers its exits: "I\'ve checked the machine" clears it', async ({ page }) => {
  const worker = await connect(page, { unknown: true });
  const banner = page.locator('[data-region="unknown-exits"]');
  await expect(banner).toContainText('Position not verified.');
  // One click (owner, 2026-11-04): the banner's own text is the W6 confirmation.
  await banner.locator('[data-action="unknown-verify"]').click();
  await expect.poll(async () => (await session(worker)).overlays).toEqual([]);
  await expect(banner).toHaveCount(0);
});

test('the UNKNOWN banner\'s Home machine homes the configured axes and clears UNKNOWN only when X, Y and Z are homed', async ({ page }) => {
  const worker = await connect(page, { unknown: true, board: { eeprom: { ...HOMING_EEPROM, ysx: 1, ysv: 1500, ytm: 20 } } });
  const banner = page.locator('[data-region="unknown-exits"]');
  await expect(banner.locator('[data-action="unknown-home"]')).toBeVisible({ timeout: 10_000 });
  await banner.locator('[data-action="unknown-home"]').click();
  await confirm(page, 'C4');
  await expect.poll(async () => (await session(worker)).base, { timeout: 15_000 }).toBe('IDLE_HOMED');
  expect((await session(worker)).overlays).toEqual([]);
  expect((await writes(worker)).filter((x) => x.startsWith('G28.2'))).toEqual(['G28.2 X0 Y0 Z0\n']);
});

test('offsets: G55, Set work zero saved in G55, a temporary offset and its clear, each confirmed and read back', async ({ page }) => {
  const worker = await connect(page);
  await tab(page, 'zero');
  await page.locator('.sec-zero [data-machine-control="offset"]', { hasText: /^G55$/ }).click();
  await confirm(page, 'C29');
  await expect.poll(async () => (await session(worker)).live.coor).toBe(2);
  await expect(page.locator('.sec-zero')).toContainText('G10 L20, saved on the controller');
  await expect(page.locator('.sec-zero [data-offsets="system"]')).toHaveText('G55');
  await page.getByRole('button', { name: 'Set work zero for X here, saved in G55' }).click();
  await confirm(page, 'C16');
  await expect.poll(async () => (await writes(worker)).includes('G10 L20 P2 X0\n')).toBe(true);
  await expect.poll(async () => (await writes(worker)).includes('{"g55":null}\n')).toBe(true);
  await expect.poll(async () => (await session(worker)).motion).toBeNull();
  // Move Y off zero so the temporary offset is not 0.
  expect(await request(worker, { v: 3, kind: 'motion', command: { op: 'jog', axes: { y: 1 }, distanceMm: 2, feed: 1000 } })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Temporary offset: Y reads 0 here' }).click();
  await expect(page.locator('.motion-confirm[data-safety="C27"]')).toContainText('It is not saved on the controller');
  await confirm(page, 'C27');
  await expect.poll(async () => (await writes(worker)).includes('G92 Y0\n')).toBe(true);
  await expect.poll(async () => (await writes(worker)).includes('{"g92":null}\n')).toBe(true);
  await expect(page.locator('[data-offsets="temporary"]')).toContainText('in force, not saved');
  await page.getByRole('button', { name: 'Clear the temporary offset (G92.1)' }).click();
  await confirm(page, 'C28');
  await expect.poll(async () => (await writes(worker)).includes('G92.1\n')).toBe(true);
});
