/**
 * Pending changes belong to one board (Board settings spec §5.2, Review Focus
 * 3): they survive a tab switch and a reload, but when a different board
 * connects they are discarded, with one line saying so, so they can never be
 * applied to it.
 */
import { effect, signal, untracked, type ReadonlySignal } from '@preact/signals';
import { clearDraft, draftStore } from '../boardFacts.ts';
import { connected, type LiveView } from '../model.ts';
import { stored } from '../storage.ts';

export const DISCARDED_TEXT = 'Pending changes were for another board and were discarded.';

/** The board the pending changes were made for (its reported `id`). */
export const draftOwner = stored<string | null>('board-draft-owner.v1', null, (v): v is string | null => v === null || typeof v === 'string');

/** The one line shown after pending changes were discarded, until dismissed. */
export const discardNotice = signal<string | null>(null);

/** Pending changes go when a known board connects that is not their owner; changes with no owner are foreign too. */
export function discardOnBoardChange(owner: string | null, nextId: string | null): boolean {
  return nextId !== null && owner !== nextId;
}

/** Records the connected board as the owner of the pending changes; discards them if they belong to another. True when discarded. */
export function reconcileDrafts(boardId: string | null): boolean {
  if (boardId === null) return false;
  const owner = draftOwner.value.value;
  const pending = Object.keys(draftStore.value.value).length > 0;
  if (pending && discardOnBoardChange(owner, boardId)) {
    clearDraft();
    draftOwner.set(boardId);
    discardNotice.value = DISCARDED_TEXT;
    return true;
  }
  if (owner !== boardId) draftOwner.set(boardId);
  return false;
}

/**
 * Who owns pending changes made now: the board's reported id; a board that reports none is known only for this
 * link (`no-id@<epoch>`), so its changes never follow it to another connection. Null while not connected or not
 * identified yet (nothing to reconcile).
 */
export function boardIdOf(view: LiveView): string | null {
  const s = view.message?.snapshot;
  if (s === undefined || !connected(view) || s.identity === null || s.identity === undefined) return null;
  const id = s.identity.id;
  return typeof id === 'string' && id !== '' ? id : `no-id@${s.epoch}`;
}

/** Runs `reconcileDrafts` whenever the connected board changes. Returns the stop function. */
export function watchBoardChange(live: ReadonlySignal<LiveView>): () => void {
  return effect(() => {
    const id = boardIdOf(live.value);
    untracked(() => reconcileDrafts(id));
  });
}
