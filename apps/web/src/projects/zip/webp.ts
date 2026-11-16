import type { ProjectImage } from '@synthetos/library';
import { IMAGE_MAX_PX, LIMITS } from '../limits.ts';
import { webpSize } from './webpSize.ts';

export type ImageValidator = (blob: Blob, image: ProjectImage) => Promise<void>;
export const validateWebp: ImageValidator = async (blob, image) => {
  const bytes = new Uint8Array(await blob.slice(0, 30).arrayBuffer());
  const text = new TextDecoder('ascii');
  if (bytes.length < 12 || text.decode(bytes.slice(0, 4)) !== 'RIFF' || text.decode(bytes.slice(8, 12)) !== 'WEBP') throw new Error(`${image.name} is not a WebP image.`);
  if (new DataView(bytes.buffer).getUint32(4, true) + 8 !== blob.size || blob.size > LIMITS.imageBeforeEncode) throw new Error(`${image.name} is not a complete WebP image within the image limit.`);
  let size: { width: number; height: number };
  try { size = webpSize(bytes); }
  catch { throw new Error(`${image.name} is not a supported still WebP image.`); }
  if (size.width !== image.width || size.height !== image.height || Math.max(size.width, size.height) > IMAGE_MAX_PX) throw new Error(`${image.name} does not match its recorded image dimensions.`);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(blob); }
  catch { throw new Error(`${image.name} could not be read as a WebP image.`); }
  try {
    if (bitmap.width !== image.width || bitmap.height !== image.height || Math.max(bitmap.width, bitmap.height) > IMAGE_MAX_PX) throw new Error(`${image.name} does not match its recorded image dimensions.`);
  } finally { bitmap.close(); }
};
