/**
 * The one local storage module of the workspace libraries (machines, tools,
 * materials, setup). Records live in this browser's localStorage under
 * `run.ws.<name>`, as versioned JSON. Cloud sync (Track A2) replaces this
 * module's backend later; callers do not change.
 *
 * Storage can be missing or throw (private windows, blocked site data, a
 * full quota): reads then fall back to the seed and writes keep the value
 * for this page only. Nothing safety-related is ever stored here: homing,
 * confirmations and the settings reference stay in `device-safety`
 * (live/deviceSafety.ts).
 */
import { signal, type Signal } from '@preact/signals';

export const STORAGE_PREFIX = 'run.ws.';
export const STORAGE_VERSION = 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

interface Envelope<T> {
  readonly v: number;
  readonly value: T;
}

/** Reads `name`, or null when absent, unreadable, of another version, or refused by `valid`. */
export function readStored<T>(name: string, valid: (v: unknown) => v is T, storage: StorageLike | null = browserStorage()): T | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(STORAGE_PREFIX + name);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Envelope<unknown>>;
    if (parsed.v !== STORAGE_VERSION || !valid(parsed.value)) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

/** Writes `name`; false when storage refused (the value then lasts for this page only). */
export function writeStored<T>(name: string, value: T, storage: StorageLike | null = browserStorage()): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(STORAGE_PREFIX + name, JSON.stringify({ v: STORAGE_VERSION, value } satisfies Envelope<T>));
    return true;
  } catch {
    return false;
  }
}

/** A signal backed by storage: starts from `seed`, loads the stored value in `loadStoredLibraries`, saves on every `set`. */
export interface Stored<T> {
  readonly value: Signal<T>;
  set(next: T): void;
  /** False once a write was refused: the UI says changes are kept for this page only. */
  readonly saved: Signal<boolean>;
}

const loaders: (() => void)[] = [];

export function stored<T>(name: string, seed: T, valid: (v: unknown) => v is T, storage: () => StorageLike | null = browserStorage): Stored<T> {
  const value = signal<T>(seed);
  const saved = signal(true);
  loaders.push(() => {
    const s = storage();
    saved.value = s !== null;
    const found = readStored(name, valid, s);
    if (found !== null) value.value = found;
  });
  return {
    value,
    saved,
    set(next: T) {
      value.value = next;
      saved.value = writeStored(name, next, storage());
    },
  };
}

/**
 * Loads every stored library. The workspace entry calls it once, after hydration, so the prerendered
 * page (which shows the seed) and the first client render match.
 */
export function loadStoredLibraries(): void {
  for (const load of loaders) load();
}

export const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
