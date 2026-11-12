/**
 * The one local storage module of the workspace libraries (machines, tools,
 * materials, setup). Records live in this browser's localStorage under
 * `run.ws.<name>`, as versioned JSON. Account sync attaches a backend to tools and materials only; callers do not change.
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
export interface StoredBinding {
  readonly name: string;
  local(): unknown;
  show(value: unknown): void;
  connect(save: (next: unknown, previous: unknown) => boolean): void;
  disconnect(): void;
}
const bindings = new Map<string, StoredBinding>();
/** Account backends attach only to explicitly selected libraries; all other stores stay local. */
export function storedBinding(name: string): StoredBinding | undefined { return bindings.get(name); }


export function stored<T>(name: string, seed: T, valid: (v: unknown) => v is T, storage: () => StorageLike | null = browserStorage): Stored<T> {
  const value = signal<T>(seed);
  const saved = signal(true);
  let local: T = seed;
  let localSaved = true;
  let cloudSave: ((next: unknown, previous: unknown) => boolean) | null = null;
  bindings.set(name, {
    name, local: () => local,
    show(next) { if (valid(next)) value.value = next; },
    connect(save) { cloudSave = save; },
    disconnect() { cloudSave = null; value.value = local; saved.value = localSaved; },
  });
  loaders.push(() => {
    const s = storage();
    localSaved = s !== null; saved.value = localSaved;
    const found = readStored(name, valid, s);
    if (found !== null) { local = found; value.value = found; }
  });
  return {
    value,
    saved,
    set(next: T) {
      const previous = value.value;
      value.value = next;
      if (cloudSave !== null) saved.value = cloudSave(next, previous);
      else { local = next; localSaved = writeStored(name, next, storage()); saved.value = localSaved; }
    },
  };
}

/** Runs `fn` after the stores registered before it have loaded (a migration that reads one store into another). */
export function afterLoad(fn: () => void): void {
  loaders.push(fn);
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

// ---------------------------------------------------------------- IndexedDB records

/**
 * Larger local records (Projects: project records and their files and images) live in IndexedDB,
 * database `run.ws`, one object store per kind. Same rules as above: a browser without IndexedDB,
 * or one that refuses it, gets the in-memory store, and the UI says changes last for this page only.
 * Nothing safety-related is ever stored here.
 */
export const RECORD_DB = 'run.ws';
export const RECORD_DB_VERSION = 1;
export const RECORD_STORES = ['projects', 'blobs'] as const;
export type RecordStoreName = (typeof RECORD_STORES)[number];

export interface RecordStore {
  /** False for the in-memory fallback. */
  readonly persistent: boolean;
  get(store: RecordStoreName, key: string): Promise<unknown>;
  put(store: RecordStoreName, key: string, value: unknown): Promise<void>;
  delete(store: RecordStoreName, key: string): Promise<void>;
  keys(store: RecordStoreName): Promise<string[]>;
}

/** The in-memory record store (tests, and browsers without IndexedDB). */
export function memoryRecordStore(): RecordStore & { readonly data: Map<string, Map<string, unknown>> } {
  const data = new Map<string, Map<string, unknown>>(RECORD_STORES.map((s) => [s, new Map<string, unknown>()]));
  const of = (s: RecordStoreName): Map<string, unknown> => data.get(s) as Map<string, unknown>;
  return {
    persistent: false,
    data,
    get: (s, key) => Promise.resolve(of(s).get(key)),
    put: (s, key, value) => {
      of(s).set(key, value);
      return Promise.resolve();
    },
    delete: (s, key) => {
      of(s).delete(key);
      return Promise.resolve();
    },
    keys: (s) => Promise.resolve([...of(s).keys()].sort()),
  };
}

function idb<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('run.ws: request failed'));
  });
}

/** Opens (creating on first use) the IndexedDB record store. */
export async function openRecordStore(factory: IDBFactory): Promise<RecordStore> {
  const open = factory.open(RECORD_DB, RECORD_DB_VERSION);
  open.onupgradeneeded = () => {
    for (const s of RECORD_STORES) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s);
  };
  const db = await idb(open);
  const tx = (s: RecordStoreName, mode: IDBTransactionMode): IDBObjectStore => db.transaction(s, mode).objectStore(s);
  return {
    persistent: true,
    get: (s, key) => idb(tx(s, 'readonly').get(key)) as Promise<unknown>,
    put: async (s, key, value) => {
      await idb(tx(s, 'readwrite').put(value, key));
    },
    delete: async (s, key) => {
      await idb(tx(s, 'readwrite').delete(key));
    },
    keys: async (s) => (await idb(tx(s, 'readonly').getAllKeys())).filter((k): k is string => typeof k === 'string').sort(),
  };
}

/** The browser's record store, or the in-memory one when IndexedDB is missing or refused. */
export async function browserRecordStore(): Promise<RecordStore> {
  try {
    const factory = globalThis.indexedDB;
    if (factory === undefined) return memoryRecordStore();
    return await openRecordStore(factory);
  } catch {
    return memoryRecordStore();
  }
}
