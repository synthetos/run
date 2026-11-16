import { keyDigest, MAX_FILE_BYTES, type FileBackup, type FileObject, type FileSource, type FileStats } from './types.ts';
export async function copyObject(source: FileSource, backup: FileBackup, listed: FileObject, prefix: string): Promise<boolean> {
  if (!validSize(listed.size)) throw new Error('File exceeds copy limit');
  const key = prefix + listed.key, old = await backup.head(key);
  if (unchanged(old, listed)) return false;
  const object = await source.get(listed.key, { onlyIf: { etagMatches: listed.etag } });
  if (!object?.body || !sameVersion(object, listed)) {
    await object?.body?.cancel();
    throw new Error('Source changed during file copy');
  }
  const sha256 = keyDigest(listed.key);
  // The binding has no CopyObject method. Pass the R2 known-length stream directly
  // to put; do not tee/buffer it. R2 verifies the content-address digest on upload.
  try {
    const saved = await backup.put(key, object.size === 0 ? new Uint8Array(0) : object.body, {
      customMetadata: { sourceEtag: listed.etag, sourceSize: String(listed.size) },
      ...(sha256 === undefined ? {} : { sha256 }),
      onlyIf: old === null ? { etagDoesNotMatch: '*' } : { etagMatches: old.etag },
    });
    if (saved === null || saved.size !== listed.size) throw new Error('File copy did not commit');
  } finally { if (!object.body.locked) await object.body.cancel(); }
  return true;
}
export async function copyPage(pair: { source: FileSource; backup: FileBackup; prefix: string }, objects: FileObject[], stats: FileStats, available: () => boolean): Promise<boolean> {
  for (const object of objects) {
    if (!available()) return false;
    const copied = await copyObject(pair.source, pair.backup, object, pair.prefix);
    stats.examined++;
    if (copied) { stats.copied++; stats.bytes += object.size; } else stats.skipped++;
  }
  return true;
}

function sameVersion(object: FileObject, listed: FileObject): boolean { return object.etag === listed.etag && object.size === listed.size; }
function unchanged(old: FileObject | null, listed: FileObject): boolean {
  return old !== null && old.customMetadata?.['sourceEtag'] === listed.etag && old.size === listed.size;
}

function validSize(size: number): boolean { return Number.isSafeInteger(size) && size >= 0 && size <= MAX_FILE_BYTES; }
