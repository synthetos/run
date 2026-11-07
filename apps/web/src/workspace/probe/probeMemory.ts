/**
 * The last plate thickness used on each board, in this browser only (SAFETY §4.5c: "prefilled from this browser").
 * A convenience: Setup says to check it matches the plate, and nothing safety-related depends on it.
 */
import { PROBE_LIMITS } from '../../machine-worker/probeShared.ts';
import { readStored, writeStored, type StorageLike } from '../storage.ts';

const NAME = 'probe-thickness';

type Remembered = Readonly<Record<string, number>>;

function valid(v: unknown): v is Remembered {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((n) => typeof n === 'number' && n >= PROBE_LIMITS.thicknessMm.min && n <= PROBE_LIMITS.thicknessMm.max);
}

export function lastThickness(boardId: string | null, storage?: StorageLike | null): number | null {
  if (boardId === null) return null;
  return readStored(NAME, valid, storage)?.[boardId] ?? null;
}

export function rememberThickness(boardId: string | null, mm: number, storage?: StorageLike | null): void {
  if (boardId === null) return;
  writeStored(NAME, { ...(readStored(NAME, valid, storage) ?? {}), [boardId]: mm }, storage);
}
