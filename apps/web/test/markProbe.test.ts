/**
 * Connect on a marked board whose firmware runs (owner report 2026-11-21, TinyG v8 3Y2462-WWR at 449.01). The
 * firmware is silent to the AVR109 check (ESC, S); it answers the one line end that follows, which proves it runs.
 * The board id the session then reads decides the mark. Before identification only ESC, S and that line end are
 * written on the bootloader link.
 */
import { describe, expect, it } from 'vitest';
import { BOARD, OPEN, PORT, markedBoard } from './markedBoard.ts';

describe('Connect on a marked board: the line-end probe', () => {
  it('the firmware answers: the session connects at once and the mark of this board clears', async () => {
    const r = await markedBoard({ markedId: BOARD });
    await r.succeeds(OPEN);
    expect(r.waits.some((w) => w !== null)).toBe(false);
    expect(await r.until(() => r.host.session.snapshot.identity !== null)).toBe(true);
    expect(await r.until(() => r.host.flash.view?.marked !== true)).toBe(true);
    expect(await r.marks.find(PORT)).toBeNull();
    // The bootloader link wrote ESC, S and one line end; the session's own traffic starts after it identified.
    expect(r.writes()).toEqual(['1b', '53', '0a']);
    expect(r.board.xboot.commands).toEqual([]);
    expect(r.host.session.snapshot.identity?.id).toBe(BOARD);
  }, 60_000);

  it('a mark that recorded no board id clears on any answering firmware', async () => {
    const r = await markedBoard({ markedId: null });
    await r.succeeds(OPEN);
    expect(await r.until(() => r.host.session.snapshot.identity !== null)).toBe(true);
    expect(await r.until(() => r.host.flash.view?.marked !== true)).toBe(true);
    expect(await r.marks.find(PORT)).toBeNull();
  }, 60_000);

  it('another board answers: it connects, the mark stays, and the view is the note about the marked board', async () => {
    const r = await markedBoard({ markedId: 'ANOTHER-BOARD' });
    await r.succeeds(OPEN);
    expect(await r.until(() => r.host.flash.view?.elsewhere !== undefined)).toBe(true);
    expect(await r.marks.find(PORT)).toMatchObject({ nonce: 'failed-update', boardId: 'ANOTHER-BOARD' });
    expect(r.host.flash.view).toMatchObject({ elsewhere: 'ANOTHER-BOARD', bannerWait: null });
    expect(r.writes()).toEqual(['1b', '53', '0a']);
  }, 60_000);

  it('a board found in its bootloader before (a detected mark) whose firmware now runs connects the same way', async () => {
    const r = await markedBoard({ markedId: BOARD, kind: 'detected' });
    await r.succeeds(OPEN);
    expect(await r.until(() => r.host.session.snapshot.identity !== null)).toBe(true);
    expect(await r.until(() => r.host.flash.view?.marked !== true)).toBe(true);
    expect(await r.marks.find(PORT)).toBeNull();
    expect(r.writes()).toEqual(['1b', '53', '0a']);
  }, 60_000);

  it('total silence: the mark stays, the banner wait starts, and nothing more is written while it waits', async () => {
    const r = await markedBoard({ markedId: BOARD, frozen: true });
    expect(await r.call(OPEN)).toMatchObject({ ok: false });
    expect(r.waits).toContainEqual({ phase: 'waiting', seconds: 30 });
    expect(await r.marks.find(PORT)).not.toBeNull();
    expect(r.writes()).toEqual(['1b', '53', '0a']);
    expect(r.host.session.snapshot.base).toBe('NOT_CONNECTED');
  }, 60_000);

  it('xboot answers S: the existing bootloader path, and no line end is ever sent', async () => {
    const r = await markedBoard({ markedId: BOARD, board: { start: 'bootloader' } });
    expect(await r.call(OPEN)).toMatchObject({ ok: false, message: 'The board is in its bootloader.' });
    expect(r.writes()).toEqual(['1b', '53']);
    expect(r.board.xboot.commands).toEqual([0x53]);
    expect(await r.marks.find(PORT)).not.toBeNull();
    expect(r.host.flash.view?.bootloader).toEqual({ startAllowed: false });
  }, 60_000);
});
