import { expect, it } from 'vitest';
import { writeZip } from '../src/projects/zip/writer.ts';
import { entryBytes, readZip } from '../src/projects/zip/reader.ts';
it('round trips zero bytes and UTF-8 names with spaces', async () => {
  const zip = await writeZip([{ name: 'files/a/空 notes.txt', blob: new Blob() }, { name: 'files/b/切削 plate.nc', blob: new Blob(['G0 X1\n']) }]);
  const entries = await readZip(zip);
  expect((await entryBytes(entries.get('files/a/空 notes.txt')!)).byteLength).toBe(0);
  expect(new TextDecoder().decode(await entryBytes(entries.get('files/b/切削 plate.nc')!))).toBe('G0 X1\n');
});
it('consumes asynchronous entries one at a time', async () => {
  const events: string[] = [];
  class TrackedBlob extends Blob { override async arrayBuffer() { events.push('read'); return super.arrayBuffer(); } }
  async function* entries() {
    for (const id of ['a', 'b']) { events.push(id); yield { name: `files/${id}/part.nc`, blob: new TrackedBlob(['G0 X1']) }; }
  }
  await writeZip(entries()); expect(events).toEqual(['a', 'read', 'b', 'read']);
});
it('refuses duplicate entry names', async () => {
  const entry = { name: 'project.json', blob: new Blob(['{}']) };
  await expect(writeZip([entry, entry])).rejects.toThrow(/repeats/);
});
it('refuses more than 1000 entries', async () => {
  await expect(writeZip(Array.from({ length: 1001 }, (_, id) => ({ name: `files/${id}/a`, blob: new Blob() })))).rejects.toThrow(/too large/);
});
it('refuses a per-file overflow before reading bytes', async () => {
  class TooLarge extends Blob { override get size() { return 50 * 1024 * 1024 + 1; } override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('must not read'); } }
  await expect(writeZip([{ name: 'files/a/large.nc', blob: new TooLarge() }])).rejects.toThrow(/too large/);
});
