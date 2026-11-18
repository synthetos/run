/**
 * `GET /api/avatar`: the signed-in user's GitHub picture, same-origin (owner, 2026-11-18: "pull the icon from the
 * gh account to show up on the top right as the user signed in").
 *
 * The page's CSP is `img-src 'self' data: blob:` and the bundle scan admits no other origin in app JS, so the browser
 * never talks to GitHub. The Worker does, under these rules:
 * - only with a validated run session (authSession.ts), else 401 like the other API routes;
 * - only for a GitHub identity whose id is a plain number: `https://avatars.githubusercontent.com/u/<id>?s=96&v=4`,
 *   fetched with `redirect: 'manual'`, a 10 s timeout and a 256 KB cap;
 * - only a 200 whose type is png, jpeg, gif or webp is served; anything else is a detail-free 404;
 * - the bytes are cached per GitHub id for a day (the Cache API on Cloudflare, a map on the bench and in tests), and
 *   the answer is `private, max-age=86400` with `vary: Cookie`, since it depends on who is signed in.
 *
 * The caller (index.ts) adds the security headers; nothing here decides anything about the machine.
 */
import { authConfig } from './authConfig.ts';
import { githubIdentityId, validRunSession } from './authSession.ts';
import type { FetchLike } from './firmwareProxy.ts';
import { type Env, json } from './routes.ts';

export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_TIMEOUT_MS = 10_000;
export const AVATAR_TYPES: readonly string[] = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const AVATAR_CACHE_CONTROL = 'private, max-age=86400';
const CACHE_SECONDS = 86_400;

export interface CachedAvatar {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly type: string;
}

/** A store of fetched avatars by GitHub id. Failures are swallowed: the cache only saves a fetch. */
export interface AvatarCache {
  get(id: string): Promise<CachedAvatar | undefined>;
  put(id: string, value: CachedAvatar): Promise<void>;
}

export interface AvatarDeps {
  readonly fetch: FetchLike;
  readonly cache: AvatarCache;
}

export function memoryAvatarCache(): AvatarCache {
  const store = new Map<string, CachedAvatar>();
  return {
    get: (id) => Promise.resolve(store.get(id)),
    put: (id, value) => { store.set(id, value); return Promise.resolve(); },
  };
}

const NO_CACHE: AvatarCache = Object.freeze({ get: () => Promise.resolve(undefined), put: () => Promise.resolve() });

/** The Cache API under this request's origin, keyed by GitHub id; nothing is cached where it is absent. */
function workerAvatarCache(origin: string): AvatarCache {
  const store = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (store === undefined) return NO_CACHE;
  const key = (id: string): string => `${origin}/api/avatar/.github/${id}`;
  return {
    async get(id) {
      const hit = await store.match(key(id));
      if (hit === undefined) return undefined;
      return { bytes: new Uint8Array(await hit.arrayBuffer()), type: hit.headers.get('content-type') ?? '' };
    },
    async put(id, value) {
      await store.put(key(id), new Response(value.bytes.slice(), { headers: { 'content-type': value.type, 'cache-control': `public, max-age=${String(CACHE_SECONDS)}` } }));
    },
  };
}

export function liveAvatarDeps(origin: string): AvatarDeps {
  return { fetch: (url, init) => fetch(url, init), cache: workerAvatarCache(origin) };
}

/** The upstream body when it is a 200 of a listed image type within the cap; undefined otherwise. Never throws. */
async function readAvatar(response: Response): Promise<CachedAvatar | undefined> {
  if (response.status !== 200) return undefined;
  const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!AVATAR_TYPES.includes(type)) return undefined;
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) return undefined;
  const body = response.body;
  if (body === null) return undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AVATAR_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return { bytes, type };
}

/** The avatar for one GitHub id: the cache first, then GitHub. Never throws. */
async function loadAvatar(id: string, deps: AvatarDeps): Promise<CachedAvatar | undefined> {
  const cached = await deps.cache.get(id).catch(() => undefined);
  if (cached !== undefined && AVATAR_TYPES.includes(cached.type) && cached.bytes.byteLength <= AVATAR_MAX_BYTES) return cached;
  let response: Response;
  try {
    response = await deps.fetch(`https://avatars.githubusercontent.com/u/${id}?s=96&v=4`, { method: 'GET', redirect: 'manual', headers: { accept: 'image/*' }, signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
  } catch {
    return undefined;
  }
  const avatar = await readAvatar(response).catch(() => undefined);
  if (avatar !== undefined) await deps.cache.put(id, avatar).catch(() => undefined);
  return avatar;
}

export async function avatarRoute(request: Request, env: Env, deps: AvatarDeps): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
  const auth = authConfig(env, new URL(request.url));
  const session = auth === null ? null : await validRunSession(request, auth);
  if (session === null) return json(401, { error: 'unauthorized' });
  const id = githubIdentityId(session);
  const avatar = id === null ? undefined : await loadAvatar(id, deps);
  if (avatar === undefined) return json(404, { error: 'not_found' });
  return new Response(avatar.bytes, { status: 200, headers: { 'content-type': avatar.type, 'content-length': String(avatar.bytes.byteLength), 'cache-control': AVATAR_CACHE_CONTROL, vary: 'Cookie' } });
}
