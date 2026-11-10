/** "2 notes": a small pill that opens the Notes tab in the dock (notes.ts). Nothing when there are none. */
import { h, type ComponentChild } from 'preact';
import { openDockTab } from '../dock/dockRequest.ts';
import { allNotes } from './notes.ts';

export function notesCountText(n: number): string {
  return `${n} ${n === 1 ? 'note' : 'notes'}`;
}

export function NotesPill({ topic }: { readonly topic?: string } = {}): ComponentChild {
  const n = allNotes().filter((x) => topic === undefined || x.topic === topic).length;
  if (n === 0) return null;
  return h('button', { type: 'button', class: 'small notes-pill', 'data-action': 'open-notes', onClick: () => openDockTab('notes') }, notesCountText(n));
}
