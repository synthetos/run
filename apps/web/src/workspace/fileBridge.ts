/**
 * The G-code file between views. The Run view publishes the file it has open,
 * for a report's excerpt. Plain data between views; nothing here reaches a
 * machine.
 */
import { signal } from '@preact/signals';

export interface OpenFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** The file the Run view has open and checked, or null. */
export const currentFile = signal<OpenFile | null>(null);
