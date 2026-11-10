/**
 * Analyze's findings as notes for the Notes tab (notes/notes.ts): the same "What to fix" items, each with what it
 * means, what to do behind More, and a link to its line. Non-blocking: a finding never stops Start. Pure.
 */
import type { Note } from '../../notes/notes.ts';
import type { Fix } from './findings.ts';

/** At most this many findings become notes (the ones Simple shows). */
export const NOTE_COUNT = 3;

export function analysisNotes(fixes: readonly Fix[]): Note[] {
  return fixes.slice(0, NOTE_COUNT).map((f) => ({
    id: `analyze-${f.id}`,
    topic: 'Analyze',
    title: f.title,
    body: f.meaning[0] ?? '',
    detail: [...f.meaning.slice(1), ...f.todo].join(' '),
    link: { kind: 'line' as const, line: f.line },
    tone: 'info' as const,
  }));
}
