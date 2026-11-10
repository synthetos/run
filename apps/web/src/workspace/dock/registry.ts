/**
 * The dock's tabs in order (G-code, Terminal, Live job, Notes), a way for another module to add one, and a way for any code
 * to ask the dock to show a tab. Navigation state only; nothing here commands the machine.
 */
import { signal } from '@preact/signals';
import type { DockTab } from './dockTab.ts';
import { gcodeTab } from './tabs/gcodeTab.ts';
import { terminalTab } from './tabs/terminalTab.ts';
import { liveJobTab } from './tabs/liveJobTab.ts';
import { notesTab } from './tabs/notesTab.ts';

// Notes after Live job (owner, 2026-11-09). The Terminal replaces the Console (H91), in Simple and Advanced.
const tabs = signal<readonly DockTab[]>([gcodeTab, terminalTab, liveJobTab, notesTab]);

/** Every registered tab, in order. Reading it in a render subscribes to later registrations. */
export function dockTabs(): readonly DockTab[] {
  return tabs.value;
}

/**
 * Adds a tab after the one named by `after`, or at the end when `after` is absent or unknown. A tab with the same
 * id replaces the old one at the new place.
 */
export function registerDockTab(tab: DockTab, { after }: { readonly after?: string } = {}): void {
  const rest = tabs.value.filter((t) => t.id !== tab.id);
  const at = after === undefined ? -1 : rest.findIndex((t) => t.id === after);
  tabs.value = at === -1 ? [...rest, tab] : [...rest.slice(0, at + 1), tab, ...rest.slice(at + 1)];
}

export { dockTabRequest, openDockTab } from './dockRequest.ts';
