import type { RecordStore } from '../storage.ts';
import { blobLink, contentKey } from '../../projects/blobStore.ts';

/** Stored ids are opaque components, never paths into another account's keys. */
export const accountPrefix = (subject: string): string => `account/${encodeURIComponent(subject)}/`;
export const accountKey = (subject: string, id: string): string => accountPrefix(subject) + encodeURIComponent(id);
/** Browser-generated project/blob ids have no namespace separators. Reserved keys are never fallbacks. */
export const isBrowserKey = (id: string): boolean => id !== '' && !/[\/\\]/.test(id);
export async function readAccountBlob(records: RecordStore, keys: { subject: string; id: string; fallback: boolean }, active: () => void): Promise<unknown> {
  active();
  const scoped = await records.get('blobs', accountKey(keys.subject, keys.id));
  active();
  if (scoped !== undefined && scoped !== null) {
    const value = blobLink(scoped) ? await records.get('blobs', accountKey(keys.subject, contentKey(scoped.contentHash))) : scoped;
    active(); return value;
  }
  const local = keys.fallback ? await records.get('blobs', keys.id) : undefined;
  active();
  const value = blobLink(local) ? await records.get('blobs', contentKey(local.contentHash)) : local;
  active(); return value;
}
export function ownBlobIds(keys: readonly string[], subject: string): string[] {
  const prefix = accountPrefix(subject);
  return keys.flatMap(key => {
    if (isBrowserKey(key)) return [key];
    if (!key.startsWith(prefix)) return [];
    try { return [decodeURIComponent(key.slice(prefix.length))]; } catch { return []; }
  });
}
