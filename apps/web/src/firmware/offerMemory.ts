/**
 * What the update offer remembers (owner, 2026-11-09): "Don't show again for this version" per board and released
 * version, in this browser. Storage can be missing or throw: then it lasts for this page only. "Not now" is kept
 * for the page only, by the caller.
 */
import type { StorageLike } from '../workspace/storage.ts';

export const OFFER_KEY = 'run.fw.offer.dismissed';

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** board id → the released versions (as written, "451.00") the user said not to show again. */
type Dismissed = Readonly<Record<string, readonly string[]>>;

function read(storage: StorageLike | null): Dismissed {
  if (storage === null) return {};
  try {
    const raw = storage.getItem(OFFER_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, readonly string[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
    return out;
  } catch {
    return {};
  }
}

/** True when the user said not to show `version` again for `boardId`. */
export function offerDismissed(boardId: string, version: string, storage: StorageLike | null = browserStorage()): boolean {
  return (read(storage)[boardId] ?? []).includes(version);
}

/** Remembers "don't show again" for `version` on `boardId`; false when storage refused. */
export function dismissOffer(boardId: string, version: string, storage: StorageLike | null = browserStorage()): boolean {
  if (storage === null) return false;
  const now = read(storage);
  const next = { ...now, [boardId]: [...new Set([...(now[boardId] ?? []), version])] };
  try {
    storage.setItem(OFFER_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
