import { keyDigest, MAX_FILE_BYTES, SAMPLE_SIZE, type FileBackup, type FileObject, type FileState } from './files-types.ts';
interface Digest extends WritableStream<Uint8Array> { digest: Promise<ArrayBuffer> }
function digestStream(): Digest {
  const runtime = crypto as Crypto & { DigestStream: new (algorithm: string) => Digest };
  return new runtime.DigestStream('SHA-256');
}
export function samplePage(state: FileState, objects: FileObject[], random: () => number): void {
  let count = state.inventory.count;
  for (const object of objects) {
    count++;
    const index = count <= SAMPLE_SIZE ? count - 1 : Math.floor(random() * count);
    if (index < SAMPLE_SIZE) state.samples[index] = { key: object.key, size: object.size };
  }
}
export async function verifyFile(bucket: FileBackup, sample: { key: string; size: number }, prefix: string): Promise<void> {
  if (!sample.key.startsWith(prefix) || sample.size > MAX_FILE_BYTES) throw new Error('Invalid restore sample');
  const object = await bucket.get(sample.key);
  if (!object?.body) throw new Error('File restore sample missing');
  const digest = digestStream(), writer = digest.getWriter(), reader = object.body.getReader();
  // Observe rejection even when a failed input forces an abort before digest is awaited.
  void digest.digest.catch(() => undefined);
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_FILE_BYTES || bytes > sample.size) throw new Error('File restore size differs');
      await writer.write(part.value);
    }
    await writer.close();
    const actual = Array.from(new Uint8Array(await digest.digest), b => b.toString(16).padStart(2, '0')).join('');
    const expected = keyDigest(sample.key);
    if (bytes !== sample.size || object.size !== sample.size || (expected !== undefined && expected !== actual)) throw new Error('File restore integrity differs');
  } catch (error) { await writer.abort().catch(() => undefined); throw error; }
  finally { await reader.cancel(); }
}
