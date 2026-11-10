/**
 * The page's notes (owner, 2026-11-09: "a page ... next to live job that can put notes about the state if the user
 * wants to read it, not just everywhere on the UI"). Views publish the explanatory, non-blocking notes that apply now
 * under their own source name; the Notes tab in the dock reads them all. A source that publishes again replaces its
 * notes, so a note that no longer applies goes away. Blockers, the one start confirmation and the warnings SAFETY
 * requires at the point of action are never notes. Presentation only.
 */
import { signal } from '@preact/signals';
import type { BoardTab } from '../boardNavigation.ts';
import { dismissed } from './Dismissable.ts';

/** Where a note applies: a line in the G-code list, a Job step, a Board tab, or another view. */
export type NoteLink =
  | { readonly kind: 'line'; readonly line: number }
  | { readonly kind: 'step'; readonly step: string; readonly label: string }
  | { readonly kind: 'board'; readonly tab: BoardTab; readonly label: string }
  | { readonly kind: 'view'; readonly view: string; readonly label: string }
  /** A named action a view registers while it is mounted (noteActions.ts), such as Home with its confirmation. */
  | { readonly kind: 'action'; readonly action: string; readonly label: string };

export interface Note {
  /** Stable while the note says the same thing (it keeps its place in the list). */
  readonly id: string;
  /** The group it is listed under: "Preview", "Work zero", "Board", ... */
  readonly topic: string;
  readonly title: string;
  /** One plain sentence: what it means, never a dump of coordinates. */
  readonly body: string;
  /** The full detail, behind More (expands in place). */
  readonly detail?: string;
  readonly link?: NoteLink;
  /** `warn`: listed under Needs you, with ⚠; `info`: Good to know, with ℹ. Still only a note either way. */
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
  return a !== undefined && a.id === b.id && a.title === b.title && a.body === b.body && a.topic === b.topic && JSON.stringify(a.link ?? null) === JSON.stringify(b.link ?? null) && (a.tone ?? 'info') === (b.tone ?? 'info') && a.safety === b.safety && a.detail === b.detail;
}

/** The key a note is dismissed by (per source and id). */
export function noteKey(n: Pick<ShownNote, 'source' | 'id'>): string {
  return `note/${n.source}/${n.id}`;
}

/** The notes that apply now and were not dismissed (the badge and the pills count these). */
export function visibleNotes(): readonly ShownNote[] {
  const gone = dismissed.value;
  return allNotes().filter((n) => !gone.has(noteKey(n)));
}

/** Every note that applies now, newest first. Reading it in a render subscribes to changes. */
export function allNotes(): readonly ShownNote[] {
  return [...bySource.value.values()].flat().sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

/** Needs you (warnings) first, then Good to know; newest first in each. Empty groups are left out. */
export function notesByNeed(notes: readonly ShownNote[] = visibleNotes()): readonly { readonly group: 'needs' | 'know'; readonly notes: readonly ShownNote[] }[] {
  const needs = notes.filter((n) => n.tone === 'warn');
  const know = notes.filter((n) => n.tone !== 'warn');
  return [...(needs.length === 0 ? [] : [{ group: 'needs' as const, notes: needs }]), ...(know.length === 0 ? [] : [{ group: 'know' as const, notes: know }])];
}

/** Tests only: forget every note. */
export function resetNotes(): void {
  bySource.value = new Map();
  clock = 0;
}
