/**
 * The Run view's scene with a live board whose position is not established (preview/livePlacement.ts), in
 * the built app over the fake-serial transport: the simulated board connects unhomed at machine 0, 0, 0,
 * so the job stays as planned and the key says why. A click on a part of the scene, or the key's links,
 * opens that part's settings; an orbit drag never does, and nothing is written to the board.
 */
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;

interface StatusView {
  readonly status: { readonly session: { readonly base: string } };
}

/** Host writes to the simulated board, as text. */
function writes(worker: import('@playwright/test').Worker): Promise<string[]> {
  return worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly { kind: string; data: Uint8Array }[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports[0]?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data));
  });
}

test('unhomed at 0, 0, 0: the job is shown as planned with a note; scene parts open their settings without a write', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true, kind: 'open' });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as StatusView).status.session.base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');

  const job = page.locator('[data-screen="job"]');
  // A note in the Notes tab (owner, 2026-11-09): a short title and its sentences.
  const note = job.locator('[data-note="scene/Machine position not set."]');
  await expect(note).toContainText('Machine position not set.', { timeout: 5000 });
  await expect(note.locator('.note-line')).toContainText('The job is drawn as planned, not where the machine is.');
  await expect(note.locator('.note-more')).toContainText('the job is shown as planned, and the tool from its work position. Home or set the position to place it on the bed.');
  // Let the connect-time reads finish, then count: nothing below may write to the board.
  await page.waitForTimeout(1500);
  const before = (await writes(worker)).length;

  // The keyboard path: the key's link opens the stock settings and focuses their heading (the links are Advanced;
  // The viewer's settings menu keeps the bed's size and the hint that a click on a part opens it).
  await page.locator('[data-job-step="run"]').click();
  // The viewer's one settings menu (owner, 2026-11-09) holds the hint and the links at both levels.
  const menu = job.locator('[data-preview="viewer-menu"]');
  await menu.locator('summary').click();
  await expect(menu.locator('[data-scene="pick-hint"]')).toHaveText('Click the bed, fixture or stock to change it');
  await menu.locator('[data-scene-link="stock"]').click();
  await expect(page.locator('[data-job-step="stock"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('[data-setup-section="stock"] h2')).toBeFocused();
  await page.locator('[data-job-step="run"]').click();
  await menu.locator('summary').click();
  await menu.locator('[data-scene-link="bed"]').click();
  await expect(page.locator('[data-setup-section="bed"] h2')).toBeFocused();

  // The pointer path, with a file open (no prompt over the drawing): a drag orbits and opens nothing; a click on the middle of the scene opens a part's settings.
  await page.locator('[data-job-step="run"]').click();
  await page.locator('[data-sample="test-square"]').click();
  await expect(page.locator('[data-preview="file-name"]')).toHaveText('test-square.nc');
  await page.locator('[data-job-step="run"]').click();
  const drawing = job.locator('[data-preview="canvas"], [data-preview="svg"] svg');
  const box = await drawing.boundingBox();
  if (box === null) throw new Error('no drawing');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 10, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-job-step="run"]')).toHaveAttribute('aria-current', 'step');
  await page.locator('[data-preview="view-top"], [data-preview="fit"]').first().click();
  await page.mouse.click(cx, cy);
  await expect(page.locator('[data-job-step][aria-current="step"]')).toHaveAttribute('data-job-step', /^(machine|stock)$/);

  expect((await writes(worker)).slice(before).filter((w) => !/^\{"?[a-z0-9_]+"?:null\}\n$/.test(w) && w !== '\u0005')).toEqual([]);
  expect(await request(worker, { v: 3, kind: 'close' })).toMatchObject({ ok: true });
});
