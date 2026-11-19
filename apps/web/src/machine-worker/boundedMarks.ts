/**
 * Safety storage with a deadline (owner report 2026-11-19). Every Connect reads the bootloader marks while the
 * flash service is busy, and busy means the worker holds the machine lock. Storage that never answers (a blocked
 * or wedged IndexedDB) would keep that forever, so each call fails after `MARK_MS`. A failed read refuses the
 * connection, as unavailable storage already does (bootloaderMark.ts: no memory fallback).
 */
import { withDeadline, type SessionClock } from '@synthetos/machine';
import type { BootloaderMarks } from './bootloaderMark.ts';

/**
 * A strict-durability commit takes milliseconds. 10 s is the longest connect-time wait the flash service already
 * has (the firmware banner, FIRMWARE_BANNER_MS); storage that is slower than that is treated as unavailable.
 */
export const MARK_MS = 10_000;

/** `marks` with every call bounded by `MARK_MS`. Calls go through to `marks` at call time. */
export function boundedMarks(marks: BootloaderMarks, clock: SessionClock): BootloaderMarks {
  return {
    find: (port, boardId) => withDeadline(marks.find(port, boardId), MARK_MS, clock, 'reading the board safety record'),
    put: (mark) => withDeadline(marks.put(mark), MARK_MS, clock, 'saving the board safety record'),
    clear: (mark) => withDeadline(marks.clear(mark), MARK_MS, clock, 'clearing the board safety record'),
  };
}
