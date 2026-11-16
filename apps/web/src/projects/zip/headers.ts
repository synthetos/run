import { entryName, MAX_ARCHIVE, MAX_ENTRIES, MAX_NAME } from './paths.ts';
import { LIMITS } from '../limits.ts';

export interface ZipHeader { name: string; size: number; crc: number; offset: number; flags: number }
const invalid = (): never => { throw new Error('This file is not a supported project zip.'); };
export async function view(blob: Blob, at: number, size: number): Promise<DataView> {
  if (at < 0 || size < 0 || at + size > blob.size) return invalid();
  return new DataView(await blob.slice(at, at + size).arrayBuffer());
}
export async function directory(blob: Blob): Promise<{ at: number; end: number; count: number }> {
  if (blob.size < 22 || blob.size > MAX_ARCHIVE) return invalid();
  const start = Math.max(0, blob.size - 65557); const tail = await view(blob, start, blob.size - start);
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) !== 0x06054b50 || i + 22 + tail.getUint16(i + 20, true) !== tail.byteLength) continue;
    const count = tail.getUint16(i + 10, true); const at = tail.getUint32(i + 16, true); const end = start + i;
    if (tail.getUint32(i + 4, true) !== 0 || tail.getUint16(i + 8, true) !== count) return invalid();
    if (count > MAX_ENTRIES) throw new Error('A project zip can contain at most 1000 entries.');
    if (at + tail.getUint32(i + 12, true) !== end) return invalid();
    return { at, end, count };
  }
  return invalid();
}
function encoding(flags: number, method: number): void {
  if ((flags & ~0x0800) !== 0 || method !== 0) throw new Error('Use an uncompressed project zip without encryption.');
}
async function nameAt(blob: Blob, at: number, size: number): Promise<string> {
  if (size === 0 || size > MAX_NAME) return invalid();
  try { return entryName(new TextDecoder('utf-8', { fatal: true }).decode(await blob.slice(at, at + size).arrayBuffer())); }
  catch (error) { if (error instanceof TypeError) return invalid(); throw error; }
}
export async function central(blob: Blob, at: number): Promise<{ header: ZipHeader; end: number }> {
  const v = await view(blob, at, 46);
  if (v.getUint32(0, true) !== 0x02014b50 || v.getUint16(34, true) !== 0) return invalid();
  const flags = v.getUint16(8, true); encoding(flags, v.getUint16(10, true));
  const size = v.getUint32(24, true); const length = v.getUint16(28, true);
  if (size !== v.getUint32(20, true) || size > LIMITS.gcode) throw new Error('A file in the zip exceeds the project file limit.');
  const mode = v.getUint32(38, true) >>> 16;
  if ((mode & 0xf000) !== 0 && (mode & 0xf000) !== 0x8000) return invalid();
  const name = await nameAt(blob, at + 46, length);
  return { header: { name, size, flags, crc: v.getUint32(16, true), offset: v.getUint32(42, true) }, end: at + 46 + length + v.getUint16(30, true) + v.getUint16(32, true) };
}
export async function localData(blob: Blob, p: ZipHeader, centralAt: number): Promise<{ blob: Blob; end: number }> {
  const v = await view(blob, p.offset, 30);
  if (v.getUint32(0, true) !== 0x04034b50 || v.getUint16(6, true) !== p.flags) return invalid();
  encoding(v.getUint16(6, true), v.getUint16(8, true));
  if (v.getUint32(14, true) !== p.crc || v.getUint32(18, true) !== p.size || v.getUint32(22, true) !== p.size) return invalid();
  const length = v.getUint16(26, true); const start = p.offset + 30 + length + v.getUint16(28, true);
  if (start + p.size > centralAt || await nameAt(blob, p.offset + 30, length) !== p.name) return invalid();
  return { blob: blob.slice(start, start + p.size), end: start + p.size };
}
