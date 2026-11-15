/** Public, same-origin release metadata; GitHub notes remain text data. */
import { githubReleaseLoader } from './githubReleases.ts';
import type { GithubFirmwareRelease } from './githubReleaseData.ts';
export const loadGithubReleases = githubReleaseLoader((url, init) => fetch(url, init));
export async function githubReleaseRoute(request: Request, load = loadGithubReleases): Promise<Response> {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...headers, allow: 'GET' } });
  const origin = request.headers.get('origin');
  if ((origin !== null && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response(JSON.stringify({ error: 'cross_origin' }), { status: 403, headers });
  try {
    const releases: readonly GithubFirmwareRelease[] = await load();
    return new Response(JSON.stringify({ format: 'synthetos-run/github-releases@1', releases }), { headers });
  } catch {
    return new Response(JSON.stringify({ error: 'GitHub releases could not load. Check your connection and try again.' }), { status: 502, headers });
  }
}
