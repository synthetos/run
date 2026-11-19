/** OD-10, owner decision 2026-11-15: fixed TinyG GitHub API, no signing key. */
import { latestGithubReleases, type GithubFirmwareRelease } from './githubReleaseData.ts';
export const TINYG_RELEASES_API = 'https://api.github.com/repos/synthetos/TinyG/releases?per_page=100';
export const RELEASE_CACHE_MS = 10 * 60 * 1000;
export type GithubFetch = (url: string, init: RequestInit) => Promise<Response>;
const MAX_LIST_BYTES = 2 * 1024 * 1024;
async function readList(response: Response): Promise<unknown> {
  if (!response.ok || response.body === null) throw new Error(`GitHub releases could not load (HTTP ${response.status}). Try again.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_LIST_BYTES) { await reader.cancel(); throw new Error('GitHub release list exceeds the size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
/**
 * GitHub allows 60 keyless API calls an hour per address, and Cloudflare's shared
 * egress addresses use that up (staging and production got only refusals, owner
 * 2026-11-19). A read-only key for public repositories (the Worker secret
 * GITHUB_RELEASES_TOKEN) raises it to 5,000 an hour; without one the call is keyless.
 */
function requestHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'synthetos-run', 'x-github-api-version': '2022-11-28' };
  if (token !== undefined && token !== '') headers['authorization'] = `Bearer ${token}`;
  return headers;
}
/** Isolate-local cache, coalesced concurrent refresh, no stale fallback after expiry. */
export function githubReleaseLoader(fetcher: GithubFetch, now: () => number = Date.now) {
  let cached: { until: number; releases: readonly GithubFirmwareRelease[] } | null = null;
  let pending: Promise<readonly GithubFirmwareRelease[]> | null = null;
  async function refresh(token: string | undefined): Promise<readonly GithubFirmwareRelease[]> {
    const response = await fetcher(TINYG_RELEASES_API, { method: 'GET', redirect: 'error', headers: requestHeaders(token) });
    const releases = latestGithubReleases(await readList(response));
    cached = { until: now() + RELEASE_CACHE_MS, releases };
    return releases;
  }
  return async (token?: string): Promise<readonly GithubFirmwareRelease[]> => {
    if (cached !== null && now() < cached.until) return cached.releases;
    pending ??= refresh(token).finally(() => { pending = null; });
    return pending;
  };
}
