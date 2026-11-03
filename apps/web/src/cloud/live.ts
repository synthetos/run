/**
 * The two network reads of LIVE entry (ROADMAP P1-05). The cloud client is
 * the only network code in the web app (RUN_PLAN §5.3); it fetches and
 * returns data, and decides nothing. The UI-layer gates
 * (apps/web/src/live/) verify what comes back.
 *
 * - `/safety-advisory.json`, `no-store` (SAFETY H27): the signed advisory,
 *   verified by live/advisoryGate.ts.
 * - `/api/identity`, `no-store`: the identity the run Worker verified (the
 *   Cloudflare Access identity on staging, RUN_PLAN §2.2), for the D1 gate.
 *
 * Neither is ever on the machine path: a failure here can refuse a new
 * Connect or Start, never touch a running session.
 */
import type { IdentityBody } from '@synthetos/contracts';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type AdvisoryFetch = { readonly ok: true; readonly body: unknown } | { readonly ok: false };

const NO_STORE: RequestInit = Object.freeze({ cache: 'no-store', credentials: 'same-origin', redirect: 'error' });

export async function fetchSafetyAdvisory(fetchFn: FetchLike = (i, o) => fetch(i, o)): Promise<AdvisoryFetch> {
  try {
    const response = await fetchFn('/safety-advisory.json', NO_STORE);
    if (!response.ok) return { ok: false };
    return { ok: true, body: (await response.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

/** The verified identity, or null for anything else (signed out, offline, an error). */
export async function fetchIdentity(fetchFn: FetchLike = (i, o) => fetch(i, o)): Promise<IdentityBody['identity']> {
  try {
    const response = await fetchFn('/api/identity', NO_STORE);
    if (response.status !== 200) return null;
    const body = (await response.json()) as Partial<IdentityBody> | null;
    const id = body?.identity;
    if (id === null || typeof id !== 'object' || (id.provider !== 'access' && id.provider !== 'run-session')) return null;
    if (typeof id.subject !== 'string' || id.subject.length === 0) return null;
    return { provider: id.provider, subject: id.subject };
  } catch {
    return null;
  }
}

export interface FirmwareImageProgress {
  readonly received: number;
  /** The listed size, or the response's content-length when the list gave none. */
  readonly total: number | null;
}

export type FirmwareImageFetch = { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> } | { readonly ok: false; readonly reason: 'not-served' | 'too-large' | 'failed' };

/**
 * A firmware image named by the signed release list (SAFETY §4.8 as amended 2026-11-03; OD-10), fetched from run's own
 * origin at the path the list derives (`releasePath` in protocol: a GitHub-released image through the Worker's proxy,
 * `/firmware/<owner>/<name>/<tag>/<file>`; a simulator image from `/firmware/sim/`), read in chunks so the page can
 * show progress, capped at `limit` bytes (the listed size: a longer body is not the listed file). The caller (the
 * firmware hub) and then the machine worker check the SHA-256 and size against the signed entry before anything is
 * parsed or flashed; this function decides nothing. When the file is not served, the page asks for a local copy.
 */
export async function fetchFirmwareImage(path: string, limit: number, onProgress: (p: FirmwareImageProgress) => void = () => undefined, fetchFn: FetchLike = (i, o) => fetch(i, o)): Promise<FirmwareImageFetch> {
  if (!/^\/firmware\/[A-Za-z0-9][A-Za-z0-9._\/-]*\.hex$/.test(path) || path.includes('/../') || path.includes('//')) return { ok: false, reason: 'not-served' };
  try {
    const response = await fetchFn(path, { cache: 'default', credentials: 'same-origin', redirect: 'error' });
    if (!response.ok) return { ok: false, reason: 'not-served' };
    const declared = Number(response.headers.get('content-length') ?? '');
    const total = Number.isFinite(declared) && declared > 0 ? declared : null;
    if (total !== null && total > limit) return { ok: false, reason: 'too-large' };
    const body = response.body;
    if (body === null) return { ok: false, reason: 'failed' };
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    onProgress({ received, total });
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
      onProgress({ received, total });
    }
    const bytes = new Uint8Array(new ArrayBuffer(received));
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
