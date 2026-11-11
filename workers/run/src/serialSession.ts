/** Server-side production serial grant. The accounts binding owns admission and session revocation. */
import { authConfig, type AuthEnv } from './authConfig.ts';
import { runSessionIdentity } from './authSession.ts';

export async function serialSession(request: Request, env: AuthEnv): Promise<boolean> {
  const config = authConfig(env, new URL(request.url));
  return config !== null && await runSessionIdentity(request, config) !== null;
}
