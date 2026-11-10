/**
 * The Terminal (H91, OD-31) in the built app (fake-serial TEST build, loopback: motion on, the simulated edge-next
 * board approved). Every typed line takes the path of the button that does the same thing:
 *
 * - `g0 x10` is a typed move: the first-move notice, then (Z is not homed on the sim) "Z is low" with only Move as
 *   typed and Cancel; Move as typed sends the line (as its pieces `G0 X5`, `G0 X10`) and the board moves there;
 * - `g1 x40 f600` goes as the sanitiser's pieces; a typed `!` presses the real Pause (the board holds), a typed `~`
 *   presses Resume and the move finishes at X40;
 * - `M3 S12000` asks the Spindle button's C24 first; confirmed, the spindle runs; `M5` turns it off.
 *
 * Offered in Simple (the default level), beside the wire transcript. The page is not LIVE (the worker is opened
 * directly, as in the other fake-serial specs), so Pause goes to the worker as a stop request, as from the strip.
 * With RUN_SCREENSHOTS_DIR set, the walkthrough is captured at 1440 px in light and dark.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

interface Session {
  readonly base: string;
  readonly reports: { readonly phase: string };
  readonly motion: { readonly op: string; readonly phase: string; readonly held: boolean } | null;
}

async function session(worker: Worker): Promise<Session> {
  return ((await request(worker, { v: 3, kind: 'status' })) as { readonly status: { readonly session: Session } }).status.session;
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

/** The lines and realtime bytes written since `from` (no GETs, no ENQ). */
async function motionWrites(worker: Worker, from: number): Promise<string[]> {
  return (await writes(worker)).slice(from).filter((w) => !w.startsWith('{"') && w !== '{sr:null}\n' && w !== '\x05');
}

function board(worker: Worker): Promise<{ position: number[]; hold: number; spindle: string }> {
  return worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: { snapshot(): unknown } } }[] } }).__RUN_FAKE_SERIAL__;
    return registry?.ports.at(-1)?.endpoint.device.snapshot() as { position: number[]; hold: number; spindle: string };
  });
}

async function connected(page: Page): Promise<Worker> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  await expect.poll(async () => (await session(worker)).reports.phase, { timeout: 10_000 }).toBe('done');
  return worker;
}

async function type(page: Page, line: string): Promise<void> {
  const input = page.locator('[data-terminal="input"]');
  await input.fill(line);
  await input.press('Enter');
}

async function shot(page: Page, name: string, theme: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/terminal-${name}-1440-${theme}.png` });
}

for (const theme of ['light', 'dark'] as const) {
  test(`typed moves, Pause and Resume, and M3 take the buttons' paths (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme });
    const worker = await connected(page);
    // Simple is the default level: the Terminal is offered there.
    await page.locator('[data-tab="terminal"]').click();
    await expect(page.locator('[data-region="terminal"]')).toBeVisible();
    await expect(page.locator('[data-terminal="modes"]')).toHaveText('mm · absolute · G54');
    await shot(page, '1-empty', theme);

    // g0 x10: the notice once, then "Z is low" (Z not homed here: Move as typed or Cancel, and why).
    const input = page.locator('[data-terminal="input"]');
    await input.fill('g0 x10');
    await expect(page.locator('[data-terminal="preview"]')).toHaveText('Rapid: moves X to 10 mm (absolute, G54)');
    let from = (await writes(worker)).length;
    await input.press('Enter');
    await expect(page.locator('[data-terminal="log"]')).toContainText('Typed moves run straight on the machine. Stop is the red button or Esc.');
    const lowZ = page.locator('[data-region="terminal-low-z"]');
    await expect(lowZ).toBeVisible({ timeout: 10_000 });
    await expect(lowZ).toContainText("Z wasn't homed in this connection");
    await expect(lowZ.locator('[data-action="terminal-lowz-raise"]')).toHaveCount(0);
    await shot(page, '2-low-z', theme);
    await lowZ.locator('[data-action="terminal-lowz-asTyped"]').click();
    await expect.poll(async () => (await board(worker)).position[0], { timeout: 15_000 }).toBeCloseTo(10, 2);
    await expect(page.locator('[data-terminal="log"]')).toContainText('G0 X10: Done.', { timeout: 10_000 });
    // The line as the sanitiser's pieces (each at most 1.25 s modelled; the sim's X runs at 800 mm/min).
    expect(await motionWrites(worker, from)).toEqual(['G0 X5\n', 'G0 X10\n']);
    await shot(page, '3-moved', theme);

    // g1 x40 f600: pieces; a typed ! presses Pause, a typed ~ presses Resume.
    from = (await writes(worker)).length;
    await type(page, 'g1 x40 f600');
    await expect.poll(async () => (await session(worker)).motion?.phase ?? '', { timeout: 10_000 }).toMatch(/^(feed|drain)$/);
    await type(page, '!');
    await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('HELD');
    const heldAt = (await board(worker)).position[0] as number;
    expect(heldAt).toBeLessThan(40);
    await expect(page.locator('[data-terminal="running"]')).toContainText('Paused');
    await shot(page, '4-paused', theme);
    await type(page, '~');
    await expect.poll(async () => (await board(worker)).position[0], { timeout: 15_000 }).toBeCloseTo(40, 2);
    await expect(page.locator('[data-terminal="log"]')).toContainText('G1 X40 F600: Done.', { timeout: 10_000 });
    const g1 = await motionWrites(worker, from);
    // Each piece once, in order, ending at X40 (the sanitiser's split; at most 4 in the planner).
    const pieces = g1.filter((w) => w.includes('G1'));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0]).toMatch(/^F600 G1 X/);
    expect(pieces.at(-1)).toBe('G1 X40\n');
    expect(new Set(pieces).size).toBe(pieces.length);
    expect(g1).toContain('!');
    expect(g1).toContain('~');

    // M3 S12000: the Spindle button's C24 first.
    await type(page, 'M3 S12000');
    const c24 = page.locator('[data-safety="C24"]');
    await expect(c24).toBeVisible();
    await expect(c24).toContainText('12000');
    await shot(page, '5-c24', theme);
    await c24.locator('[data-action="motion-confirm"]').click();
    await expect.poll(async () => (await board(worker)).spindle, { timeout: 10_000 }).toBe('cw');
    await type(page, 'M5');
    await expect.poll(async () => (await board(worker)).spindle, { timeout: 10_000 }).toBe('off');

    // A typo gets help; history comes back with the up arrow.
    await type(page, 'gt0x10');
    await expect(page.locator('[data-terminal-entry="error"]').last()).toContainText('Did you mean g0x10?');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('gt0x10');
    await input.fill('');
    await shot(page, '6-transcript', theme);
  });
}
