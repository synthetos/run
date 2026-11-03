/**
 * Projects: what a project holds and its size limits (docs/design/PROJECTS.md
 * §1, §2). Pure.
 *
 * - Per file: 50 MB for G-code, 20 MB for any other file, 10 MB per image
 *   before it is re-encoded.
 * - Per project: 500 MB stored locally (files plus the re-encoded images).
 */

export const MB = 1024 * 1024;

export const LIMITS = Object.freeze({
  gcode: 50 * MB,
  other: 20 * MB,
  imageBeforeEncode: 10 * MB,
  project: 500 * MB,
});

/** Images are re-encoded to WebP no larger than this on their longer side. */
export const IMAGE_MAX_PX = 2000;

export type FileRole = 'gcode' | 'drawing' | 'model' | 'other';

export const ROLE_LABEL: Readonly<Record<FileRole, string>> = { gcode: 'G-code', drawing: 'Drawing (DXF, SVG)', model: 'Model (STL, STEP)', other: 'Other' };

export const GCODE_EXTENSIONS: readonly string[] = ['.nc', '.gcode', '.ngc', '.tap', '.txt', '.cnc'];
const DRAWING = ['.dxf', '.svg'];
const MODEL = ['.stl', '.step', '.stp'];
const IMAGE = ['.jpg', '.jpeg', '.png', '.webp'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function ext(name: string): string {
  const at = name.lastIndexOf('.');
  return at <= 0 ? '' : name.slice(at).toLowerCase();
}

/** What a dropped file is, from its name (and type for images). */
export function classify(name: string, type = ''): FileRole | 'image' {
  const e = ext(name);
  if (IMAGE.includes(e) || IMAGE_TYPES.includes(type)) return 'image';
  if (GCODE_EXTENSIONS.includes(e)) return 'gcode';
  if (DRAWING.includes(e)) return 'drawing';
  if (MODEL.includes(e)) return 'model';
  return 'other';
}

/** Also recognises files saved as Other before their extension was supported. */
export function isGcodeFile(file: { readonly name: string; readonly role: FileRole }): boolean {
  return file.role === 'gcode' || (file.role === 'other' && classify(file.name) === 'gcode');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} kB`;
  return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}

/** The per-file limit for a role. */
export function fileLimit(role: FileRole): number {
  return role === 'gcode' ? LIMITS.gcode : LIMITS.other;
}

export type LimitCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** May a file of `size` bytes in `role` be added to a project already holding `used` bytes? */
export function checkFile(name: string, size: number, role: FileRole, used: number): LimitCheck {
  const limit = fileLimit(role);
  if (size > limit) return { ok: false, reason: `${name} is ${formatBytes(size)}; ${role === 'gcode' ? 'G-code files' : 'files other than G-code'} can be up to ${formatBytes(limit)}.` };
  if (used + size > LIMITS.project) return { ok: false, reason: `${name} (${formatBytes(size)}) would take this project past ${formatBytes(LIMITS.project)}; ${formatBytes(Math.max(0, LIMITS.project - used))} is left.` };
  return { ok: true };
}

/** May an image of `size` bytes be re-encoded? (The encoded size is checked against the project limit after.) */
export function checkImage(name: string, size: number): LimitCheck {
  if (size > LIMITS.imageBeforeEncode) return { ok: false, reason: `${name} is ${formatBytes(size)}; images can be up to ${formatBytes(LIMITS.imageBeforeEncode)} before they are scaled down.` };
  return { ok: true };
}

/** The encoded image against what is left in the project. */
export function checkEncoded(name: string, size: number, used: number): LimitCheck {
  if (used + size > LIMITS.project) return { ok: false, reason: `${name} would take this project past ${formatBytes(LIMITS.project)}.` };
  return { ok: true };
}

/** Width and height scaled to fit within `max` on the longer side (never scaled up), rounded. */
export function fitWithin(width: number, height: number, max = IMAGE_MAX_PX): { readonly width: number; readonly height: number } {
  const longer = Math.max(width, height);
  if (longer <= max || longer <= 0) return { width: Math.round(width), height: Math.round(height) };
  const k = max / longer;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
