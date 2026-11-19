/**
 * Pending changes at the bottom of the Board view (Board settings spec §5.2):
 * a sticky bar, a review panel with today's diff and C5, and pending changes
 * that never follow a different board.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { signal } from '@preact/signals';
import type { PlannedChange } from '@synthetos/schema';
import { clearDraft, draftStore, setDraft } from '../src/workspace/boardFacts.ts';
import { uiLevel } from '../src/workspace/jobWorkflow.ts';
import type { LiveView, WorkspaceModel } from '../src/workspace/model.ts';
import { ApplyConfirm } from '../src/workspace/settings/SettingsUi.ts';
import { boardIdOf, DISCARDED_TEXT, discardNotice, discardOnBoardChange, draftOwner, reconcileDrafts, watchBoardChange } from '../src/workspace/settings/boardChange.ts';
import { PendingBar } from '../src/workspace/settings/PendingBar.ts';
import { pendingByTab } from '../src/workspace/settings/pendingTabs.ts';
import { ReviewPanel } from '../src/workspace/settings/ReviewPanel.ts';
import { confirming, reviewOpen } from '../src/workspace/settings/reviewState.ts';
import { all, byAttr, one, rootUntil, text, type El } from './tree.ts';
import { boardView } from './boardViews.ts';

const OWNER_449_VIEW = { dialectId: 'tinyg-449-stock', fb: 449.01, readOnly: true } as const;
const BOARD = { xsn: 1, xsx: 2, ysn: 1, ysx: 2, zsn: 0, zsx: 1, asn: 0, asx: 0, st: 0, xjd: 0.05, '1mi': 8, '2mi': 8 };

function fakeModel(view: LiveView | null): { model: WorkspaceModel; applied: PlannedChange[][] } {
  const applied: PlannedChange[][] = [];
  const actions = { applySettings: (c: readonly PlannedChange[]) => { applied.push([...c]); }, revertSettings: () => undefined, clearApply: () => undefined };
  return { model: { live: signal(view), actions: signal(actions) } as unknown as WorkspaceModel, applied };
}

const bar = (view: LiveView | null): El | null => {
  const node = h(PendingBar, { model: fakeModel(view).model });
  try {
    return rootUntil(node, [ApplyConfirm]);
  } catch {
    return null;
  }
};
const click = (el: El, action: string): void => (one(el, byAttr('data-action', action)).props['onClick'] as () => void)();

beforeEach(() => {
  clearDraft();
  reviewOpen.value = false;
  confirming.value = false;
  discardNotice.value = null;
  draftOwner.set(null);
});

describe('PendingBar', () => {
  it('no bar without pending changes or a run in progress', () => {
    expect(bar(boardView({ settings: BOARD }))).toBeNull();
  });

  it('one change: shows its consequence; Review and apply opens the panel with the diff row', () => {
    setDraft('xsn', 3);
    const el = bar(boardView({ settings: BOARD })) as El;
    expect(text(one(el, byAttr('data-pending-count')))).toBe('1 change pending');
    expect(text(el)).toContain('1 high risk');
    expect(text(one(el, byAttr('data-pending-one')))).toContain('Changing the X min switch from Homing to Homing and limit');
    click(el, 'review-apply');
    expect(reviewOpen.value).toBe(true);
    const panel = rootUntil(h(ReviewPanel, { model: fakeModel(boardView({ settings: BOARD })).model }), [ApplyConfirm]);
    expect(panel.props['data-region']).toBe('pending-changes');
    const row = one(panel, byAttr('data-pending-key', 'xsn'));
    expect(text(row)).toContain('Homing and limit');
    expect(row.props['class']).toBe('high-risk');
  });

  it('several changes: the count and high-risk count, no single consequence', () => {
    setDraft('xsn', 3);
    setDraft('xjd', 0.02);
    const el = bar(boardView({ settings: BOARD })) as El;
    expect(text(one(el, byAttr('data-pending-count')))).toBe('2 changes pending');
    expect(all(el, byAttr('data-pending-one'))).toEqual([]);
  });

  it('Review and apply is disabled with the editBlocked or settingsWriteBlocked reason as its title', () => {
    setDraft('xjd', 0.02);
    const inches = bar(boardView({ settings: BOARD, unit: 0 })) as El;
    expect(one(inches, byAttr('data-action', 'review-apply')).props).toMatchObject({ disabled: true, title: 'Set the board to millimetres (G21) to change lengths.' });
    const unread = bar(boardView({ settings: {} })) as El;
    expect(one(unread, byAttr('data-action', 'review-apply')).props).toMatchObject({ disabled: true, title: 'Wait for the settings read to finish.' });
    const ready = bar(boardView({ settings: BOARD })) as El;
    expect(one(ready, byAttr('data-action', 'review-apply')).props['disabled']).toBe(false);
  });

  it('a refused change: the bar says it can\'t be applied, Review opens, and the panel lists the reason (review finding 3)', () => {
    setDraft('xjd', 0.02);
    setDraft('xvm', -5);
    const el = bar(boardView({ settings: { ...BOARD, xvm: 16000 } })) as El;
    expect(text(one(el, byAttr('data-pending-refused')))).toBe("1 change can't be applied. Review it.");
    const review = one(el, byAttr('data-action', 'review-apply'));
    expect(review.props['disabled']).toBe(false);
    click(el, 'review-apply');
    expect(reviewOpen.value).toBe(true);
    const panel = rootUntil(h(ReviewPanel, { model: fakeModel(boardView({ settings: { ...BOARD, xvm: 16000 } })).model }), [ApplyConfirm]);
    const refusedList = one(panel, (e) => e.props['class'] === 'tray-refused');
    expect(text(refusedList)).toContain('X maximum velocity');
    // Simple shows no token (OD-44); Advanced puts it beside the words.
    expect(all(refusedList, (e) => e.tag === 'code')).toEqual([]);
    uiLevel.set('advanced');
    const adv = rootUntil(h(ReviewPanel, { model: fakeModel(boardView({ settings: { ...BOARD, xvm: 16000 } })).model }), [ApplyConfirm]);
    expect(text(one(one(adv, (e) => e.props['class'] === 'tray-refused'), (e) => e.tag === 'code'))).toBe('xvm');
    uiLevel.set('simple');
    expect(one(panel, byAttr('data-action', 'apply-settings')).props['disabled']).toBe(true);
    // Nothing to apply reads "Apply", never "Apply 0 changes" (lead review, refused picture).
    expect(text(one(panel, byAttr('data-action', 'apply-settings')))).toBe('Apply');
  });

  it('a read-only board with leftover pending changes gets the bar with Discard only, no Review (review finding 4)', () => {
    expect(bar(boardView({ dialectId: 'tinyg-449-stock', fb: 449.01, readOnly: true, settings: BOARD }))).toBeNull();
    setDraft('xsn', 3);
    const el = bar(boardView({ dialectId: 'tinyg-449-stock', fb: 449.01, readOnly: true, settings: BOARD })) as El;
    expect(text(one(el, byAttr('data-pending-count')))).toBe('1 change pending');
    expect(text(one(el, byAttr('data-pending-readonly')))).toBe("Run can't apply it on this board. Discard it.");
    expect(all(el, byAttr('data-action', 'review-apply'))).toEqual([]);
    expect(all(el, byAttr('data-pending-one'))).toEqual([]);
    reviewOpen.value = true;
    expect(() => rootUntil(h(ReviewPanel, { model: fakeModel(boardView({ ...OWNER_449_VIEW, settings: BOARD })).model }), [ApplyConfirm])).toThrow();
    click(el, 'discard-pending');
    expect(draftStore.value.value).toEqual({});
  });

  it('Discard clears every pending change', () => {
    setDraft('xsn', 3);
    click(bar(boardView({ settings: BOARD })) as El, 'discard-pending');
    expect(draftStore.value.value).toEqual({});
  });
});

describe('ReviewPanel', () => {
  it('apply calls model.actions.applySettings only after ApplyConfirm confirms', () => {
    setDraft('xsn', 3);
    reviewOpen.value = true;
    const { model, applied } = fakeModel(boardView({ settings: BOARD }));
    const panel = rootUntil(h(ReviewPanel, { model }), [ApplyConfirm]);
    click(panel, 'apply-settings');
    expect(applied).toEqual([]);
    expect(confirming.value).toBe(true);
    const dialog = one(rootUntil(h(ReviewPanel, { model }), [ApplyConfirm]), (e) => e.tag === 'ApplyConfirm');
    (dialog.props['onConfirm'] as () => void)();
    expect(applied).toHaveLength(1);
    expect(applied[0]?.map((c) => [c.key, c.to])).toEqual([['xsn', 3]]);
    expect(confirming.value).toBe(false);
  });

  it('keeps the remove action per row and the ready line', () => {
    setDraft('xjd', 0.02);
    reviewOpen.value = true;
    const panel = rootUntil(h(ReviewPanel, { model: fakeModel(boardView({ settings: BOARD })).model }), [ApplyConfirm]);
    expect(one(panel, byAttr('data-settings-write')).props['data-settings-write']).toBe('ready');
    click(panel, 'remove-pending');
    expect(draftStore.value.value).toEqual({});
  });
});

describe('a different board', () => {
  it('discardOnBoardChange: a known board that is not the owner, or pending changes with no owner (review finding 6)', () => {
    expect(discardOnBoardChange('A', 'B')).toBe(true);
    expect(discardOnBoardChange('A', 'A')).toBe(false);
    expect(discardOnBoardChange(null, 'B')).toBe(true);
    expect(discardOnBoardChange('A', null)).toBe(false);
  });

  it('pending changes with no owner are dropped with the discard line when a board connects (review finding 6)', () => {
    setDraft('xsn', 3);
    draftOwner.set(null);
    expect(reconcileDrafts('SIM-EN-0001')).toBe(true);
    expect(draftStore.value.value).toEqual({});
    expect(discardNotice.value).toBe(DISCARDED_TEXT);
    expect(draftOwner.value.value).toBe('SIM-EN-0001');
  });

  it('a board without an id still reconciles: it is never the owner of another board\'s pending changes (review finding 6)', () => {
    const noId = boardView({ id: '', settings: BOARD });
    expect(boardIdOf(noId)).toBe('no-id@1');
    expect(boardIdOf(boardView({ settings: BOARD }))).toBe('SIM-EN-0001');
    reconcileDrafts('SIM-EN-0001');
    setDraft('xsn', 3);
    const stop = watchBoardChange(signal(noId));
    stop();
    expect(draftStore.value.value).toEqual({});
    expect(discardNotice.value).toBe(DISCARDED_TEXT);
  });

  it('a different board id discards pending changes and shows "Pending changes were for another board and were discarded."', () => {
    reconcileDrafts('SIM-EN-0001');
    setDraft('xsn', 3);
    reconcileDrafts('SIM-EN-0001');
    expect(draftStore.value.value).toEqual({ xsn: 3 });
    reconcileDrafts(null);
    expect(draftStore.value.value).toEqual({ xsn: 3 });
    expect(reconcileDrafts('OTHER-BOARD')).toBe(true);
    expect(draftStore.value.value).toEqual({});
    expect(discardNotice.value).toBe('Pending changes were for another board and were discarded.');
    expect(DISCARDED_TEXT).toBe(discardNotice.value);
    expect(draftOwner.value.value).toBe('OTHER-BOARD');
  });
});

describe('tab badges', () => {
  it('tab badges count pending keys per tab from the definitions', () => {
    setDraft('xsn', 3);
    setDraft('st', 1);
    setDraft('xjd', 0.02);
    setDraft('1mi', 4);
    setDraft('gun', 0);
    expect(pendingByTab(boardView({ settings: BOARD }))).toEqual({ inputs: 2, axes: 1, motors: 1, settings: 1 });
  });
});
