/**
 * The G-code file between views. The Run view publishes the file it has open
 * (for a report's excerpt), and Projects asks the Run view to open a file
 * ("Open in Run"). Plain data between views; nothing here reaches a machine.
 */
import { signal } from '@preact/signals';

export interface OpenFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** The file the Run view has open and checked, or null. */
export const currentFile = signal<OpenFile | null>(null);

/** A file another view asked the Run view to open; the Run view takes it and clears it. */
export const pendingOpen = signal<File | null>(null);

export function openInRun(file: File): void {
  pendingOpen.value = file;
}
