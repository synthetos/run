/**
 * A notice the user can dismiss (owner, 2026-11-09: "overly wordy, cannot dismiss things"). A × on the notice hides it
 * for good in this browser, remembered per notice id; its full text stays in the Notes tab. Active safety blocks are
 * never wrapped in this: they are modals with a way out.
 */
import { h, type ComponentChild } from 'preact';
import { signal } from '@preact/signals';
import { readStored, writeStored } from '../storage.ts';

const KEY = 'notice-dismissed';
const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The dismissed notice ids, read once; written on every dismissal. */
export const dismissed = signal<ReadonlySet<string>>(new Set(readStored(KEY, isList) ?? []));

export function dismiss(id: string): void {
  const next = new Set(dismissed.value).add(id);
  dismissed.value = next;
  writeStored(KEY, [...next]);
}

/** Tests only: forget every dismissal. */
export function resetDismissed(): void {
  dismissed.value = new Set();
}

export function Dismissable({ id, label, children, class: cls = '' }: { readonly id: string; readonly label: string; readonly children?: ComponentChild; readonly class?: string }): ComponentChild {
  if (dismissed.value.has(id)) return null;
  return h(
    'div',
    { class: `dismissable ${cls}`.trim(), 'data-notice': id },
    h('div', { class: 'dismissable-body' }, children),
    h('button', { type: 'button', class: 'dismiss', 'data-action': 'dismiss-notice-x', 'aria-label': `Hide: ${label}. It stays in Notes.`, title: 'Hide (it stays in Notes)', onClick: () => dismiss(id) }, '×'),
  );
}
