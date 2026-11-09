/**
 * Small WebCrypto helpers for run's sign-in handoff (ROADMAP A1-06, RUN_PLAN §3.3).
 *
 * - `randomToken()`: 256 bits, base64url, no padding (43 characters).
 * - `sha256Hex()`: lower-case hex digests for the values run stores (only digests of bearer values).
 * - `keyedHash()`: HMAC-SHA-256 under the rate key, for edge IP addresses (never stored raw).
 * - `seal()`/`unseal()`: AES-GCM under the state key, bound to the request's state hash, for the PKCE verifier.
 *
 * Keys are canonical base64url 32-byte secrets set as Worker secrets. Anything else is refused (`readKey` returns
 * null), and the caller then treats sign-in as not configured. Dependency-free: the Worker may import only local
 * modules (tools/gates/src/build/worker.ts).
 */

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64url without padding; null for anything that is not canonical base64url. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  // Canonical only: re-encoding must give the same text (no stray low bits).
  return base64url(out) === text ? out : null;
}

/** A 256-bit random value, base64url (43 characters). */
export function randomToken(): string {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** True for exactly the shape `randomToken()` makes. */
export function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length === 43 && fromBase64url(value)?.length === 32;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(await subtle().digest('SHA-256', new TextEncoder().encode(value)));
}

/** The PKCE S256 challenge of a verifier (RFC 7636 §4.2). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await subtle().digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** The raw bytes of a canonical base64url 32-byte secret, or null. */
export function readKey(secret: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof secret !== 'string') return null;
  const bytes = fromBase64url(secret);
  return bytes !== null && bytes.length === 32 ? bytes : null;
}

export async function keyedHash(key: Uint8Array<ArrayBuffer>, value: string): Promise<string> {
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await subtle().sign('HMAC', k, new TextEncoder().encode(value)));
}

async function aesKey(key: Uint8Array<ArrayBuffer>, use: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  return subtle().importKey('raw', key, { name: 'AES-GCM' }, false, [use]);
}

/** Encrypts `plain` under `key`, bound to `context` (additional data). Returns `iv.ciphertext`, base64url. */
export async function seal(key: Uint8Array<ArrayBuffer>, plain: string, context: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, await aesKey(key, 'encrypt'), new TextEncoder().encode(plain));
  return `${base64url(iv)}.${base64url(new Uint8Array(data))}`;
}

/** Decrypts what `seal` made with the same key and context, or null (tampered, wrong context, malformed). */
export async function unseal(key: Uint8Array<ArrayBuffer>, sealed: string, context: string): Promise<string | null> {
  const [ivText, dataText, extra] = sealed.split('.');
  if (ivText === undefined || dataText === undefined || extra !== undefined) return null;
  const iv = fromBase64url(ivText);
  const data = fromBase64url(dataText);
  if (iv === null || iv.length !== 12 || data === null) return null;
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, await aesKey(key, 'decrypt'), data);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
