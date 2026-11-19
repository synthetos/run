/**
 * The edit gate (Board settings spec §5.3, §7 item 4): tightening only. A
 * read-only board refuses edits at the source, not only at Apply.
 */
import { describe, expect, it } from 'vitest';
import { INITIAL_LIVE_VIEW } from '../src/workspace/model.ts';
import { editBlocked, readOnlyNotice } from '../src/workspace/settings/editGate.ts';
import { SETTINGS_WRITES_UNAVAILABLE, settingsWriteBlocked } from '../src/workspace/settings/pending.ts';
import { boardView, OWNER_449 } from './boardViews.ts';

describe('editBlocked', () => {
  it('no board: connect first', () => {
    expect(editBlocked(null)).toBe('Connect a board to change its settings.');
    expect(editBlocked(INITIAL_LIVE_VIEW)).toBe('Connect a board to change its settings.');
  });

  it('phase switch off', () => expect(editBlocked(boardView({ settingsWrites: false }))).toBe(SETTINGS_WRITES_UNAVAILABLE));

  it('READ_ONLY board: editBlocked says "Run can\'t change settings on firmware 449.01."', () => {
    expect(editBlocked(boardView(OWNER_449))).toBe("Run can't change settings on firmware 449.01.");
  });

  it('tinyg-449-stock dialect is blocked even if the overlay list is empty', () => {
    expect(editBlocked(boardView({ dialectId: 'tinyg-449-stock', fb: 449.01, mode: 'full' }))).toBe("Run can't change settings on firmware 449.01.");
  });

  it('a 440 board (describe-only file) is blocked', () => {
    expect(editBlocked(boardView({ dialectId: 'tinyg-440', fb: 440.21 }))).toBe("Run can't change settings on firmware 440.21.");
  });

  it('a classification that is not full is blocked', () => {
    expect(editBlocked(boardView({ mode: 'readOnly' }))).toBe("Run can't change settings on firmware 450.06.");
  });

  it('waits for the read, then allows an approved board', () => {
    expect(editBlocked(boardView({ settings: {} }))).toBe('Wait for the settings read to finish.');
    expect(editBlocked(boardView())).toBeNull();
  });
});

describe('settingsWriteBlocked: inches', () => {
  it('unit 0: settingsWriteBlocked says "Set the board to millimetres (G21) to change lengths."', () => {
    expect(settingsWriteBlocked(boardView({ unit: 0 }))).toBe('Set the board to millimetres (G21) to change lengths.');
    expect(settingsWriteBlocked(boardView({ unit: 1 }))).toBeNull();
  });
});

describe('readOnlyNotice', () => {
  it('the owner\'s 449 board: one sentence, backups and the update offer', () => {
    expect(readOnlyNotice(boardView(OWNER_449))).toEqual({ text: "Run can't change settings on firmware 449.01. You can see every setting and back them up. Update the firmware to change them here.", update: true });
  });

  it('phase switch off: no update button', () => {
    expect(readOnlyNotice(boardView({ settingsWrites: false }))).toEqual({ text: 'Changing settings is not turned on here.', update: false });
  });

  it('approved board or no board: no notice', () => {
    expect(readOnlyNotice(boardView())).toBeNull();
    expect(readOnlyNotice(null)).toBeNull();
  });
});
