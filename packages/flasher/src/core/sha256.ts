/**
 * SHA-256 as lower-case hex, with WebCrypto (available in the window and in
 * workers; no network). A release `.hex` is hashed over its exact bytes as
 * downloaded or chosen, before it is parsed (SAFETY H22, H79).
 */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True for a 64-digit lower-case hex SHA-256. */
export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
