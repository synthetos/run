import type { FetchLike, AdvisoryFetch } from './live.ts';
/** Public same-origin catalog data. Validation belongs to the consuming UI layer. */
export async function fetchToolCatalog(signal: AbortSignal, fetchFn: FetchLike = (i, o) => fetch(i, o)): Promise<AdvisoryFetch> {
  try {
    const response = await fetchFn('/api/catalog/tools', { method: 'GET', credentials: 'same-origin', redirect: 'error', signal });
    if (!response.ok) return { ok: false };
    return { ok: true, body: await response.json() as unknown };
  } catch { return { ok: false }; }
}
