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
