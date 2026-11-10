/**
 * The dock's Notes tab (owner, 2026-11-09): one zebra row per note, Needs you first then Good to know, each with ⚠
 * or ℹ, a short bold title, one plain sentence, its button, More for the detail and × to hide it for good. The badge
 * counts the notes not hidden.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { boardTab, viewRequest } from '../../boardNavigation.ts';
import { jobStep, type JobStep } from '../../jobWorkflow.ts';
import { noteKey, notesByNeed, visibleNotes, type NoteLink, type ShownNote } from '../../notes/notes.ts';
import { dismiss } from '../../notes/Dismissable.ts';
import { noteAction } from '../../notes/noteActions.ts';
import type { DockContext, DockTab } from '../dockTab.ts';
import { openDockTab } from '../dockRequest.ts';

/** Follows a note's link: a G-code line (the scrubber moves there and the G-code tab opens), a step, Board, a view. */
function follow(link: NoteLink, ctx: DockContext): void {
  switch (link.kind) {
    case 'line': {
      const result = ctx.parts.state.status === 'ready' ? ctx.parts.state.result : null;
      const at = result === null ? -1 : result.sourceLines.findIndex((l) => l >= link.line);
      if (at >= 0) ctx.parts.actions.onScrub?.(at + 1);
      openDockTab('gcode');
      return;
    }
    case 'step':
      jobStep.value = link.step as JobStep;
      return;
    case 'board':
      boardTab.value = link.tab;
      viewRequest.value = 'board';
      return;
    case 'view':
      viewRequest.value = link.view;
      return;
    default:
      noteAction(link.action)?.();
  }
}

function linkLabel(link: NoteLink): string {
  return link.kind === 'line' ? `Line ${link.line.toLocaleString('en-US')}` : link.label;
}

const GROUP_TITLE = { needs: 'Needs you', know: 'Good to know' } as const;

/** One note: ⚠ or ℹ, a bold title, one sentence, its button, More (the detail, in place) and × (hidden for good). */
function NoteRow({ note, ctx }: { readonly note: ShownNote; readonly ctx: DockContext }): ComponentChild {
  const link = note.link ?? null;
  const action = link?.kind === 'action' ? noteAction(link.action) : null;
  const showLink = link !== null && (link.kind !== 'action' || action !== null);
  // More sits at the end of the sentence, so a closed row stays one line; the detail opens in place under it.
  const [open, setOpen] = useState(false);
  const moreId = `note-more-${note.source}-${note.id}`.replace(/[^A-Za-z0-9_-]/g, '-');
  return h(
    'li',
    { class: `note${note.tone === 'warn' ? ' warn' : ''}`, 'data-note': note.id, ...(note.safety === undefined ? {} : { 'data-safety': note.safety }) },
    h('span', { class: 'note-icon', 'aria-hidden': 'true' }, note.tone === 'warn' ? '⚠' : 'ℹ'),
    h(
      'div',
      { class: 'note-main' },
      h(
        'p',
        { class: 'note-line' },
        h('strong', null, note.title),
        note.body === '' ? null : ` ${note.body}`,
        note.detail === undefined
          ? null
          : h('button', { type: 'button', class: 'link note-more-toggle', 'data-action': 'note-more', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': moreId, onClick: () => setOpen(!open) }, open ? 'Less' : 'More'),
      ),
      note.detail === undefined ? null : h('p', { id: moreId, class: 'note-more', hidden: !open }, note.detail),
    ),
    showLink && link !== null
      ? h('button', { type: 'button', class: link.kind === 'action' ? 'small note-action' : 'link note-link', 'data-action': 'note-link', onClick: () => (link.kind === 'action' ? action?.() : follow(link, ctx)) }, linkLabel(link))
      : null,
    h('button', { type: 'button', class: 'note-dismiss', 'data-action': 'note-dismiss', 'aria-label': `Hide this note: ${note.title}`, title: 'Hide this note', onClick: () => dismiss(noteKey(note)) }, '×'),
  );
}

function NotesPane({ ctx }: { readonly ctx: DockContext; readonly active: boolean }): ComponentChild {
  const groups = notesByNeed();
  if (groups.length === 0) return h('p', { class: 'live-empty', 'data-notes': 'empty' }, 'No notes right now.');
  return h(
    'div',
    { class: 'notes-list', 'data-notes': 'list' },
    groups.map((g) =>
      h(
        'section',
        { key: g.group, class: 'notes-group', 'data-notes-group': g.group },
        h('h3', null, GROUP_TITLE[g.group]),
        h('ul', { class: 'rows' }, g.notes.map((n) => h(NoteRow, { key: `${n.source}/${n.id}`, note: n, ctx }))),
      ),
    ),
  );
}

export const notesTab: DockTab = {
  id: 'notes',
  label: 'Notes',
  badge: () => {
    const n = visibleNotes().length;
    return n === 0 ? null : n;
  },
  available: () => true,
  Pane: NotesPane,
};
