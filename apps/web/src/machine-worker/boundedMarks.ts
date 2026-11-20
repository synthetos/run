/**
 * Safety storage with a deadline (owner report 2026-11-19). Every Connect reads the bootloader marks while the
 * flash service is busy, and busy means the worker holds the machine lock. Storage that never answers (a blocked
 * or wedged IndexedDB) would keep that forever, so each call fails after `MARK_MS`. A failed read refuses the
 * connection, as unavailable storage already does (bootloaderMark.ts: no memory fallback).
 */
import { LinkDeadline, withDeadline, type SessionClock } from '@synthetos/machine';
import type { BootloaderMarks } from './bootloaderMark.ts';

/**
 * A strict-durability commit takes milliseconds. 10 s is thousands of times that; storage slower than that is
 * treated as unavailable.
 */
export const MARK_MS = 10_000;

/**
 * Storage that passed its deadline. Not a port deadline (`LinkDeadline`): Connect tells a person to unplug USB only
 * for a stuck port, and unplugging does nothing for storage.
 */
export class SafetyStorageTimeout extends Error {
  override readonly name = 'SafetyStorageTimeout';
}

function bounded<T>(work: Promise<T>, clock: SessionClock, what: string): Promise<T> {
  return withDeadline(work, MARK_MS, clock, what).catch((error: unknown) => {
    throw error instanceof LinkDeadline ? new SafetyStorageTimeout(error.message) : error;
  });
}

/** `marks` with every call bounded by `MARK_MS`. Calls go through to `marks` at call time. */
export function boundedMarks(marks: BootloaderMarks, clock: SessionClock): BootloaderMarks {
  return {
    find: (port, boardId) => bounded(marks.find(port, boardId), clock, 'reading the board safety record'),
    put: (mark) => bounded(marks.put(mark), clock, 'saving the board safety record'),
    clear: (mark) => bounded(marks.clear(mark), clock, 'clearing the board safety record'),
  };
}
