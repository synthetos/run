/**
 * The dock's Notes tab: every explanatory note that applies now (notes/notes.ts), grouped by topic, newest first,
 * each with a link to where it applies. The badge counts them.
 */
import { h, type ComponentChild } from 'preact';
import { boardTab, viewRequest } from '../../boardNavigation.ts';
import { jobStep, type JobStep } from '../../jobWorkflow.ts';
import { allNotes, notesByTopic, type NoteLink } from '../../notes/notes.ts';
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
    default:
      viewRequest.value = link.view;
  }
}

function linkLabel(link: NoteLink): string {
  return link.kind === 'line' ? `Line ${link.line.toLocaleString('en-US')}` : link.label;
}

function NotesPane({ ctx }: { readonly ctx: DockContext; readonly active: boolean }): ComponentChild {
  const groups = notesByTopic();
  if (groups.length === 0) return h('p', { class: 'live-empty', 'data-notes': 'empty' }, 'No notes right now.');
  return h(
    'div',
    { class: 'notes-list', 'data-notes': 'list' },
    groups.map((g) =>
      h(
        'section',
        { key: g.topic, class: 'notes-group', 'data-notes-topic': g.topic },
        h('h3', null, g.topic),
        h(
          'ul',
          { class: 'rows' },
          g.notes.map((n) =>
            h(
              'li',
              { key: `${n.source}:${n.id}`, class: `note${n.tone === 'warn' ? ' warn' : ''}`, 'data-note': n.id },
              h('strong', null, n.title),
              ' ',
              h('span', null, n.body),
              n.link === undefined ? null : h('button', { type: 'button', class: 'link note-link', 'data-action': 'note-link', onClick: () => follow(n.link as NoteLink, ctx) }, linkLabel(n.link)),
            ),
          ),
        ),
      ),
    ),
  );
}

export const notesTab: DockTab = {
  id: 'notes',
  label: 'Notes',
  badge: () => {
    const n = allNotes().length;
    return n === 0 ? null : n;
  },
  available: () => true,
  Pane: NotesPane,
};
