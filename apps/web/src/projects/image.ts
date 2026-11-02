/**
 * Re-encodes a project image (PROJECTS.md §1): decoded by the browser, drawn
 * onto a canvas no larger than 2000 px on its longer side, and encoded as
 * WebP. Drawing through a canvas keeps only the pixels, so EXIF metadata
 * (camera, time, location) is gone; the original file is never stored.
 * `imageOrientation: 'from-image'` applies the EXIF rotation before it is
 * dropped, so photos keep their orientation.
 */
import { fitWithin, IMAGE_MAX_PX } from './limits.ts';
import type { EncodedImage } from './store.ts';

export const WEBP_QUALITY = 0.86;

export async function encodeImage(file: Blob, doc: Document = document): Promise<EncodedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, IMAGE_MAX_PX);
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2D canvas');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
    if (blob === null || blob.type !== 'image/webp') throw new Error('this browser cannot encode WebP');
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

/** SHA-256 of `bytes`, as hex. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
