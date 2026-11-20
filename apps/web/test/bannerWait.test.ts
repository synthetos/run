/**
 * Connect on a board marked after a failed update (owner report 2026-11-20, TinyG v8 3Y2462-WWR). A TinyG prints its
 * banner once, at power-up or reset. Connect listens long enough for a person to press Reset while it waits, shows
 * the countdown, and clears the mark only on a live banner from the marked board. Before that banner nothing but the
 * AVR109 check (ESC, S) is written.
 */
import { describe, expect, it } from 'vitest';
import type { PortSelector, TransportSource } from '@synthetos/machine';
import { PHASE_1_RELEASE } from '@synthetos/safety';
import { FlashableBoard, SimEndpoint, VirtualClock } from '@synthetos/testkit';
import { memoryBootloaderMarks } from '../src/machine-worker/bootloaderMark.ts';
import { BANNER_WAIT_MS } from '../src/machine-worker/bannerWait.ts';
import { BOOTLOADER_ADVICE } from '../src/machine-worker/bootloaderAdvice.ts';
import type { FlashView } from '../src/machine-worker/flashService.ts';
import type { LiveView } from '../src/workspace/model.ts';
import { FirmwareTab } from '../src/workspace/views/FirmwareViews.ts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { MachineWorkerHost } from '../src/machine-worker/host.ts';
import type { MachineReply } from '../src/machine-worker/rpc.ts';
import { SimTransport } from './simTransport.ts';

const PORT: PortSelector = Object.freeze({ usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 });
const BOARD = 'SIM-EN-0001';
const OPEN = { v: 3, kind: 'open', port: PORT, boardId: null, previousSessionEnded: false };
const SAVED_VIEW = { id: 1, phase: 'failed', done: 3, of: 10, note: null, source: 'release', target: { fb: 450.02, label: '450.02', sha256: 'x' }, boardId: BOARD, board: { id: BOARD, hv: 99, fb: 450.01, fv: 0.97 }, countdown: null, wrote: false, message: null, recoveryOffered: true, versionCheck: null, result: null };

interface WireLine { readonly t: number; readonly dir: 'tx' | 'rx'; readonly hex: string }

/** `wrote`: the fact the mark recorded (undefined: a mark saved before marks recorded it). */
async function rig(markedId: string, wrote?: boolean) {
  const clock = new VirtualClock();
  const board = new FlashableBoard({ model: { bootMs: 50, eepromWriteMs: 0 }, linkBaud: 2_000_000 });
  const endpoint = new SimEndpoint({ clock, device: board, link: { baudRate: 2_000_000, latencyMs: 0.2, coalesceMs: 2 } });
  const source: TransportSource = { kind: 'fake', request: async () => new SimTransport(endpoint, clock, { open: 0, most: 0 }, 0) };
  const marks = memoryBootloaderMarks();
  await marks.put({ nonce: 'failed-update', kind: 'failed', port: PORT, boardId: markedId, recovery: { begin: null, view: SAVED_VIEW }, ...(wrote === undefined ? {} : { wrote }) });
  const host = new MachineWorkerHost(source, clock, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130' }, null, PHASE_1_RELEASE, marks);
  const waits: unknown[] = [];
  host.flashListener = () => waits.push(host.flash.view?.bannerWait ?? null);
  /** Runs virtual time until the reply arrives (or the limit). */
  const call = async (request: unknown, limitMs = 120_000): Promise<MachineReply | 'pending'> => {
    let reply: MachineReply | 'pending' = 'pending';
    void host.handle(request).then((r) => (reply = r));
    const end = clock.now() + limitMs;
    while (reply === 'pending' && clock.now() < end) {
      for (let i = 0; i < 40; i++) await Promise.resolve();
      if (reply !== 'pending') break;
      clock.advanceTo(Math.min(clock.nextAt() ?? end, end));
    }
    return reply;
  };
  const succeeds = async (request: unknown): Promise<void> => {
    const reply = await call(request);
    expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
  };
  /** The flash transcript's writes up to the first banner received. */
  const writesBeforeBanner = (): string[] => {
    const lines = (host.flash.flashTranscript()?.jsonl ?? '').trim().split('\n').map((l) => JSON.parse(l) as WireLine);
    let text = '';
    const bannerAt = lines.find((l) => l.dir === 'rx' && (text += Buffer.from(l.hex, 'hex').toString('latin1')).includes('"fb":'))?.t ?? Infinity;
    return lines.filter((l) => l.dir === 'tx' && l.t <= bannerAt).map((l) => l.hex);
  };
  /** Runs virtual time until `done()` (or the limit). */
  const until = async (done: () => boolean, limitMs = 30_000): Promise<boolean> => {
    const end = clock.now() + limitMs;
    while (!done() && clock.now() < end) {
      for (let i = 0; i < 40; i++) await Promise.resolve();
      if (!done()) clock.advanceTo(Math.min(clock.nextAt() ?? end, end));
    }
    return done();
  };
  return { clock, board, marks, host, waits, call, succeeds, until, writesBeforeBanner };
}

/** Board → Firmware for this flash view, on a connected board. */
function firmwarePage(flash: FlashView | null): string {
  return renderToString(h(FirmwareTab, { view: { message: { snapshot: { base: 'CONNECTED_UNKNOWN', identity: { id: BOARD }, classification: null, values: {} }, flash, flasher: true } } as unknown as LiveView }));
}

describe('Connect on a board marked after a failed update', () => {
  it('waits long enough for a person: Reset during the wait clears the mark and the session connects', async () => {
    const r = await rig(BOARD);
    // 12 s in: past the old 10 s wait. The person reads the guidance, then presses Reset.
    r.clock.setTimeout(() => r.board.resetBoard(), 12_000);
    await r.succeeds(OPEN);
    expect(await r.marks.find(PORT)).toBeNull();
    expect(r.waits).toContainEqual({ phase: 'waiting', seconds: BANNER_WAIT_MS / 1000 });
    expect(r.waits).toContainEqual({ phase: 'waiting', seconds: 20 });
    // Nothing normal before the banner: only the AVR109 check.
    expect(r.writesBeforeBanner()).toEqual(['1b', '53']);
    // Firmware runs: no Recovery, no mark note. The update may have written (an older mark: unknown), so the version
    // check runs once the board identifies: it still reports 450.01, not the 450.02 the update was writing.
    expect(await r.until(() => r.host.flash.view?.versionCheck !== null && r.host.flash.view?.versionCheck !== undefined)).toBe(true);
    expect(r.host.flash.view).toMatchObject({ phase: 'done', marked: false, recoveryOffered: false, message: null, bannerWait: null, versionCheck: { expected: 450.02, reported: 450.01, ok: false } });
    expect(r.host.flash.view?.bootloader).toBeUndefined();
    const page = firmwarePage(r.host.flash.view);
    expect(page).not.toContain('data-region="flash-recovery"');
    expect(page).not.toContain('data-region="bootloader-mark"');
    expect(page).toContain('data-version-check="differs"');
    expect(r.host.session.snapshot.base).not.toBe('NOT_CONNECTED');
  }, 60_000);

  it('a mark that says nothing was written: after the banner the page is the normal Update view', async () => {
    const r = await rig(BOARD, false);
    r.clock.setTimeout(() => r.board.resetBoard(), 5_000);
    await r.succeeds(OPEN);
    expect(await r.marks.find(PORT)).toBeNull();
    expect(r.host.flash.view).toBeNull();
    expect(firmwarePage(null)).toContain('data-region="firmware-plan"');
  }, 60_000);

  it('a banner from another board keeps its mark, shows a note about that board, and never prompts this one', async () => {
    const r = await rig('ANOTHER-BOARD');
    r.clock.setTimeout(() => r.board.resetBoard(), 12_000);
    await r.succeeds(OPEN);
    expect(await r.marks.find(PORT)).toMatchObject({ nonce: 'failed-update', boardId: 'ANOTHER-BOARD' });
    expect(r.writesBeforeBanner()).toEqual(['1b', '53']);
    // This board proved it is another board: no prompt and no Recovery for it; a note about the marked board.
    expect(r.host.flash.view).toMatchObject({ elsewhere: 'ANOTHER-BOARD', bannerWait: null });
    const page = firmwarePage(r.host.flash.view);
    expect(page).toContain('Board ANOTHER-BOARD may still be in its bootloader. Connect that board and press Reset.');
    expect(page).not.toContain('data-region="flash-recovery"');
    expect(page).not.toContain('data-banner-wait');
    // The next Connect on this port: before a banner Run cannot tell this board from the marked one (marks match by
    // the USB ids), so it listens again; after this board's banner the mark is still the other board's.
    expect(await r.call({ v: 3, kind: 'close' })).toMatchObject({ ok: true });
    const before = r.waits.length;
    r.clock.setTimeout(() => r.board.resetBoard(), 5_000);
    await r.succeeds(OPEN);
    expect(r.waits.slice(before)).toContainEqual({ phase: 'waiting', seconds: BANNER_WAIT_MS / 1000 });
    expect(await r.marks.find(PORT)).toMatchObject({ nonce: 'failed-update', boardId: 'ANOTHER-BOARD' });
    expect(r.host.flash.view).toMatchObject({ elsewhere: 'ANOTHER-BOARD', bannerWait: null });
  }, 60_000);

  it('Cancel during the wait ends it at once: the port and the lock are free, the mark is kept', async () => {
    const r = await rig(BOARD);
    let reply: MachineReply | 'pending' = 'pending';
    void r.host.handle(OPEN).then((x) => (reply = x));
    expect(await r.until(() => r.host.flash.view?.bannerWait?.phase === 'waiting', 5_000)).toBe(true);
    const started = r.clock.now();
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'cancel' } })).toMatchObject({ ok: true });
    expect(await r.until(() => reply !== 'pending', 2_000)).toBe(true);
    expect(r.clock.now() - started).toBeLessThan(2_000);
    expect(reply).toMatchObject({ ok: false });
    expect(r.host.flash.busy).toBe(false);
    expect(r.host.flash.view?.bannerWait ?? null).toBeNull();
    expect(await r.marks.find(PORT)).not.toBeNull();
    expect(r.writesBeforeBanner()).toEqual(['1b', '53']);
  }, 60_000);

  it('no banner within the wait: the advice, the mark kept, Try again listens again and a Reset then connects', async () => {
    const r = await rig(BOARD);
    expect(await r.call(OPEN)).toMatchObject({ ok: false, message: BOOTLOADER_ADVICE });
    expect(await r.marks.find(PORT)).not.toBeNull();
    // The dialog and the mark note carry the advice; the restored view does not repeat it (said once).
    expect(r.host.flash.view).toMatchObject({ phase: 'failed', marked: true, message: null, bannerWait: { phase: 'expired', seconds: 0 } });
    expect(r.writesBeforeBanner()).toEqual(['1b', '53']);
    expect(r.host.session.snapshot.base).toBe('NOT_CONNECTED');
    // Try again: the same guarded check on the same port, no port choice.
    r.clock.setTimeout(() => r.board.resetBoard(), 8_000);
    await r.succeeds({ v: 3, kind: 'flash', command: { op: 'reconnect' } });
    expect(await r.marks.find(PORT)).toBeNull();
    expect(r.host.flash.view).toMatchObject({ phase: 'done', marked: false });
    expect(r.writesBeforeBanner()).toEqual(['1b', '53']);
  }, 60_000);
});

/**
 * The restored Recovery card says whether the update wrote (safety text). The mark keeps the view from the start of
 * the update, which says nothing was written; the mark's own `wrote` fact decides. Unknown (an older mark): written.
 */
describe('a restored mark says whether the update wrote', () => {
  it.each([
    ['wrote', true, true],
    ['nothing written', false, false],
    ['unknown (an older mark)', undefined, true],
  ] as const)('%s', async (_name, fact, written) => {
    const r = await rig(BOARD, fact);
    expect(await r.call(OPEN)).toMatchObject({ ok: false });
    expect(r.host.flash.view?.wrote).toBe(written);
    const flash = { ...(r.host.flash.view as FlashView), recoveryOffered: true };
    const html = renderToString(h(FirmwareTab, { view: { message: { snapshot: { base: 'NOT_CONNECTED', identity: null, classification: null, values: {} }, flash, flasher: true } } as unknown as LiveView }));
    if (written) expect(html).toContain('No firmware running');
    // Only what Run knows: a board found in its bootloader may hold no firmware, whatever Run wrote.
    else expect(html).toContain('Run wrote nothing.');
    expect(html).not.toContain('old firmware is still there');
    if (written) expect(html).not.toContain('Nothing written');
  }, 60_000);
});
