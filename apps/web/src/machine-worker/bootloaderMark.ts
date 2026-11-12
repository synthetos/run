/** Browser-local, account-independent quarantine. A committed mark precedes boot entry (proposed H92). */
import type { PortSelector } from '@synthetos/machine';

export interface BootloaderMark {
  readonly nonce: string;
  readonly kind?: 'detected' | 'failed';
  readonly port: PortSelector;
  readonly boardId: string | null;
  readonly recovery: unknown;
}
export interface BootloaderMarks {
  find(port: PortSelector, boardId?: string): Promise<BootloaderMark | null>;
  put(mark: BootloaderMark): Promise<void>;
  clear(mark: BootloaderMark): Promise<void>;
}
const key = (p: PortSelector): string => `bootloader:${p.usbVendorId}:${p.usbProductId}`;
const recordKey = (m: BootloaderMark): string => `${key(m.port)}:${JSON.stringify(m.boardId)}`;
const matches = (m: BootloaderMark, p: PortSelector, id?: string): boolean => key(m.port) === key(p) || (id !== undefined && m.boardId === id);

export function memoryBootloaderMarks(): BootloaderMarks {
  const records = new Map<string, BootloaderMark>();
  return {
    find: async (p, id) => structuredClone([...records.values()].find(m => matches(m, p, id)) ?? null),
    put: async m => { records.set(recordKey(m), structuredClone(m)); },
    clear: async m => { if (records.get(recordKey(m))?.nonce === m.nonce) records.delete(recordKey(m)); },
  };
}

/** No memory fallback: unavailable storage refuses both flashing and normal connection. Await transaction COMMIT. */
export function browserBootloaderMarks(factory: () => IDBFactory = () => indexedDB): BootloaderMarks {
  let database: Promise<IDBDatabase> | undefined;
  const db = (): Promise<IDBDatabase> => database ??= new Promise((resolve, reject) => {
    const r = factory().open('device-safety', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Safety storage is blocked.'));
  });
  const transaction = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore, done: (value: T) => void) => void): Promise<T> => {
    const database = await db();
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction('kv', mode, { durability: 'strict' });
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Safety storage failed.'));
      run(tx.objectStore('kv'), v => { value = v; });
    });
  };
  return {
    find: (p, id) => transaction('readonly', (s, done) => {
      const r = s.openCursor(IDBKeyRange.bound('bootloader:', 'bootloader;'));
      r.onsuccess = () => {
        const cursor = r.result;
        if (cursor === null) { done(null); return; }
        const mark = cursor.value as BootloaderMark;
        try {
          if (matches(mark, p, id)) done(mark);
          else cursor.continue();
        } catch { s.transaction.abort(); }
      };
    }),
    put: m => transaction<void>('readwrite', (s, done) => { s.put(m, recordKey(m)); done(undefined); }),
    clear: m => transaction<void>('readwrite', (s, done) => {
      const r = s.get(recordKey(m));
      r.onsuccess = () => { if ((r.result as BootloaderMark | undefined)?.nonce === m.nonce) s.delete(recordKey(m)); done(undefined); };
    }),
  };
}
