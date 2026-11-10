/**
 * The page's notes (owner, 2026-11-09: "a page ... next to live job that can put notes about the state if the user
 * wants to read it, not just everywhere on the UI"). Views publish the explanatory, non-blocking notes that apply now
 * under their own source name; the Notes tab in the dock reads them all. A source that publishes again replaces its
 * notes, so a note that no longer applies goes away. Blockers, the one start confirmation and the warnings SAFETY
 * requires at the point of action are never notes. Presentation only.
 */
import { signal } from '@preact/signals';
import type { BoardTab } from '../boardNavigation.ts';

/** Where a note applies: a line in the G-code list, a Job step, a Board tab, or another view. */
export type NoteLink =
  | { readonly kind: 'line'; readonly line: number }
  | { readonly kind: 'step'; readonly step: string; readonly label: string }
  | { readonly kind: 'board'; readonly tab: BoardTab; readonly label: string }
  | { readonly kind: 'view'; readonly view: string; readonly label: string };

export interface Note {
  /** Stable while the note says the same thing (it keeps its place in the list). */
  readonly id: string;
  /** The group it is listed under: "Preview", "Work zero", "Board", ... */
  readonly topic: string;
  readonly title: string;
  /** One or two short sentences. */
  readonly body: string;
  readonly link?: NoteLink;
  /** `warn` draws it in the warning colour; it is still only a note. */
  readonly tone?: 'info' | 'warn';
  /** The registered string it carries in full (W35, W36, W44, ...), as `data-safety`. */
  readonly safety?: string;
}

/** A note with the time it first appeared (newest first in the tab). */
export interface ShownNote extends Note {
  readonly source: string;
  readonly at: number;
}

const bySource = signal<ReadonlyMap<string, readonly ShownNote[]>>(new Map());
let clock = 0;

/** Replaces `source`'s notes with `notes` (an empty list clears them). Unchanged notes keep their first time. */
export function publishNotes(source: string, notes: readonly Note[], now: () => number = () => ++clock): void {
  const before = bySource.value.get(source) ?? [];
  const same = before.length === notes.length && notes.every((n, i) => sameNote(before[i], n));
  if (same) return;
  const seen = new Map(before.map((n) => [n.id, n] as const));
  const next = notes.map((n): ShownNote => {
    const old = seen.get(n.id);
    return { ...n, source, at: old !== undefined && sameNote(old, n) ? old.at : now() };
  });
  const map = new Map(bySource.value);
  if (next.length === 0) map.delete(source);
  else map.set(source, next);
  bySource.value = map;
}

function sameNote(a: ShownNote | undefined, b: Note): boolean {
  return a !== undefined && a.id === b.id && a.title === b.title && a.body === b.body && a.topic === b.topic && JSON.stringify(a.link ?? null) === JSON.stringify(b.link ?? null) && (a.tone ?? 'info') === (b.tone ?? 'info') && a.safety === b.safety;
}

/** Every note that applies now, newest first. Reading it in a render subscribes to changes. */
export function allNotes(): readonly ShownNote[] {
  return [...bySource.value.values()].flat().sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

/** The notes grouped by topic: topics ordered by their newest note, notes newest first. */
export function notesByTopic(notes: readonly ShownNote[] = allNotes()): readonly { readonly topic: string; readonly notes: readonly ShownNote[] }[] {
  const groups = new Map<string, ShownNote[]>();
  for (const n of notes) groups.set(n.topic, [...(groups.get(n.topic) ?? []), n]);
  return [...groups.entries()].map(([topic, list]) => ({ topic, notes: list }));
}

/** Tests only: forget every note. */
export function resetNotes(): void {
  bySource.value = new Map();
  clock = 0;
}
