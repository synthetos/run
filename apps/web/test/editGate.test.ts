/**
 * The edit gate (Board settings spec §5.3, §7 item 4): tightening only. A
 * read-only board refuses edits at the source, not only at Apply.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { signal } from '@preact/signals';
import { boardTab } from '../src/workspace/boardNavigation.ts';
import { INITIAL_LIVE_VIEW, type LiveView, type WorkspaceModel } from '../src/workspace/model.ts';
import { BoardNotices } from '../src/workspace/settings/BoardNotices.ts';
import { editBlocked, readOnlyNotice } from '../src/workspace/settings/editGate.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';
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

/** A connected board whose classification is not known yet (identifying). */
function identifying(): LiveView {
  const v = boardView();
  const m = v.message as NonNullable<LiveView['message']>;
  return { ...v, message: { ...m, snapshot: { ...m.snapshot, classification: null } } };
}

describe('the read-only notice\'s Back up settings (review finding 11)', () => {
  const notice = (v: LiveView): El => one(root(h(BoardNotices, { model: { live: signal(v), actions: signal({ backup: () => undefined }) } as unknown as WorkspaceModel })), byAttr('data-action', 'notice-backup'));

  it('follows backupBlocked: disabled with its reason when the board cannot be read now', () => {
    const v = boardView(OWNER_449);
    const m = v.message as NonNullable<LiveView['message']>;
    const busy = { ...v, message: { ...m, snapshot: { ...m.snapshot, base: 'RUNNING' } } } as LiveView;
    expect(notice(busy).props).toMatchObject({ disabled: true, title: 'Wait until the board is identified, read and at rest.' });
    expect(notice(v).props['disabled']).toBe(false);
  });

  it('is left out on the Backups tab, which has its own Back up settings (lead review, doubled control)', () => {
    const notices = (): El => root(h(BoardNotices, { model: { live: signal(boardView(OWNER_449)), actions: signal({ backup: () => undefined }) } as unknown as WorkspaceModel }));
    boardTab.value = 'backups';
    expect(all(notices(), byAttr('data-action', 'notice-backup'))).toEqual([]);
    // No updater and no release list in this view: no Update firmware that could not act (owner 169, updateStart.test.ts).
    expect(all(notices(), byAttr('data-action', 'notice-update'))).toEqual([]);
    boardTab.value = 'overview';
    expect(all(notices(), byAttr('data-action', 'notice-backup'))).toHaveLength(1);
  });
});

describe('classification not known yet (review finding 8)', () => {
  it('controls stay locked with the neutral "Reading the board…", and no read-only notice', () => {
    expect(editBlocked(identifying())).toBe('Reading the board…');
    expect(readOnlyNotice(identifying())).toBeNull();
  });

  it('the Board notices say "Reading the board…" with no buttons', () => {
    const model = { live: signal(identifying()), actions: signal(null) } as unknown as WorkspaceModel;
    const el = root(h(BoardNotices, { model }));
    const line = one(el, byAttr('data-region', 'board-reading'));
    expect(text(line)).toBe('Reading the board…');
    expect(all(el, (e) => e.tag === 'button')).toEqual([]);
  });
});
