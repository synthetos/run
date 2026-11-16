import { vi } from 'vitest';
import type { CloudRecord, RecordKind } from '@synthetos/contracts';
import type { Project, MachineProfile } from '@synthetos/library';
import type { RecordsClient } from '../src/cloud/recordsClient.ts';
import type { FilesClient } from '../src/cloud/filesClient.ts';
import { ProjectStore } from '../src/projects/store.ts';
import { sha256Hex } from '../src/projects/image.ts';
import { memoryRecordStore, type StorageLike } from '../src/workspace/storage.ts';
export const at = '2026-11-16T12:00:00Z';
export const machine: MachineProfile = { id: 'machine.one', name: 'My router', templateId: 'custom', drive: 'any', travel: { x: 100, y: 100, z: 50 }, spindle: '', createdAt: at };
export const project = (id = 'project.one'): Project => ({ v: 1, id, name: 'Plate', description: '', files: [], images: [], links: [], setup: { machine: null, stock: null, material: null, tools: [] }, jobs: [], tags: [], cover: null, createdAt: at, updatedAt: at });
export const record = (kind: RecordKind, content: { id: string }, rev = 1): CloudRecord => ({ kind, id: content.id, content, rev, archivedAt: null, sha256: 'a'.repeat(64) });
export const memory = (): StorageLike => { const values = new Map<string, string>(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } }; };
export const api = (): RecordsClient => ({ list: vi.fn(async () => []), put: vi.fn(async (kind, id, parent, content) => record(kind, { ...(content as object), id }, (parent ?? 0) + 1)), archive: vi.fn(async (kind, id, parent) => ({ ...record(kind, { id }, parent + 1), archivedAt: 1 })) });
export const filesApi = (): FilesClient => ({ put: vi.fn(async () => {}), get: vi.fn(async () => new Blob()), list: vi.fn(async () => []), remove: vi.fn(async () => {}) });
export function projectContext() {
  const records = memoryRecordStore(); let id = 0;
  const local = new ProjectStore({ records, now: () => new Date(at), newId: () => `id-${++id}`, hash: sha256Hex, encodeImage: async () => ({ blob: new Blob(['webp']), width: 2, height: 2 }) });
  return { records, local, files: filesApi() };
}
