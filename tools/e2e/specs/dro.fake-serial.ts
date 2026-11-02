/**
 * ROADMAP P1-07 acceptance: "E2E with the mock serial: the marker moves only
 * on polled reads", in the built app.
 *
 * Runs against the fake-serial TEST build: the production worker, session
 * and page over a test-kit `MockSerialPort` and simulated edge-next board.
 * The test moves the simulated machine as another program would (a test
 * hook on the model), then checks that the DRO's machine position and the
 * polled value change only after a further `{"mpo":null}` GET, and that the
 * page read the settings through the allowlist and recorded a reference.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;

interface StatusView {
  readonly status: { readonly session: { readonly base: string; readonly values: Record<string, { value: unknown; status: number } | undefined> } };
}

/** Host writes to the simulated board, as text. */
function writes(worker: import('@playwright/test').Worker): Promise<string[]> {
  return worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly { kind: string; data: Uint8Array }[] } } }[] } }).__RUN_FAKE_SERIAL__;
    const port = registry?.ports[0];
    if (port === undefined) return [];
    return port.endpoint.transcript
      .entries()
      .filter((e) => e.kind === 'host-write')
      .map((e) => String.fromCharCode(...e.data));
  });
}

test('the DRO machine position and the marker move only on polled mpo reads; settings are read through the allowlist', async ({ page }) => {
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true, kind: 'open' });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as StatusView).status.session.base, { timeout: 10_000 }).toBe('CONNECTED_UNKNOWN');

  // The poller reads mpo; the DRO shows it with its source.
  const dro = page.locator('[data-region="dro"]');
  const machineX = dro.locator('tr[data-axis="x"] [data-dro="machine"]');
  await expect(machineX).toHaveText('0.000', { timeout: 5000 });
  await expect(dro).toContainText('polled mpo');

  // Another program moves the machine. Nothing has been polled since: the DRO still shows the old value.
  const before = (await writes(worker)).filter((w) => w === '{"mpo":null}\n').length;
  await worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__: { ports: { endpoint: { device: { setMachinePosition(p: Record<string, number>): void } } }[] } }).__RUN_FAKE_SERIAL__;
    registry.ports[0]?.endpoint.device.setMachinePosition({ x: 12.5, y: -3 });
  });
  await expect(machineX).toHaveText('12.500', { timeout: 5000 });
  const after = await writes(worker);
  expect(after.filter((w) => w === '{"mpo":null}\n').length).toBeGreaterThan(before);

  // The settings were read through the allowlist (group GETs only) and recorded as this computer's reference.
  // Stage 1 workspace: they are on the Board view's Settings tab.
  await page.locator('[data-region="rail"] [data-view="board"]').click();
  await page.locator('[data-board-tab="settings"]').click();
  await expect(page.locator('[data-settings="recorded"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('details[data-group="x"]')).toContainText('How the X axis moves');
  // Row 35 / BENCH-P100-5: the axis-mode facts are rendered from the same read (the simulated board's modes), not hidden.
  const axisModes = page.locator('[data-region="axis-modes"]');
  await expect(axisModes).toBeVisible();
  await expect(axisModes.locator('[data-axis-modes="clear"], [data-axis-modes="facts"]')).toHaveCount(1);
  for (const w of after) {
    expect(w.includes('\u0018') || w.includes('\u0004'), JSON.stringify(w)).toBe(false);
    expect(/^\{"?[a-z0-9_]+"?:null\}\n$/.test(w) || w === '\u0005', JSON.stringify(w)).toBe(true);
  }
  for (const denied of ['{"md":null}\n', '{"me":null}\n', '{"clear":null}\n']) expect(after).not.toContain(denied);

  // P1-08: Save transcript downloads (Run view, Console tab) the worker's {t, dir, hex} JSONL with a dated name, next to the board-id warning.
  await page.locator('[data-region="rail"] [data-view="run"]').click();
  await page.locator('[data-tab="console"]').click();
  await expect(page.locator('[data-console="lines"]')).toContainText('{sr:null}');
  const save = page.locator('[data-region="transcript"]');
  await expect(save.locator('[data-transcript="privacy"]')).toContainText('unique hardware id');
  const download = page.waitForEvent('download');
  await save.locator('[data-action="save-transcript"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^run-transcript-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.jsonl$/);
  const text = await readFile(await file.path(), 'utf8');
  const events = text.trim().split('\n').map((l) => JSON.parse(l) as { t: number; dir: string; hex: string });
  const tx = events.filter((e) => e.dir === 'tx').map((e) => Buffer.from(e.hex, 'hex').toString('latin1'));
  expect(tx[0]).toBe('{sr:null}\n');
  for (const w of tx) expect(/^\{"?[a-z0-9_]+"?:null\}\n$/.test(w) || w === '\u0005' || w === '!', JSON.stringify(w)).toBe(true);
  expect(events.some((e) => e.dir === 'rx')).toBe(true);
  await expect(save.locator('[data-transcript="saved"]')).toContainText(file.suggestedFilename());

  expect(await request(worker, { v: 3, kind: 'close' })).toMatchObject({ ok: true });
});
