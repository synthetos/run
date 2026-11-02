/**
 * A minimal ZIP writer for "Download report files" (REPORT_A_PROBLEM §5):
 * stored entries only (method 0, no compression), UTF-8 names, CRC-32, one
 * central directory, no ZIP64. Enough for a few text files of a report; the
 * repository has no zip dependency and this does not add one.
 *
 * Format: PKWARE APPNOTE.TXT 6.3.x, sections 4.3.7 (local file header),
 * 4.3.12 (central directory header) and 4.3.16 (end of central directory).
 */

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array | string;
  /** Modification time written into the entry (DOS time, local fields). */
  readonly date?: Date;
}

/** Largest archive this writer makes (no ZIP64: every size and offset must fit 32 bits). */
export const ZIP_MAX_BYTES = 0xffff_fffe;

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table !== null) return table;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  table = t;
  return t;
}

/** CRC-32 (IEEE 802.3), as ZIP uses it. */
export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (t[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { readonly time: number; readonly date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** A safe entry name: no absolute path, no `..`, forward slashes only. */
export function zipName(name: string): string {
  const parts = name.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.' && p !== '..');
  const joined = parts.join('/').replace(/[\x00-\x1f]/g, '_');
  return joined === '' ? 'file' : joined;
}

/** The archive's bytes. Throws when it would need ZIP64. */
export function makeZip(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const prepared = entries.map((e) => {
    const name = enc.encode(zipName(e.name));
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    return { name, data, crc: crc32(data), when: dosTime(e.date ?? new Date()) };
  });
  const localSize = prepared.reduce((n, p) => n + 30 + p.name.length + p.data.length, 0);
  const centralSize = prepared.reduce((n, p) => n + 46 + p.name.length, 0);
  const total = localSize + centralSize + 22;
  if (total > ZIP_MAX_BYTES || prepared.length > 0xffff) throw new Error('report files: the archive is too large for a plain zip');
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  // General purpose flag bit 11: names are UTF-8.
  const UTF8 = 0x0800;
  for (const p of prepared) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, UTF8, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, p.when.time, true);
    view.setUint16(at + 12, p.when.date, true);
    view.setUint32(at + 14, p.crc, true);
    view.setUint32(at + 18, p.data.length, true);
    view.setUint32(at + 22, p.data.length, true);
    view.setUint16(at + 26, p.name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(p.name, at + 30);
    out.set(p.data, at + 30 + p.name.length);
    at += 30 + p.name.length + p.data.length;
  }
  const central = at;
  prepared.forEach((p, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, UTF8, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, p.when.time, true);
    view.setUint16(at + 14, p.when.date, true);
    view.setUint32(at + 16, p.crc, true);
    view.setUint32(at + 20, p.data.length, true);
    view.setUint32(at + 24, p.data.length, true);
    view.setUint16(at + 28, p.name.length, true);
    view.setUint16(at + 30, 0, true);
    view.setUint16(at + 32, 0, true);
    view.setUint16(at + 34, 0, true);
    view.setUint16(at + 36, 0, true);
    view.setUint32(at + 38, 0, true);
    view.setUint32(at + 42, offsets[i] as number, true);
    out.set(p.name, at + 46);
    at += 46 + p.name.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, prepared.length, true);
  view.setUint16(at + 10, prepared.length, true);
  view.setUint32(at + 12, at - central, true);
  view.setUint32(at + 16, central, true);
  view.setUint16(at + 20, 0, true);
  return out;
}
