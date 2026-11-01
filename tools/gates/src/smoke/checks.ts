/**
 * Post-deploy smoke checks (ROADMAP P0-04, RUN_PLAN §6.3, SAFETY H45, H46,
 * T-S25). Pure functions over what the CLI (cli.ts) observed, so every check
 * is unit-tested on good and broken inputs.
 *
 * A header regression counts as a safety regression: the deploy job fails.
 *
 * Dependency-free. The expected headers come from the Worker's own
 * workers/run/src/headers.ts, the single source of truth.
 */
import { SECURITY_HEADERS } from '../../../../workers/run/src/headers.ts';

export interface SmokeFinding {
  readonly check: string;
  readonly message: string;
}

/**
 * Certificate authorities allowed to issue for run's hostnames: the CAs that
 * Cloudflare uses for custom-domain and edge certificates. The owner confirms
 * this list when setting the CAA record (docs/ops/account.md).
 */
export const ALLOWED_CAA_ISSUERS: readonly string[] = ['pki.goog', 'letsencrypt.org', 'ssl.com'];

/** Organisation names of those CAs as they appear in a certificate's issuer. */
export const ALLOWED_ISSUER_ORGS: readonly string[] = ['Google Trust Services', "Let's Encrypt", 'SSL Corporation'];

/** Minimal view of a fetched response. */
export interface Observed {
  readonly url: string;
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
}

/** Every security header present exactly once with exactly the expected value. */
export function checkSecurityHeaders(res: Observed): SmokeFinding[] {
  const findings: SmokeFinding[] = [];
  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    const actual = res.headers.get(name);
    if (actual === null) findings.push({ check: 'headers', message: `${res.url}: ${name} is missing` });
    else if (actual !== expected) findings.push({ check: 'headers', message: `${res.url}: ${name} is '${actual}', expected '${expected}'` });
  }
  return findings;
}

/** The shell page itself: 200, HTML, the workspace root, plus the headers. */
export function checkShell(res: Observed): SmokeFinding[] {
  const findings = checkSecurityHeaders(res);
  if (res.status !== 200) findings.push({ check: 'shell', message: `${res.url}: status ${res.status}, expected 200` });
  if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) findings.push({ check: 'shell', message: `${res.url}: not text/html` });
  if (!res.body.includes('<div id="app">')) findings.push({ check: 'shell', message: `${res.url}: the workspace root element is missing` });
  return findings;
}

/** `GET /api/health`: 200 JSON, no-store, this service and this environment. */
export function checkHealth(res: Observed, env: string): SmokeFinding[] {
  const findings = checkSecurityHeaders(res);
  const add = (message: string): void => {
    findings.push({ check: 'health', message: `${res.url}: ${message}` });
  };
  if (res.status !== 200) add(`status ${res.status}, expected 200`);
  if (!(res.headers.get('content-type') ?? '').startsWith('application/json')) add('not application/json');
  if (res.headers.get('cache-control') !== 'no-store') add(`cache-control is '${res.headers.get('cache-control') ?? ''}', expected 'no-store'`);
  let body: unknown;
  try {
    body = JSON.parse(res.body);
  } catch {
    add('body is not JSON');
    return findings;
  }
  const b = body as { status?: unknown; service?: unknown; env?: unknown };
  if (b.status !== 'ok') add(`status field is ${JSON.stringify(b.status)}`);
  if (b.service !== 'run') add(`service field is ${JSON.stringify(b.service)}`);
  if (b.env !== env) add(`env field is ${JSON.stringify(b.env)}, expected '${env}'`);
  return findings;
}

/** Cloudflare API `GET .../workers/scripts/{name}/subdomain` result: both must be off (H45). */
export function checkSubdomainSetting(result: unknown): SmokeFinding[] {
  const r = result as { enabled?: unknown; previews_enabled?: unknown } | null;
  const findings: SmokeFinding[] = [];
  if (r === null || typeof r !== 'object') return [{ check: 'preview', message: 'no subdomain setting returned by the Cloudflare API' }];
  if (r.enabled !== false) findings.push({ check: 'preview', message: `workers.dev is enabled (${JSON.stringify(r.enabled)})` });
  if (r.previews_enabled !== false) findings.push({ check: 'preview', message: `preview URLs are enabled (${JSON.stringify(r.previews_enabled)})` });
  return findings;
}

/** A probe of the Worker's workers.dev hostname must not serve anything (H45). */
export function checkWorkersDevProbe(url: string, outcome: { status: number } | 'unreachable'): SmokeFinding[] {
  if (outcome === 'unreachable' || outcome.status >= 400) return [];
  return [{ check: 'preview', message: `${url} answered ${outcome.status}: the workers.dev origin is live` }];
}

/** Staging must be behind Cloudflare Access (D31): an anonymous request is sent to the Access login. */
export function checkAccessGate(url: string, outcome: { status: number; location: string | null } | 'unreachable', allowUnreachable: boolean): SmokeFinding[] {
  if (outcome === 'unreachable') {
    return allowUnreachable ? [] : [{ check: 'access', message: `${url} is unreachable` }];
  }
  const redirect = [301, 302, 303, 307, 308].includes(outcome.status);
  let host = '';
  try {
    host = new URL(outcome.location ?? '', url).hostname;
  } catch {
    host = '';
  }
  if (redirect && host.endsWith('.cloudflareaccess.com')) return [];
  return [
    {
      check: 'access',
      message: `${url} answered ${outcome.status}${outcome.location === null ? '' : ` -> ${outcome.location}`} to an anonymous request: staging is NOT behind Cloudflare Access`,
    },
  ];
}

/** DNS-over-HTTPS JSON answer (RFC 8484 JSON form used by 1.1.1.1 and dns.google): validated (AD) and NOERROR. */
export function checkDnssec(resolver: string, answer: unknown): SmokeFinding[] {
  const a = answer as { Status?: unknown; AD?: unknown } | null;
  if (a === null || typeof a !== 'object') return [{ check: 'dnssec', message: `${resolver}: no answer` }];
  const findings: SmokeFinding[] = [];
  if (a.Status !== 0) findings.push({ check: 'dnssec', message: `${resolver}: DNS status ${JSON.stringify(a.Status)}` });
  if (a.AD !== true) findings.push({ check: 'dnssec', message: `${resolver}: answer is not DNSSEC-validated (AD flag not set)` });
  return findings;
}

export interface CaaRecord {
  readonly critical: number;
  readonly issue?: string;
  readonly issuewild?: string;
  readonly iodef?: string;
}

/** The relevant CAA set (after tree climbing) must exist and name only allowed CAs. */
export function checkCaa(name: string, records: readonly CaaRecord[]): SmokeFinding[] {
  if (records.length === 0) return [{ check: 'caa', message: `no CAA record applies to ${name}: any CA may issue` }];
  const findings: SmokeFinding[] = [];
  let issuers = 0;
  for (const r of records) {
    for (const value of [r.issue, r.issuewild]) {
      if (value === undefined) continue;
      issuers += 1;
      const domain = value.split(';')[0]?.trim().toLowerCase() ?? '';
      if (domain !== '' && !ALLOWED_CAA_ISSUERS.includes(domain)) findings.push({ check: 'caa', message: `${name}: CAA allows '${domain}'` });
    }
  }
  if (issuers === 0) findings.push({ check: 'caa', message: `${name}: CAA set has no issue or issuewild property` });
  return findings;
}

/** The served certificate's issuer organisation must be an expected CA. */
export function checkIssuer(host: string, issuerOrg: string | undefined): SmokeFinding[] {
  if (issuerOrg !== undefined && ALLOWED_ISSUER_ORGS.includes(issuerOrg)) return [];
  return [{ check: 'certificate', message: `${host}: certificate issued by '${issuerOrg ?? 'unknown'}', expected one of ${ALLOWED_ISSUER_ORGS.join(', ')}` }];
}
