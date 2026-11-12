import { CATALOG_VERSION, ONSRUD_CATALOG } from './catalogData.ts';
/** Public same-origin data. No session or data-service binding is needed. */
export function catalogRoute(request: Request): Response {
  const origin = new URL(request.url).origin;
  const source = request.headers.get('origin'); const site = request.headers.get('sec-fetch-site');
  if ((source !== null && source !== origin) || (site !== null && site !== 'same-origin')) return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } });
  const etag = `"${CATALOG_VERSION}"`;
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600', etag, vary: 'Origin, Sec-Fetch-Site' };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(JSON.stringify({ version: CATALOG_VERSION, tools: ONSRUD_CATALOG }), { headers });
}
