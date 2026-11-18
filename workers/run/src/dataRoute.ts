/** Data endpoints keep their own method, authentication and origin checks. */
import { withSecurityHeaders } from './headers.ts';
import { githubReleaseRoute } from './githubReleaseRoute.ts';
import { catalogRoute } from './catalogRoute.ts';
import { filesRoute } from './files.ts';
import { recordsRoute } from './records.ts';
import { avatarRoute, liveAvatarDeps, type AvatarDeps } from './avatarRoute.ts';
import type { Env } from './routes.ts';
import type { FirmwareProxyDeps } from './firmwareProxy.ts';
export function dataRoute(request: Request, context: {
  readonly pathname: string;
  readonly env: Env;
  readonly releases: FirmwareProxyDeps['releases'];
  /** Tests and the bench inject the avatar fetch and cache; the Worker uses the network and the Cache API. */
  readonly avatar?: AvatarDeps;
}): Promise<Response> | Response | null {
  const { pathname, env, releases } = context;
  if (pathname === '/api/firmware/releases') return githubReleaseRoute(request, releases).then(response => withSecurityHeaders(response));
  if (pathname === '/api/avatar') return avatarRoute(request, env, context.avatar ?? liveAvatarDeps(new URL(request.url).origin));
  if (pathname === '/api/catalog/tools') return catalogRoute(request);
  if (pathname === '/api/records' || pathname.startsWith('/api/records/')) return recordsRoute(request, env);
  if (pathname === '/api/files' || pathname.startsWith('/api/files/')) return filesRoute(request, env);
  return null;
}
