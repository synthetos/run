/** Asking the dock to show a tab from anywhere on the page (a "2 notes" pill opens Notes). Navigation state only. */
import { signal } from '@preact/signals';

/** A tab id the dock should switch to. The dock shows it (when offered) and sets this back to null. */
export const dockTabRequest = signal<string | null>(null);

/** Asks the dock to show the tab `id` (for example a "2 notes" pill opening Notes). */
export function openDockTab(id: string): void {
  dockTabRequest.value = id;
}
