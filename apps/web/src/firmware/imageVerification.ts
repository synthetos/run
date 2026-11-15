/** Byte checks on the page, repeated independently by the flash worker. */
import { sha256Hex } from '@synthetos/flasher';
import type { FirmwareRelease } from '@synthetos/protocol';
import type { ReleaseImage } from '../workspace/model.ts';
/**
 * The page's own check of an image against its GitHub metadata (SAFETY H22, H79): the exact bytes must hash to the
 * entry's SHA-256 at the entry's size. The machine worker checks again before it parses anything (authorizeFlash).
 */
export async function checkedImage(release: FirmwareRelease, bytes: Uint8Array, from: ReleaseImage['from']): Promise<{ readonly ok: true; readonly image: ReleaseImage } | { readonly ok: false; readonly message: string }> {
  if (bytes.byteLength !== release.size) return { ok: false, message: `The file is ${bytes.byteLength} bytes, not the ${release.size} the GitHub release list names for ${release.file}. Nothing was flashed.` };
  const sha256 = await sha256Hex(bytes);
  if (sha256 !== release.sha256) return { ok: false, message: `The file's SHA-256 is not the one the GitHub release list names for ${release.file}. It may be damaged or altered; nothing was flashed.` };
  return { ok: true, image: { release, hex: new TextDecoder().decode(bytes), from } };
}

export const localCopyHint = (release: FirmwareRelease): string => `Use a local copy: choose ${release.file}; Run checks it against the GitHub SHA-256.`;
