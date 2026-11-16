import type { Project } from '@synthetos/library';
import { sha256Hex } from '../src/projects/image.ts';
import { writeZip, type ZipSource } from '../src/projects/zip/writer.ts';
import { filePath, imagePath } from '../src/projects/zip/paths.ts';
import { at, project } from './syncFixtures.ts';

export async function zipFixture() {
  const file = new Blob(['G0 X1\n']); const image = new Blob(['RIFF\x16\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0\x01\0\0\x01\0\0']);
  const p: Project = { ...project(), files: [{ id: 'f1', name: '切削 plate.nc', size: file.size, hash: await sha256Hex(await file.arrayBuffer()), role: 'gcode', note: '', addedAt: at }],
    images: [{ id: 'i1', name: 'photo.webp', size: image.size, hash: await sha256Hex(await image.arrayBuffer()), width: 2, height: 2, addedAt: at }], cover: 'i1' };
  const blobs = new Map([['f1', file], ['i1', image]]);
  return { p, blobs, zip: await projectZip(p, blobs) };
}
export async function projectZip(p: Project, blobs: ReadonlyMap<string, Blob>, extra: ZipSource[] = []): Promise<Blob> {
  const entries: ZipSource[] = [{ name: 'project.json', blob: new Blob([JSON.stringify(p)]) }];
  for (const file of p.files) if (blobs.has(file.id)) entries.push({ name: filePath(file), blob: blobs.get(file.id)! });
  for (const image of p.images) if (blobs.has(image.id)) entries.push({ name: imagePath(image), blob: blobs.get(image.id)! });
  return writeZip([...entries, ...extra]);
}
export async function patchZip(blob: Blob, change: (view: DataView, bytes: Uint8Array) => void): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer()); change(new DataView(bytes.buffer), bytes); return new Blob([bytes]);
}
export function signatures(bytes: Uint8Array, signature: number): number[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const result = [];
  for (let at = 0; at + 4 <= bytes.length; at++) if (v.getUint32(at, true) === signature) result.push(at);
  return result;
}

/** A blob that claims to be over the per-file limit and must never be read. */
export class TooLargeBlob extends Blob {
  override get size(): number { return 50 * 1024 * 1024 + 1; }
  override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('must not read'); }
}
