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

/**
 * Permissions-Policy features: the wake lock for this origin only; everything
 * else off.
 *
 * PRODUCTION: `serial=()`. RUN_PLAN §6.4 grants `serial=(self)` "from the
 * Phase 1 bench app onward", but production serves only the Phase 0 shell
 * until Phase 6 (ROADMAP hard rules, P1-09), and the source and bundle gates
 * are pattern checks that cannot prove arbitrary JavaScript safe. With
 * `serial=()` the browser itself refuses Web Serial to every document on
 * this origin (and to the workers it creates), however a script reaches the
 * API. This is the set the static `_headers` file carries, so every response
 * the Worker does not build (assets served directly by the asset layer)
 * denies serial too: that path fails closed.
 *
 * P1-00 (owner-approved): staging and the localhost bench build get
 * `serial=(self)` (SERIAL_GRANTED_PERMISSIONS_POLICY_FEATURES), and only
 * through `grantsSerial` below or the bench server.
 */
export const PERMISSIONS_POLICY_FEATURES: readonly string[] = [
  'serial=()',
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
 * The staging and bench Permissions-Policy (P1-00): the production list with
 * `serial=(self)` in place of `serial=()`, and nothing else changed. Web
 * Serial for this origin only, never for a frame or another origin.
 */
export const SERIAL_GRANTED_PERMISSIONS_POLICY_FEATURES: readonly string[] = PERMISSIONS_POLICY_FEATURES.map((feature) =>
  feature === 'serial=()' ? 'serial=(self)' : feature,
);

function securityHeaders(permissionsPolicy: readonly string[]): Readonly<Record<string, string>> {
  return Object.freeze({
    'content-security-policy': CSP_DIRECTIVES.join('; '),
    'permissions-policy': permissionsPolicy.join(', '),
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
  });
}

/**
 * The headers every PRODUCTION response carries (and the `_headers` file),
 * with lower-case names, in the order RUN_PLAN §6.4 lists them. HSTS has no
 * `preload` yet (D29: preload after a further subdomain audit).
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = securityHeaders(PERMISSIONS_POLICY_FEATURES);

/**
 * The staging and bench headers (P1-00): SECURITY_HEADERS with
 * `serial=(self)`. Every other header is identical.
 */
export const SERIAL_GRANTED_SECURITY_HEADERS: Readonly<Record<string, string>> = securityHeaders(SERIAL_GRANTED_PERMISSIONS_POLICY_FEATURES);

/** The staging host (D31: behind Cloudflare Access). The only deployed host that may grant serial. */
export const STAGING_HOST = 'staging.run.synthetos.com';

/**
 * True only for a request to `https://staging.run.synthetos.com` handled by
 * the Worker deployed as staging (`RUN_ENV` exactly `staging`). Both must
 * hold: a production Worker never grants serial whatever the host, and a
 * staging Worker reached under any other name (there should be none:
 * workers_dev and preview_urls are off, H45) does not either. Anything
 * unexpected, a missing or odd RUN_ENV included, gets the production
 * headers.
 */
export function grantsSerial(runEnv: unknown, url: URL): boolean {
  return runEnv === 'staging' && url.protocol === 'https:' && url.hostname === STAGING_HOST && url.port === '';
}

/** The header set for a response: serial granted (staging, bench) or not (production, everything else). */
export function securityHeadersFor(serialGranted: boolean): Readonly<Record<string, string>> {
  return serialGranted ? SERIAL_GRANTED_SECURITY_HEADERS : SECURITY_HEADERS;
}

/** Cache policy for content-hashed build assets (`/assets/*`): their bytes never change under a name. */
export const HASHED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Cache policy for every API and auth response (RUN_PLAN §6.4). */
export const API_CACHE_CONTROL = 'no-store';

/**
 * Returns a copy of `response` carrying exactly the given security headers
 * (production unless the caller says otherwise). Any value already present
 * for one of these names (for example from the asset layer) is replaced,
 * never merged, so nothing upstream can weaken or widen them. Other headers,
 * the status and the body are kept.
 */
export function withSecurityHeaders(response: Response, headers: Readonly<Record<string, string>> = SECURITY_HEADERS): Response {
  const wrapped = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) {
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
 * Renders the static-assets `_headers` file. `/*` applies the PRODUCTION
 * security headers (`serial=()`) to every asset response, including the 404
 * page and redirects, in every environment: on staging, where the Worker runs
 * first for every path (wrangler.jsonc), it replaces them; anything served
 * past the Worker still denies serial. `/assets/*` adds the immutable cache
 * policy for hashed files.
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
