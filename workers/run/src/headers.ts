/**
 * Security headers for run.synthetos.com (RUN_PLAN §6.4, SAFETY H5/H45,
 * T-S25). This module is the single source of truth for them.
 *
 * Two mechanisms carry the same headers, because Cloudflare serves static
 * assets without invoking the Worker unless a path is in `run_worker_first`
 * (only `/api/*` and `/auth/*`, ROADMAP P0-04):
 *
 * - `withSecurityHeaders()` wraps every response the Worker builds or
 *   proxies (API, auth, errors, and any asset request that does reach it);
 * - `renderHeadersFile()` renders the static-assets `_headers` file
 *   (apps/web/public/_headers), which Cloudflare applies to asset responses
 *   and which `_headers` never applies to Worker responses
 *   (https://developers.cloudflare.com/workers/static-assets/headers/).
 *
 * The committed `_headers` file is tested to be byte-identical to
 * `renderHeadersFile()`, the Playwright header test asserts the exact set on
 * served pages, and the post-deploy smoke test asserts it in production. A
 * header regression is a safety regression (RUN_PLAN §6.3).
 *
 * Changing anything here needs safety-path review (CODEOWNERS, SAFETY §8
 * item 15: "CSP and Trusted Types are not loosened").
 */

/** The only Trusted Types policy names the page may create (apps/web/src/security/tt.ts, T-S25). */
export const TRUSTED_TYPES_POLICIES: readonly string[] = ['rs-worker', 'rs-svg-export'];

/** CSP directives, in the order RUN_PLAN §6.4 lists them. */
export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "require-trusted-types-for 'script'",
  `trusted-types ${TRUSTED_TYPES_POLICIES.join(' ')}`,
];

/** Permissions-Policy features: the serial grant and the wake lock for this origin only; everything else off. */
export const PERMISSIONS_POLICY_FEATURES: readonly string[] = [
  'serial=(self)',
  'screen-wake-lock=(self)',
  'usb=()',
  'hid=()',
  'bluetooth=()',
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
];

/**
 * The headers every response carries, with lower-case names, in the order
 * RUN_PLAN §6.4 lists them. HSTS has no `preload` yet (D29: preload after a
 * further subdomain audit).
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy': CSP_DIRECTIVES.join('; '),
  'permissions-policy': PERMISSIONS_POLICY_FEATURES.join(', '),
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
});

/** Cache policy for content-hashed build assets (`/assets/*`): their bytes never change under a name. */
export const HASHED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Cache policy for every API and auth response (RUN_PLAN §6.4). */
export const API_CACHE_CONTROL = 'no-store';

/**
 * Returns a copy of `response` carrying exactly the security headers above.
 * Any value already present for one of these names (for example from the
 * asset layer) is replaced, never merged, so nothing upstream can weaken
 * them. Other headers, the status and the body are kept.
 */
export function withSecurityHeaders(response: Response): Response {
  const wrapped = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    wrapped.headers.set(name, value);
  }
  return wrapped;
}

/** Canonical header-name spelling for the `_headers` file (names are case-insensitive on the wire). */
function displayName(name: string): string {
  return name.replace(/(^|-)([a-z])/g, (_m, dash: string, c: string) => `${dash}${c.toUpperCase()}`);
}

/** Cloudflare's per-line limit for `_headers` (2,000 characters). */
export const HEADERS_FILE_MAX_LINE = 2000;

/**
 * Renders the static-assets `_headers` file. `/*` applies the security
 * headers to every asset response, including the 404 page and redirects;
 * `/assets/*` adds the immutable cache policy for hashed files.
 */
export function renderHeadersFile(): string {
  const lines = [
    '# GENERATED from workers/run/src/headers.ts by `pnpm gen:headers`.',
    '# Do not edit: a test fails unless this file matches the generator byte for byte (ROADMAP P0-04).',
    '/*',
    ...Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${displayName(name)}: ${value}`),
    '/assets/*',
    `  Cache-Control: ${HASHED_ASSET_CACHE_CONTROL}`,
    '',
  ];
  return lines.join('\n');
}
