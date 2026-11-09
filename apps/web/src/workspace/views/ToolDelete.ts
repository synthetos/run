/**
 * Deleting a tool (first-time walk 2026-11-08, C1), with a confirmation in the page (never window.confirm): the
 * button asks, then "Delete T3 · 60° V-bit?" with Delete and Cancel (Cancel has the focus). Deleting removes it
 * from this browser's tool library only; a file's T number for it then shows as not in the library.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { deleteTool } from '../library.ts';

export function ToolDelete({ id, label, onDeleted }: { readonly id: string; readonly label: string; readonly onDeleted: () => void }): ComponentChild {
  const [asking, setAsking] = useState(false);
  if (!asking) return h('button', { type: 'button', class: 'small danger-quiet', 'data-action': 'tool-delete', onClick: () => setAsking(true) }, 'Delete tool…');
  return h(
    'div',
    { class: 'inline-confirm', role: 'group', 'aria-label': 'Delete this tool', 'data-tool-delete': 'confirm' },
    h('p', null, `Delete ${label}? It is removed from this browser's tool library.`),
    h(
      'div',
      { class: 'inline-confirm-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'tool-delete-cancel', ref: (el: HTMLButtonElement | null) => el?.focus(), onClick: () => setAsking(false) }, 'Cancel'),
      h('button', { type: 'button', class: 'small danger', 'data-action': 'tool-delete-confirm', onClick: () => { if (deleteTool(id)) onDeleted(); setAsking(false); } }, 'Delete'),
    ),
  );
}
