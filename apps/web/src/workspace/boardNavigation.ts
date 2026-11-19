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

/**
 * A release whose update flow Board → Firmware → Update should start, as its row's own button does (owner 169): the
 * image is fetched and checked, then C6 asks. Nothing is written before C6. The view takes it once and clears it;
 * when the row could not start right now, nothing happens and the rows stay on screen.
 */
export const updateRequest = signal<string | null>(null);

/** Opens Board → Firmware → Update and starts that release's flow (the site-wide Update firmware buttons). */
export function startFirmwareUpdate(file: string): void {
  openFirmwareUpdate();
  releaseRequest.value = file;
  updateRequest.value = file;
  viewRequest.value = 'board';
}

/** A pin Board → This board should open (the coolant toggle's "Set what is wired"); the Overview tab clears it. */
export const pinRequest = signal<string | null>(null);
