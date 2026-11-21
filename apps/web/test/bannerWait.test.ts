/**
 * Connect on a board marked after a failed update (owner report 2026-11-20, TinyG v8 3Y2462-WWR). A TinyG prints its
 * banner once, at power-up or reset. Connect listens long enough for a person to press Reset while it waits, shows
 * the countdown, and clears the mark only on a live banner from the marked board. The firmware here is frozen: it
 * answers nothing, so the one line end after the AVR109 check proves nothing (markProbe.test.ts has a firmware that
 * answers). Before that banner nothing but ESC, S and that line end is written.
 */
import { describe, expect, it } from 'vitest';
import { BANNER_WAIT_MS } from '../src/machine-worker/bannerWait.ts';
import { BOOTLOADER_ADVICE } from '../src/machine-worker/bootloaderAdvice.ts';
import type { FlashView } from '../src/machine-worker/flashService.ts';
import type { LiveView } from '../src/workspace/model.ts';
import { FirmwareTab } from '../src/workspace/views/FirmwareViews.ts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { MachineReply } from '../src/machine-worker/rpc.ts';
import { BOARD, OPEN, PORT, markedBoard } from './markedBoard.ts';

/** `wrote`: the fact the mark recorded (undefined: a mark saved before marks recorded it). */
function rig(markedId: string, wrote?: boolean) {
  return markedBoard({ markedId, frozen: true, ...(wrote === undefined ? {} : { wrote }) });
}

const PROBE = ['1b', '53', '0a'];

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
    // Nothing normal before the banner: only the AVR109 check and the one line end.
    expect(r.writesBeforeBanner()).toEqual(PROBE);
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
    expect(r.writesBeforeBanner()).toEqual(PROBE);
    // This board proved it is another board: no prompt and no Recovery for it; a note about the marked board.
    expect(r.host.flash.view).toMatchObject({ elsewhere: 'ANOTHER-BOARD', bannerWait: null });
    const page = firmwarePage(r.host.flash.view);
    expect(page).toContain('Board ANOTHER-BOARD may still be in its bootloader. Connect that board and press Reset.');
    expect(page).not.toContain('data-region="flash-recovery"');
    expect(page).not.toContain('data-banner-wait');
    // The next Connect on this port (marks match by the USB ids): the firmware, running since the Reset, answers the
    // line end, and the board id the session reads is still not the marked one. No wait; the mark stays.
    expect(await r.call({ v: 3, kind: 'close' })).toMatchObject({ ok: true });
    const before = r.waits.length;
    await r.succeeds(OPEN);
    expect(r.waits.slice(before)).not.toContainEqual({ phase: 'waiting', seconds: BANNER_WAIT_MS / 1000 });
    expect(await r.until(() => r.host.flash.view?.elsewhere !== undefined && r.host.session.snapshot.identity !== null)).toBe(true);
    expect(await r.marks.find(PORT)).toMatchObject({ nonce: 'failed-update', boardId: 'ANOTHER-BOARD' });
    expect(r.host.flash.view).toMatchObject({ elsewhere: 'ANOTHER-BOARD', bannerWait: null });
  }, 60_000);
});

describe('Cancel and Disconnect while Connect waits for the banner', () => {
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
    expect(r.writesBeforeBanner()).toEqual(PROBE);
  }, 60_000);

  it('Disconnect during the wait ends it too: the port and the lock are free, the mark is kept', async () => {
    const r = await rig(BOARD);
    let reply: MachineReply | 'pending' = 'pending';
    void r.host.handle(OPEN).then((x) => (reply = x));
    expect(await r.until(() => r.host.flash.view?.bannerWait?.phase === 'waiting', 5_000)).toBe(true);
    const started = r.clock.now();
    const closed = await r.call({ v: 3, kind: 'close' });
    expect(closed, JSON.stringify(closed)).toMatchObject({ ok: true });
    expect(r.clock.now() - started).toBeLessThan(2_000);
    expect(await r.until(() => reply !== 'pending', 2_000)).toBe(true);
    expect(reply).toMatchObject({ ok: false });
    expect(r.host.flash.busy).toBe(false);
    expect(await r.marks.find(PORT)).not.toBeNull();
    expect(r.writes()).toEqual(PROBE);
  }, 60_000);
});

describe('no banner within the wait', () => {
  it('no banner within the wait: the advice, the mark kept, Try again listens again and a Reset then connects', async () => {
    const r = await rig(BOARD);
    expect(await r.call(OPEN)).toMatchObject({ ok: false, message: BOOTLOADER_ADVICE });
    expect(await r.marks.find(PORT)).not.toBeNull();
    // The dialog and the mark note carry the advice; the restored view does not repeat it (said once).
    expect(r.host.flash.view).toMatchObject({ phase: 'failed', marked: true, message: null, bannerWait: { phase: 'expired', seconds: 0 } });
    expect(r.writes()).toEqual(PROBE);
    expect(r.host.session.snapshot.base).toBe('NOT_CONNECTED');
    // Try again: the same guarded check on the same port, no port choice.
    r.clock.setTimeout(() => r.board.resetBoard(), 8_000);
    await r.succeeds({ v: 3, kind: 'flash', command: { op: 'reconnect' } });
    expect(await r.marks.find(PORT)).toBeNull();
    expect(r.host.flash.view).toMatchObject({ phase: 'done', marked: false });
    expect(r.writesBeforeBanner()).toEqual(PROBE);
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
