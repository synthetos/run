/** Pending changes per Board tab, from each definition's `tab` (Board settings spec §5.2); keys without one count on All settings. */
import { draftStore } from '../boardFacts.ts';
import type { LiveView } from '../model.ts';
import { defsFor } from './defs.ts';

export function pendingByTab(view: LiveView | null): Readonly<Record<string, number>> {
  const defs = defsFor(view);
  const out: Record<string, number> = {};
  for (const k of Object.keys(draftStore.value.value)) {
    const tab = defs?.tokens.get(k)?.tab ?? 'settings';
    out[tab] = (out[tab] ?? 0) + 1;
  }
  return out;
}
