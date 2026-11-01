/**
 * Helpers shared by the two signed data files the app verifies: the
 * approved-builds manifest (approvedBuilds.ts, P0-08) and the safety advisory
 * (safetyAdvisory.ts, P1-05). Both are Ed25519-signed under a compiled-in
 * release key (releaseKeys.ts) over a domain-separation prefix plus the
 * payload's exact UTF-8 bytes. Nothing here throws.
 */

export async function verifyEd25519(publicKey: string, signature: string, message: string): Promise<boolean> {
  try {
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.importKey('raw', fromBase64(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await subtle.verify({ name: 'Ed25519' }, key, fromBase64(signature), new TextEncoder().encode(message));
  } catch {
    // Bad key or signature encoding, or no Ed25519 support: not verified.
    return false;
  }
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new Error('not base64');
  const binary = atob(text);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * An RFC 3339 UTC timestamp `YYYY-MM-DDTHH:MM:SSZ`, as milliseconds. It must
 * name a real instant exactly: `Date.parse` normalises 2026-02-31 to March 3
 * and 24:00:00 to the next day, so the parsed instant must print back as the
 * same text (P0-08 review).
 */
export function parseTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString() === `${value.slice(0, -1)}.000Z` ? ms : undefined;
}

/**
 * The clock as milliseconds, or undefined unless `now` is a genuine Date
 * holding a finite time. `Date.prototype.getTime` throws for anything that is
 * not a Date (whatever its own `getTime` says), and an Invalid Date gives NaN,
 * which would make both window comparisons false and fail open.
 */
export function clockMs(now: unknown): number | undefined {
  try {
    const ms = Date.prototype.getTime.call(now);
    return Number.isFinite(ms) ? ms : undefined;
  } catch {
    return undefined;
  }
}

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((k) => allowed.includes(k));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
