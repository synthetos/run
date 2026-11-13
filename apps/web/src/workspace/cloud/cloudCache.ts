import { readTool, readMaterial } from '@synthetos/library';
import type { CloudRecord, RecordKind } from '@synthetos/contracts';
import type { StorageLike } from '../storage.ts';
export interface PendingWrite { readonly cleanup?: true; readonly token: string; readonly kind: RecordKind; readonly id: string; readonly parent: number | null; readonly content: unknown | null }
export interface CloudCache { v: 1; records: CloudRecord[]; pending: PendingWrite[]; imports: Record<string, string>; consent: boolean; importSource?: { kind: RecordKind; id: string; content: unknown }[] }
export const emptyCache = (): CloudCache => ({ v: 1, records: [], pending: [], imports: {}, consent: false });
export const cacheKey = (subject: string): string => `run.cloud-cache.${subject}`;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const kind = (k: unknown): k is RecordKind => k === 'tool' || k === 'material';
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
const rev = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const content = (k: RecordKind, v: unknown, recordId: string): boolean => {
  const parsed = k === 'tool' ? readTool(v) : readMaterial(v);
  return parsed.ok && parsed.value.id === recordId;
};
function validCache(c: unknown): c is CloudCache {
  return object(c) && (c['importSource'] === undefined || (Array.isArray(c['importSource']) && c['importSource'].every((r: unknown) => object(r) && kind(r['kind']) && id(r['id']) && content(r['kind'], r['content'], r['id'])))) && c['v'] === 1 && typeof c['consent'] === 'boolean' && object(c['imports']) && Object.values(c['imports']).every(id)
    && Array.isArray(c['records']) && c['records'].every((r: unknown) => object(r) && kind(r['kind']) && id(r['id']) && rev(r['rev']) && (r['archivedAt'] === null || typeof r['archivedAt'] === 'number') && typeof r['sha256'] === 'string' && content(r['kind'], r['content'], r['id']))
    && Array.isArray(c['pending']) && c['pending'].every((p: unknown) => object(p) && (p['cleanup'] === undefined || (p['cleanup'] === true && p['kind'] === 'tool' && typeof p['id'] === 'string' && p['id'].startsWith('seed.') && p['content'] !== null)) && typeof p['token'] === 'string' && kind(p['kind']) && id(p['id']) && (p['parent'] === null || rev(p['parent'])) && (p['content'] === null || content(p['kind'], p['content'], p['id'])));
}
export function readCache(storage: StorageLike | null, subject: string): CloudCache {
  try {
    const raw = storage?.getItem(cacheKey(subject)); if (raw == null) return emptyCache();
    const c = JSON.parse(raw) as CloudCache;
    if (!validCache(c)) return emptyCache();
    return c;
  } catch { return emptyCache(); }
}
export function saveCache(storage: StorageLike | null, subject: string, cache: CloudCache): boolean {
  try { if (storage === null) return false; storage.setItem(cacheKey(subject), JSON.stringify(cache)); return true; } catch { return false; }
}
/** Stable content hashing ignores object insertion order but preserves array order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function contentHash(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))].map(b => b.toString(16).padStart(2, '0')).join('');
}
