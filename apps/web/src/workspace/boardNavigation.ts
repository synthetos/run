import { signal } from '@preact/signals';

/** Shared navigation only; selecting a Board section never sends a command. */
export type BoardTab = 'overview' | 'motors' | 'axes' | 'inputs' | 'io' | 'comms' | 'settings' | 'backups' | 'firmware';
export const boardTab = signal<BoardTab>('overview');

/** A view another part of the page asks the shell to show ("Set up homing" opens Board, C17); the shell clears it. */
export const viewRequest = signal<string | null>(null);

/** A release Board → Firmware should bring into view and mark (the update offer's "Go to update"); the view clears it. */
export const releaseRequest = signal<string | null>(null);
