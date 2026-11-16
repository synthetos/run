import { LIMITS } from '../limits.ts';
import { crc32 } from './crc32.ts';
import { directory, central, localData } from './headers.ts';

export interface ZipEntry { name: string; blob: Blob; crc: number }
/** Read bounded headers only; content stays in slices of the selected File. */
export async function readZip(blob: Blob): Promise<Map<string, ZipEntry>> {
  const dir = await directory(blob); const entries = new Map<string, ZipEntry>();
  let at = dir.at; let total = 0; const spans: { start: number; end: number }[] = [];
  for (let i = 0; i < dir.count; i++) {
    const { header, end } = await central(blob, at);
    if (end > dir.end || entries.has(header.name)) throw new Error('The zip has duplicate or invalid entries.');
    total += header.size;
    if (total > LIMITS.project) throw new Error('The zip exceeds the 500 MB project limit.');
    const data = await localData(blob, header, dir.at);
    spans.push({ start: header.offset, end: data.end });
    entries.set(header.name, { name: header.name, blob: data.blob, crc: header.crc }); at = end;
  }
  spans.sort((a, b) => a.start - b.start);
  let end = 0;
  for (const span of spans) {
    if (span.start !== end) throw new Error('The zip contains overlapping or unlisted data.');
    end = span.end;
  }
  if (at !== dir.end || end !== dir.at) throw new Error('The zip directory is incomplete.');
  return entries;
}
export async function entryBytes(entry: ZipEntry): Promise<ArrayBuffer> {
  const bytes = await entry.blob.arrayBuffer();
  if (crc32(new Uint8Array(bytes)) !== entry.crc) throw new Error(`${entry.name} is damaged.`);
  return bytes;
}
