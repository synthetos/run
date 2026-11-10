/**
 * Actions a note can offer as its button (owner, 2026-11-09: "Can't compare until the machine is homed" with
 * [Home]). A view that can do the action registers it while mounted, with its own confirmation; the Notes tab calls
 * it by name. Without a registered handler the note shows no button.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';

const handlers = signal<ReadonlyMap<string, () => void>>(new Map());

export function noteAction(name: string): (() => void) | null {
  return handlers.value.get(name) ?? null;
}

/** Registers `run` under `name` while the calling view is mounted (null: nothing registered). */
export function useNoteAction(name: string, run: (() => void) | null): void {
  useEffect(() => {
    if (run === null) return undefined;
    handlers.value = new Map(handlers.value).set(name, run);
    return () => {
      const next = new Map(handlers.value);
      if (next.get(name) === run) next.delete(name);
      handlers.value = next;
    };
  }, [name, run]);
}

/**
 * Registers several actions at once while the calling view is mounted (a list whose length changes, such as one Edit
 * button per mismatched tool). `key` names the set: the actions are registered again when it changes.
 */
export function useNoteActions(actions: ReadonlyMap<string, () => void>, key: string): void {
  useEffect(() => {
    const next = new Map(handlers.value);
    for (const [name, run] of actions) next.set(name, run);
    handlers.value = next;
    return () => {
      const left = new Map(handlers.value);
      for (const [name, run] of actions) if (left.get(name) === run) left.delete(name);
      handlers.value = left;
    };
  }, [key]);
}
