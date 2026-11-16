import { expect, it } from 'vitest';
import { writeZip } from '../src/projects/zip/writer.ts';
import { entryBytes, readZip } from '../src/projects/zip/reader.ts';
import { patchZip, signatures } from './zipFixtures.ts';

const sample = () => writeZip([{ name: 'files/a/file.nc', blob: new Blob(['G0 X1']) }]);
it.each(['../escape.nc', '/etc/file.nc', 'files/../a.nc', 'files/a/../b.nc', 'files\\a\\x.nc', 'C:/files/a.nc', 'other/file.nc', 'files//x.nc', 'images/a.png'])('refuses unsafe or foreign entry %s in the reader', async bad => {
  const safe = `files/a/${'x'.repeat(bad.length - 8)}`;
  const zip = await writeZip([{ name: safe, blob: new Blob() }]);
  const changed = await patchZip(zip, (_, bytes) => {
    const name = new TextEncoder().encode(bad);
    for (const at of signatures(bytes, 0x04034b50)) bytes.set(name, at + 30);
    for (const at of signatures(bytes, 0x02014b50)) bytes.set(name, at + 46);
  });
  await expect(readZip(changed)).rejects.toThrow();
});
it.each([0, 1, 10, 21])('refuses a truncated archive of %s bytes', async size => {
  await expect(readZip((await sample()).slice(0, size))).rejects.toThrow();
});
it('detects damaged content with CRC before returning bytes', async () => {
  const zip = await patchZip(await sample(), (_, bytes) => { bytes[30 + 'files/a/file.nc'.length] = 90; });
  const entries = await readZip(zip); await expect(entryBytes(entries.values().next().value!)).rejects.toThrow(/damaged/);
});
it.each(['encrypted', 'deflated', 'size', 'local name', 'count', 'split', 'symlink', 'offset', 'duplicate'])('refuses inconsistent or unsupported headers: %s', async kind => {
  const zip = await writeZip([{ name: 'files/a/file.nc', blob: new Blob(['a']) }, { name: 'files/b/file.nc', blob: new Blob(['b']) }]);
  const changed = await patchZip(zip, (v, bytes) => {
    const c = signatures(bytes, 0x02014b50); const e = bytes.length - 22;
    if (kind === 'encrypted') v.setUint16(c[0]! + 8, 1, true);
    if (kind === 'deflated') v.setUint16(c[0]! + 10, 8, true);
    if (kind === 'size') v.setUint32(22, 99, true);
    if (kind === 'local name') bytes[38] = 98;
    if (kind === 'count') { v.setUint16(e + 8, 1001, true); v.setUint16(e + 10, 1001, true); }
    if (kind === 'split') v.setUint16(e + 4, 1, true);
    if (kind === 'symlink') v.setUint32(c[0]! + 38, 0xa0000000, true);
    if (kind === 'offset') v.setUint32(c[1]! + 42, 0, true);
    if (kind === 'duplicate') bytes[c[1]! + 46 + 6] = 97;
  });
  await expect(readZip(changed)).rejects.toThrow();
});
it('rejects a declared oversized file without reading its content', async () => {
  const zip = await patchZip(await sample(), (v, bytes) => {
    const c = signatures(bytes, 0x02014b50)[0]!; v.setUint32(c + 20, 50 * 1024 * 1024 + 1, true); v.setUint32(c + 24, 50 * 1024 * 1024 + 1, true);
  });
  await expect(readZip(zip)).rejects.toThrow(/limit/);
});
