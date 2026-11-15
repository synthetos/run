/** Data endpoints keep their own method, authentication and origin checks. */
import { githubReleaseRoute } from './githubReleaseRoute.ts';
import { catalogRoute } from './catalogRoute.ts';
import { recordsRoute } from './records.ts';
import type { Env } from './routes.ts';
import type { FirmwareProxyDeps } from './firmwareProxy.ts';
export function dataRoute(request: Request, context: {
  readonly pathname: string;
  readonly env: Env;
  readonly releases: FirmwareProxyDeps['releases'];
}): Promise<Response> | Response | null {
  const { pathname, env, releases } = context;
  if (pathname === '/api/firmware/releases') return githubReleaseRoute(request, releases);
  if (pathname === '/api/catalog/tools') return catalogRoute(request);
  if (pathname === '/api/records' || pathname.startsWith('/api/records/')) return recordsRoute(request, env);
  return null;
}
