/**
 * The `device-safety` store (RUN_PLAN §4.4; SAFETY §4.10 rule 3, H27, H28).
 *
 * Browser-local, account-independent state the safety design keeps on this
 * device: the C1 acceptance record, the verified safety advisory, the
 * `liveSession` marker (W6). It is never uploaded, never synced, and never
 * cleared by sign-out, an account switch or `Clear-Site-Data` (which never
 * includes `"storage"`).
 *
 * IndexedDB database `device-safety`, object store `kv`. A test or a
 * browser without IndexedDB uses the in-memory store: every gate that reads
 * it then sees "nothing recorded", which is the conservative answer (full
 * C1, no cached advisory).
 */

export interface DeviceSafetyStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export const DEVICE_SAFETY_DB = 'device-safety';
export const DEVICE_SAFETY_STORE = 'kv';

export function memoryDeviceSafety(seed: Record<string, unknown> = {}): DeviceSafetyStore & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(seed));
  return {
    data,
    get: (key) => Promise.resolve(structuredClone(data.get(key))),
    set: (key, value) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
    delete: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
    keys: (prefix) => Promise.resolve([...data.keys()].filter((k) => k.startsWith(prefix)).sort()),
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('device-safety: request failed'));
  });
}

/** Opens (creating on first use) the IndexedDB store. */
export async function openDeviceSafety(factory: IDBFactory): Promise<DeviceSafetyStore> {
  const open = factory.open(DEVICE_SAFETY_DB, 1);
  open.onupgradeneeded = () => {
    if (!open.result.objectStoreNames.contains(DEVICE_SAFETY_STORE)) open.result.createObjectStore(DEVICE_SAFETY_STORE);
  };
  const db = await request(open);
  const tx = (mode: IDBTransactionMode) => db.transaction(DEVICE_SAFETY_STORE, mode).objectStore(DEVICE_SAFETY_STORE);
  return {
    get: (key) => request(tx('readonly').get(key)) as Promise<unknown>,
    set: async (key, value) => {
      await request(tx('readwrite').put(value, key));
    },
    delete: async (key) => {
      await request(tx('readwrite').delete(key));
    },
    keys: async (prefix) => {
      const all = await request(tx('readonly').getAllKeys());
      return all.filter((k): k is string => typeof k === 'string' && k.startsWith(prefix)).sort();
    },
  };
}
