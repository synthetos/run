import { afterEach, expect, it, vi } from 'vitest';
import { validateWebp } from '../src/projects/zip/webp.ts';
import { zipFixture } from './zipFixtures.ts';
import { webpSize } from '../src/projects/zip/webpSize.ts';
afterEach(() => vi.unstubAllGlobals());
it('decodes a WebP, checks dimensions and releases the bitmap', async () => {
  const { p, blobs } = await zipFixture(); const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2, height: 2, close })));
  await validateWebp(blobs.get('i1')!, p.images[0]!); expect(close).toHaveBeenCalledOnce();
});
it('rejects oversized dimensions before asking the browser to decode pixels', async () => {
  const { p, blobs } = await zipFixture(); const bytes = new Uint8Array(await blobs.get('i1')!.arrayBuffer()); bytes[25] = 255;
  const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
  await expect(validateWebp(new Blob([bytes]), p.images[0]!)).rejects.toThrow(/dimensions/); expect(decode).not.toHaveBeenCalled();
});
it.each(['VP8L', 'VP8 '])('reads simple %s dimensions', kind => {
  const bytes = new Uint8Array(30); bytes.set(new TextEncoder().encode(kind), 12);
  if (kind === 'VP8L') { bytes[20] = 0x2f; new DataView(bytes.buffer).setUint32(21, 1 | (1 << 14), true); }
  else { bytes.set([0x9d, 1, 0x2a, 2, 0, 2, 0], 23); }
  expect(webpSize(bytes)).toEqual({ width: 2, height: 2 });
});
it.each(['signature', 'length', 'decode', 'dimensions'])('refuses an image with invalid %s', async kind => {
  const { p, blobs } = await zipFixture(); let blob = blobs.get('i1')!; const close = vi.fn();
  const decode = vi.fn(async () => ({ width: kind === 'dimensions' ? 3 : 2, height: 2, close }));
  if (kind === 'signature') blob = new Blob(['not a webp!!']);
  if (kind === 'length') blob = new Blob([blob, 'extra']);
  if (kind === 'decode') decode.mockRejectedValue(new Error('invalid WebP'));
  vi.stubGlobal('createImageBitmap', decode);
  await expect(validateWebp(blob, p.images[0]!)).rejects.toThrow(/photo.webp/);
  if (kind === 'dimensions') expect(close).toHaveBeenCalledOnce();
});
