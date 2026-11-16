import type { Project } from '@synthetos/library';
import { sha256Hex } from '../image.ts';
import type { ProjectStore } from '../store.ts';
import { projectManifest } from './manifest.ts';
import { filePath, imagePath, MAX_MANIFEST } from './paths.ts';
import { writeZip, type ZipSource } from './writer.ts';

export interface ExportOptions { progress?(text: string): void; download?(id: string): Promise<void> }
async function checked(store: ProjectStore, file: { id: string; name: string; size: number; hash?: string }): Promise<{ blob: Blob; hash: string }> {
  const blob = await store.blob(file.id);
  if (blob === null) throw new Error(`${file.name} is missing; download the project files and try again.`);
  if (blob.size !== file.size) throw new Error(`${file.name} does not match its recorded size.`);
  const hash = await sha256Hex(await blob.arrayBuffer());
  if (file.hash !== undefined && hash !== file.hash) throw new Error(`${file.name} does not match its recorded SHA-256.`);
  return { blob, hash };
}
async function bytes(store: ProjectStore, project: Project, options: ExportOptions): Promise<{ project: Project; sources: ZipSource[] }> {
  const sources: ZipSource[] = []; const images = [];
  for (const file of project.files) {
    options.progress?.(`Preparing ${file.name}…`);
    const { blob } = await checked(store, file); sources.push({ name: filePath(file), blob });
  }
  for (const image of project.images) {
    options.progress?.(`Preparing ${image.name}…`);
    const { blob, hash } = await checked(store, image); sources.push({ name: imagePath(image), blob }); images.push({ ...image, hash });
  }
  return { project: { ...project, images }, sources };
}
export async function exportProjectZip(store: ProjectStore, id: string, options: ExportOptions = {}): Promise<Blob> {
  const found = await store.exportRecord(id);
  if (!found) throw new Error('That project no longer exists.');
  const project = projectManifest(found);
  for (const file of [...project.files, ...project.images]) {
    if (await store.blob(file.id) !== null) continue;
    if (options.download) {
      options.progress?.(`Downloading ${file.name} from your account…`);
      // Recheck cached bytes even after a failed request so the refusal names the missing file.
      await options.download(id).catch(() => undefined);
    }
    break;
  }
  const prepared = await bytes(store, project, options);
  const manifest = new Blob([JSON.stringify(prepared.project, null, 2)]);
  if (manifest.size > MAX_MANIFEST) throw new Error('The project record is too large for a zip.');
  options.progress?.('Writing project zip…');
  return writeZip([{ name: 'project.json', blob: manifest }, ...prepared.sources]);
}
