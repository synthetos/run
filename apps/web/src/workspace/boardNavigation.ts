import { signal } from '@preact/signals';

/** Shared navigation only; selecting a Board section never sends a command. */
export type BoardTab = 'overview' | 'motors' | 'axes' | 'inputs' | 'io' | 'comms' | 'settings' | 'backups' | 'firmware';
export const boardTab = signal<BoardTab>('overview');
