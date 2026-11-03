/**
 * Firmware & Backups, stored on this computer (WORKSPACE_FEATURES "Settings
 * backup", "Firmware update"; SAFETY §4.8 as amended 2026-11-03, H81, H87).
 *
 * - Settings backups (token by token, live/backup.ts), each with the board
 *   id, the date, the firmware and what triggered it: before an update,
 *   before a settings apply, on demand, or imported from a file.
 * - Firmware image backups: the whole application section read from the
 *   board in the bootloader just before an update, as Intel HEX, with the
 *   `fb`/`fv` the board reported, its SHA-256, and the raw EEPROM read with
 *   it (a second, raw copy of the settings).
 *
 * Stored in this browser's IndexedDB (database `run-backups`) behind
 * `BackupRepository`, the seam a later cloud sync plugs into: settings
 * backups may sync (SAFETY §4.10 rule 6); firmware images stay local until
 * hosting is decided.
 *
 * The safety records are NOT here: the trust in a custom build, the image
 * installed on each board and the pending post-flash restore live in
 * `device-safety` (live/deviceSafety.ts), which is never synced and never
 * cleared by sign-out (SAFETY §4.10 rule 7). Their keys and helpers are below.
 */
import type { BackupFile } from '../live/backup.ts';
import type { DeviceSafetyStore } from '../live/deviceSafety.ts';

export type BackupTrigger = 'manual' | 'before-apply' | 'before-update' | 'import';

export interface SettingsBackupRecord {
  readonly id: string;
  readonly boardId: string | null;
  readonly dialect: string;
  readonly fb: number | null;
  readonly fv: number | null;
  readonly takenAt: string;
  readonly trigger: BackupTrigger;
  readonly file: BackupFile;
}

export interface FirmwareBackupRecord {
  readonly id: string;
  readonly boardId: string | null;
  readonly fb: number | null;
  readonly fv: number | null;
  readonly takenAt: string;
  readonly sha256: string;
  readonly size: number;
  /** The application section as Intel HEX. */
  readonly hex: string;
  /** The raw EEPROM (2 KB), base64. */
  readonly eeprom: string;
  /** xboot's CRC-16 of the section. */
  readonly crc: number;
  readonly trigger: 'before-update';
}

/** The seam a cloud sync plugs into later. */
export interface BackupRepository {
  listSettings(): Promise<readonly SettingsBackupRecord[]>;
  putSettings(record: SettingsBackupRecord): Promise<void>;
  deleteSettings(id: string): Promise<void>;
  listFirmware(): Promise<readonly FirmwareBackupRecord[]>;
  putFirmware(record: FirmwareBackupRecord): Promise<void>;
  deleteFirmware(id: string): Promise<void>;
}

export function memoryRepository(): BackupRepository & { readonly settings: Map<string, SettingsBackupRecord>; readonly firmware: Map<string, FirmwareBackupRecord> } {
  const settings = new Map<string, SettingsBackupRecord>();
  const firmware = new Map<string, FirmwareBackupRecord>();
  const newest = <T extends { takenAt: string }>(xs: Iterable<T>): T[] => [...xs].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  return {
    settings,
    firmware,
    listSettings: () => Promise.resolve(newest(settings.values())),
    putSettings: (r) => {
      settings.set(r.id, structuredClone(r));
      return Promise.resolve();
    },
    deleteSettings: (id) => {
      settings.delete(id);
      return Promise.resolve();
    },
    listFirmware: () => Promise.resolve(newest(firmware.values())),
    putFirmware: (r) => {
      firmware.set(r.id, structuredClone(r));
      return Promise.resolve();
    },
    deleteFirmware: (id) => {
      firmware.delete(id);
      return Promise.resolve();
    },
  };
}

export const BACKUPS_DB = 'run-backups';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('run-backups: request failed'));
  });
}

/** Opens (creating on first use) the IndexedDB repository. */
export async function openRepository(factory: IDBFactory): Promise<BackupRepository> {
  const open = factory.open(BACKUPS_DB, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('firmware')) db.createObjectStore('firmware', { keyPath: 'id' });
  };
  const db = await request(open);
  const store = (name: 'settings' | 'firmware', mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name);
  const list = async <T extends { takenAt: string }>(name: 'settings' | 'firmware'): Promise<T[]> => ((await request(store(name, 'readonly').getAll())) as T[]).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  return {
    listSettings: () => list<SettingsBackupRecord>('settings'),
    putSettings: async (r) => {
      await request(store('settings', 'readwrite').put(r));
    },
    deleteSettings: async (id) => {
      await request(store('settings', 'readwrite').delete(id));
    },
    listFirmware: () => list<FirmwareBackupRecord>('firmware'),
    putFirmware: async (r) => {
      await request(store('firmware', 'readwrite').put(r));
    },
    deleteFirmware: async (id) => {
      await request(store('firmware', 'readwrite').delete(id));
    },
  };
}

/** A record id from the board, the time and a kind: stable and sortable. */
export function recordId(kind: 'settings' | 'firmware', boardId: string | null, takenAt: string): string {
  return `${kind}/${boardId ?? 'no-board-id'}/${takenAt}`;
}

export function settingsRecord(file: BackupFile, trigger: BackupTrigger): SettingsBackupRecord {
  return Object.freeze({ id: recordId('settings', file.board.id, file.takenAt), boardId: file.board.id, dialect: file.board.dialect, fb: file.board.fb, fv: file.board.fv, takenAt: file.takenAt, trigger, file });
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Reads a backup file a user imports; null when it is not one. */
export function parseBackupImport(text: string): BackupFile | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const f = v as Partial<BackupFile>;
  if (f.format !== 'synthetos-run-settings-backup' || f.version !== 1 || typeof f.takenAt !== 'string' || typeof f.tokens !== 'object' || f.tokens === null || typeof f.board !== 'object' || f.board === null) return null;
  if (typeof f.board.dialect !== 'string') return null;
  for (const value of Object.values(f.tokens)) if (typeof value !== 'number' && typeof value !== 'string') return null;
  return f as BackupFile;
}

// --- device-safety records ------------------------------------------------------------------------------------

/** A custom build the user trusted on one board (SAFETY H87). */
export interface TrustRecord {
  readonly boardId: string;
  readonly sha256: string;
  readonly dialect: 'tinyg-en' | 'tinyg-440';
  readonly fb: number;
  readonly fbs: string | null;
  readonly name: string;
  readonly trustedAt: string;
}

/** The image this browser last flashed onto a board. */
export interface InstalledRecord {
  readonly boardId: string;
  readonly sha256: string;
  readonly fb: number | null;
  readonly name: string;
  readonly source: 'release' | 'backup' | 'custom';
  readonly at: string;
}

/** An update whose settings check is not finished (SAFETY §4.8 flashRestorePending). */
export interface PendingRestore {
  readonly boardId: string;
  readonly baseline: Readonly<Record<string, number | string>>;
  readonly backupId: string;
  readonly at: string;
}

export const trustKey = (boardId: string, sha256: string): string => `trust/${boardId}/${sha256}`;
export const installedKey = (boardId: string): string => `installed/${boardId}`;
export const pendingKey = (boardId: string): string => `flashRestorePending/${boardId}`;

export async function trustRecords(store: DeviceSafetyStore): Promise<TrustRecord[]> {
  const out: TrustRecord[] = [];
  for (const k of await store.keys('trust/')) {
    const v = (await store.get(k)) as TrustRecord | undefined;
    if (v !== undefined) out.push(v);
  }
  return out;
}

/**
 * The trusted builds the worker may use at Connect: only those whose board this browser last flashed with exactly
 * that image (the installed record), so a trust never outlives a reflash from here. A reflash from another program
 * with a build reporting the same `fb` cannot be told apart (the residual of H87).
 */
export async function activeTrust(store: DeviceSafetyStore): Promise<TrustRecord[]> {
  const out: TrustRecord[] = [];
  for (const t of await trustRecords(store)) {
    const installed = (await store.get(installedKey(t.boardId))) as InstalledRecord | undefined;
    if (installed !== undefined && installed.sha256 === t.sha256) out.push(t);
  }
  return out;
}
