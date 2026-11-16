import { LIMITS } from '../limits.ts';
import { crc32 } from './crc32.ts';
import { entryName, MAX_ENTRIES } from './paths.ts';

export interface ZipSource { name: string; blob: Blob }
interface Header { name: Uint8Array<ArrayBuffer>; size: number; crc: number; offset: number }
function localHeader(p: Header): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(30 + p.name.length); const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
  v.setUint16(12, 33, true); v.setUint32(14, p.crc, true);
  v.setUint32(18, p.size, true); v.setUint32(22, p.size, true); v.setUint16(26, p.name.length, true);
  bytes.set(p.name, 30); return bytes;
}
function centralHeader(p: Header): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(46 + p.name.length); const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true);
  v.setUint16(14, 33, true); v.setUint32(16, p.crc, true);
  v.setUint32(20, p.size, true); v.setUint32(24, p.size, true); v.setUint16(28, p.name.length, true); v.setUint32(42, p.offset, true);
  bytes.set(p.name, 46); return bytes;
}
function end(count: number, offset: number, size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(22); const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, count, true); v.setUint16(10, count, true);
  v.setUint32(12, size, true); v.setUint32(16, offset, true); return bytes;
}
async function header(source: ZipSource, offset: number): Promise<Header> {
  const name = new TextEncoder().encode(entryName(source.name));
  const crc = crc32(new Uint8Array(await source.blob.arrayBuffer()));
  return { name, size: source.blob.size, crc, offset };
}
/** Store-only ZIP (APPNOTE 4.3): retain Blob slices, never an array containing all file bytes. */
export async function writeZip(sources: AsyncIterable<ZipSource> | Iterable<ZipSource>): Promise<Blob> {
  const parts: BlobPart[] = []; const directory: Uint8Array<ArrayBuffer>[] = []; const names = new Set<string>();
  let offset = 0; let total = 0;
  for await (const source of sources) {
    if (names.has(source.name)) throw new Error('The zip repeats a file name.');
    names.add(source.name); total += source.blob.size;
    if (names.size > MAX_ENTRIES || total > LIMITS.project) throw new Error('The project is too large for a zip.');
    if (source.blob.size > LIMITS.gcode) throw new Error(`${source.name} is too large for a project file.`);
    const p = await header(source, offset); const local = localHeader(p);
    parts.push(local, source.blob); directory.push(centralHeader(p)); offset += local.length + p.size;
  }
  return new Blob([...parts, ...directory, end(names.size, offset, directory.reduce((n, d) => n + d.length, 0))], { type: 'application/zip' });
}
