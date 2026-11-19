import { signal } from '@preact/signals';

/** Shared navigation only; selecting a Board section never sends a command. */
export type BoardTab = 'overview' | 'motors' | 'axes' | 'inputs' | 'io' | 'settings' | 'backups' | 'firmware';
export const boardTab = signal<BoardTab>('overview');

/** The Firmware tab's sub-tab (views/board/firmwareTabs.ts); null is the first, Update. */
export const firmwareSubTab = signal<string | null>(null);

/** Open Board → Firmware → Update (the update offer, a control block, the read-only notice's Update firmware). */
export function openFirmwareUpdate(): void {
  firmwareSubTab.value = 'update';
  boardTab.value = 'firmware';
}

/** A view another part of the page asks the shell to show ("Set up homing" opens Board, C17); the shell clears it. */
export const viewRequest = signal<string | null>(null);

/** A release Board → Firmware should bring into view and mark (the update offer's "Go to update"); the view clears it. */
export const releaseRequest = signal<string | null>(null);

/** A pin Board → This board should open (the coolant toggle's "Set what is wired"); the Overview tab clears it. */
export const pinRequest = signal<string | null>(null);
