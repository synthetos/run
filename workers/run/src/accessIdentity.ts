/**
 * The verified Cloudflare Access identity (ROADMAP P1-05; RUN_PLAN §2.2;
 * D31, D41, accepted 2026-11-02).
 *
 * On staging, before A1-07 ships accounts.synthetos.com sessions, the D1
 * sign-in gate is satisfied by the Access identity: Cloudflare Access puts a
 * signed JWT in `Cf-Access-Jwt-Assertion` on every request it lets through.
 * Access already blocks anyone else at the edge; this Worker still checks
 * the token itself (RS256 under the team's published certs, the application
 * audience, the issuer and the validity window) so a misrouted request
 * without Access in front never counts as signed in.
 *
 * Uses WebCrypto only (no npm). The certs fetcher is injected for tests.
 */

export interface AccessConfig {
  /** `<team>.cloudflareaccess.com`. */
  readonly teamDomain: string;
  /** The Access application's AUD tag. */
  readonly aud: string;
}

export interface Jwk {
  readonly kid?: string;
  readonly kty?: string;
  readonly n?: string;
  readonly e?: string;
  readonly alg?: string;
}

export type CertsFetcher = (url: string) => Promise<readonly Jwk[]>;

export interface AccessIdentity {
  readonly subject: string;
}

/** Clock skew tolerated on `nbf`/`iat`, in seconds. */
const SKEW_S = 60;

function b64urlBytes(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(new TextDecoder().decode(b64urlBytes(text))) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** A config usable for verification, or null when either value is missing or a placeholder. */
export function accessConfig(teamDomain: unknown, aud: unknown): AccessConfig | null {
  if (typeof teamDomain !== 'string' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain)) return null;
  if (typeof aud !== 'string' || !/^[0-9a-f]{64}$/.test(aud)) return null;
  return { teamDomain, aud };
}

/** The verified identity in an Access JWT, or null. Never throws. */
export async function verifyAccessJwt(token: string | null, config: AccessConfig, nowMs: number, fetchCerts: CertsFetcher): Promise<AccessIdentity | null> {
  try {
    if (token === null) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = b64urlJson(h);
    const payload = b64urlJson(p);
    if (header === undefined || payload === undefined) return null;
    if (header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') return null;
    const certs = await fetchCerts(`https://${config.teamDomain}/cdn-cgi/access/certs`);
    const jwk = certs.find((k) => k.kid === header['kid'] && k.kty === 'RSA');
    if (jwk === undefined || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const aud = payload['aud'];
    const auds = Array.isArray(aud) ? aud : [aud];
    if (!auds.includes(config.aud)) return null;
    if (payload['iss'] !== `https://${config.teamDomain}`) return null;
    const now = nowMs / 1000;
    const exp = payload['exp'];
    if (typeof exp !== 'number' || !(now < exp)) return null;
    const nbf = payload['nbf'];
    if (nbf !== undefined && (typeof nbf !== 'number' || nbf > now + SKEW_S)) return null;
    const subject = typeof payload['email'] === 'string' ? payload['email'] : payload['sub'];
    if (typeof subject !== 'string' || subject.length === 0) return null;
    return { subject };
  } catch {
    return null;
  }
}

let cached: { url: string; until: number; keys: readonly Jwk[] } | null = null;

/** Fetches the team's certs, cached for five minutes per isolate. */
export const fetchAccessCerts: CertsFetcher = async (url) => {
  const now = Date.now();
  if (cached !== null && cached.url === url && now < cached.until) return cached.keys;
  const response = await fetch(url);
  if (!response.ok) return [];
  const body = (await response.json()) as { keys?: unknown };
  const keys = Array.isArray(body.keys) ? (body.keys as Jwk[]) : [];
  cached = { url, until: now + 5 * 60_000, keys };
  return keys;
};
