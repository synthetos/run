import type { Project } from '@synthetos/library';
import { sha256Hex } from '../image.ts';
import { entryBytes, readZip, type ZipEntry } from './reader.ts';
import { filePath, imagePath, MAX_MANIFEST } from './paths.ts';
import { parseManifest } from './manifest.ts';
import { validateWebp, type ImageValidator } from './webp.ts';

export interface ProjectArchive { project: Project; blobs: ReadonlyMap<string, Blob> }
export interface ImportOptions { progress?(text: string): void; validateImage?: ImageValidator }
async function verified(entry: ZipEntry | undefined, file: { name: string; size: number; hash?: string }): Promise<Blob> {
  if (entry === undefined) throw new Error(`${file.name} is missing from the zip.`);
  if (entry.blob.size !== file.size) throw new Error(`${file.name} does not match its recorded size.`);
  if (file.hash === undefined || await sha256Hex(await entryBytes(entry)) !== file.hash) throw new Error(`${file.name} does not match its recorded SHA-256.`);
  return entry.blob;
}
/** Validate every byte before any project record or file is stored. Blob slices keep memory bounded. */
export async function readProjectArchive(zip: Blob, options: ImportOptions = {}): Promise<ProjectArchive> {
  options.progress?.('Reading project zip…');
  const entries = await readZip(zip); const manifest = entries.get('project.json');
  if (!manifest || manifest.blob.size > MAX_MANIFEST) throw new Error('The zip needs a project.json record within the size limit.');
  await entryBytes(manifest);
  const project = await parseManifest(manifest.blob); const blobs = new Map<string, Blob>();
  const expected = new Set(['project.json', ...project.files.map(filePath), ...project.images.map(imagePath)]);
  if ([...entries.keys()].some(name => !expected.has(name))) throw new Error('The zip contains files that are not in its project record.');
  for (const file of project.files) {
    options.progress?.(`Checking ${file.name}…`);
    blobs.set(file.id, await verified(entries.get(filePath(file)), file));
  }
  for (const image of project.images) {
    options.progress?.(`Checking ${image.name}…`);
    const blob = await verified(entries.get(imagePath(image)), image);
    await (options.validateImage ?? validateWebp)(blob, image); blobs.set(image.id, blob);
  }
  return { project, blobs };
}
