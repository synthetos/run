/**
 * The Notes tab (owner, 2026-11-09): one row per note with ⚠ or ℹ, a title and one sentence, its button, More and ×;
 * Needs you first, then Good to know; a hidden note leaves the list and the count. The work zero note says what the
 * difference means, never a dump of coordinates.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { notesTab } from '../src/workspace/dock/tabs/notesTab.ts';
import { noteKey, publishNotes, resetNotes, visibleNotes } from '../src/workspace/notes/notes.ts';
import { dismiss, resetDismissed } from '../src/workspace/notes/Dismissable.ts';
import { zeroNote } from '../src/workspace/run/zeroNote.ts';
import type { DockContext } from '../src/workspace/dock/dockTab.ts';
import type { RunZeroCheck } from '../src/workspace/zeroPlan.ts';

const ctx = { parts: { state: { status: 'idle' }, actions: {} }, model: null, advanced: false } as unknown as DockContext;
const render = (): string => renderToString(h(notesTab.Pane, { ctx, active: true }));

describe('the Notes tab', () => {
  it('Needs you first, then Good to know; each row has its icon, title, sentence, More and ×', () => {
    resetNotes();
    resetDismissed();
    publishNotes('t', [
      { id: 'a', topic: 'x', title: 'File checked.', body: '29,717 lines, about 6 h 01 min.', detail: 'Checked with this board: the file’s 29,710 lines with commands.', tone: 'info' },
      { id: 'b', topic: 'x', title: 'Stay at the machine.', body: 'If this tab closes or sleeps…', tone: 'warn', safety: 'W5' },
    ]);
    const html = render();
    expect(html.indexOf('Needs you')).toBeLessThan(html.indexOf('Good to know'));
    expect(html).toMatch(/data-note="b" data-safety="W5"[^>]*><span class="note-icon"[^>]*>⚠</);
    expect(html).toMatch(/data-note="a"[^>]*><span class="note-icon"[^>]*>ℹ</);
    expect(html).toMatch(/data-action="note-more" aria-expanded="false"[^>]*>More</);
    expect(html).toMatch(/class="note-more" hidden[^>]*>Checked with this board/);
    expect((html.match(/data-action="note-dismiss"/g) ?? []).length).toBe(2);
    expect(notesTab.badge?.(ctx)).toBe(2);
  });

  it('a hidden note leaves the list and the count, for good', () => {
    dismiss(noteKey({ source: 't', id: 'b' }));
    expect(visibleNotes().map((n) => n.id)).toEqual(['a']);
    expect(notesTab.badge?.(ctx)).toBe(1);
    expect(render()).not.toContain('Stay at the machine.');
    resetNotes();
    resetDismissed();
  });
});

describe('the work zero note', () => {
  const base = { board: { x: 31, y: 0, z: 10 }, plan: { x: 160, y: 120, z: 37 }, planText: 'x', source: 'setup' as const };
  it('says how far, not the coordinates; Home when it can’t compare yet; matches say so', () => {
    const far = zeroNote({ ...base, state: 'differs', text: 'The board’s work zero (X 31.000 Y 0.000 Z 10.000 (machine)) …' } as RunZeroCheck, true, true);
    expect(far.body).toBe('Your work zero is 178 mm from where you planned it.');
    expect(far.body).not.toMatch(/X \d/);
    expect(far.detail).toContain('X 31.000');
    const unhomed = zeroNote({ ...base, state: 'differs', text: 'not comparable' } as RunZeroCheck, false, true);
    expect(unhomed).toMatchObject({ body: 'Can’t compare until the machine is homed.', link: { kind: 'action', action: 'home', label: 'Home' } });
    const noHoming = zeroNote({ ...base, state: 'differs', text: 'x' } as RunZeroCheck, false, false);
    expect(noHoming.body).toBe('Can’t compare until the machine position is set.');
    expect(noHoming.link).toBeUndefined();
    expect(zeroNote({ ...base, state: 'match', text: 'x' } as RunZeroCheck, true, true)).toMatchObject({ title: 'Work zero matches your plan.', tone: 'info' });
  });
});
