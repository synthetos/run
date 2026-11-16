import { LIMITS } from '../limits.ts';
export const MAX_ENTRIES = 1000;
export const MAX_MANIFEST = 1024 * 1024;
export const MAX_NAME = 1024;
export const MAX_ARCHIVE = LIMITS.project + MAX_ENTRIES * (2 * MAX_NAME + 76) + 65557;

export function component(value: string): string {
  if (!value || value === '.' || value === '..' || /[\\/:\x00-\x1f\x7f]/.test(value)) throw new Error('The zip contains an unsafe file name.');
  return value;
}
/** No sanitizing: a rejected path must never quietly alias another entry. */
export function entryName(name: string): string {
  if (new TextEncoder().encode(name).length > MAX_NAME) throw new Error('A file name in the zip is too long.');
  const parts = name.split('/');
  parts.forEach(component);
  if (name === 'project.json') return name;
  if (parts.length === 3 && parts[0] === 'files') return name;
  if (parts.length === 2 && parts[0] === 'images' && parts[1]!.endsWith('.webp')) return name;
  throw new Error('The zip contains an entry outside the project files and images.');
}
export const filePath = (file: { id: string; name: string }): string => entryName(`files/${component(file.id)}/${component(file.name)}`);
export const imagePath = (image: { id: string }): string => entryName(`images/${component(image.id)}.webp`);
