import { isProjectShape, readProject, type Project } from '@synthetos/library';
import { fileLimit, IMAGE_MAX_PX, LIMITS } from '../limits.ts';
import { component, filePath, imagePath, MAX_ENTRIES, MAX_MANIFEST } from './paths.ts';

export function projectManifest(value: unknown): Project {
  if (!isProjectShape(value)) throw new Error('The zip does not contain a valid project record.');
  const read = readProject(value);
  if (!read.ok) throw new Error('The zip does not contain a valid project record.');
  const project = read.value; component(project.id);
  const ids = new Set<string>(); let total = 0;
  for (const file of [...project.files, ...project.images]) {
    component(file.id);
    if (ids.has(file.id)) throw new Error('The project repeats a file or image id.');
    ids.add(file.id); total += file.size;
  }
  if (ids.size + 1 > MAX_ENTRIES || total > LIMITS.project) throw new Error('The project exceeds the zip entry or size limit.');
  for (const file of project.files) {
    filePath(file);
    if (file.size > fileLimit(file.role)) throw new Error(`${file.name} exceeds its file size limit.`);
  }
  for (const image of project.images) {
    imagePath(image);
    if (image.size > LIMITS.imageBeforeEncode || Math.max(image.width, image.height) > IMAGE_MAX_PX) throw new Error(`${image.name} exceeds the image limit.`);
  }
  return project;
}
export async function parseManifest(blob: Blob): Promise<Project> {
  if (blob.size > MAX_MANIFEST) throw new Error('The project record in the zip is too large.');
  let value: unknown;
  try { value = JSON.parse(await blob.text()); }
  catch { throw new Error('The zip does not contain a valid project record.'); }
  return projectManifest(value);
}
