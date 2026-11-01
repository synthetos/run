/**
 * Post-deploy smoke test (ROADMAP P0-04, RUN_PLAN §6.3, SAFETY H45, H46,
 * T-S25). The deploy jobs run it right after `wrangler deploy`; any finding
 * fails the job.
 *
 *   node tools/gates/src/smoke/cli.ts --env production
 *     the shell, a hashed asset, the 404 page and /api/health with the exact
 *     headers; workers.dev and preview URLs off (Cloudflare API and a probe);
 *     DNSSEC (two validating resolvers); the CAA record; the certificate issuer.
 *   node tools/gates/src/smoke/cli.ts --env staging
 *     the same infrastructure checks, that the Cloudflare API shows an
 *     Access application covering the host with no Bypass or Everyone
 *     policy, and that an anonymous request is sent to Cloudflare Access
 *     (D31). Staging content is checked through the same artifact in
 *     production; the deploy job holds no Access credential.
 *   node tools/gates/src/smoke/cli.ts --env staging --pre-deploy
 *     before every staging deploy: refuses unless the Cloudflare API shows
 *     that Access application (a POSITIVE check: "unreachable" alone never
 *     passes), and, when the host already answers, it redirects an anonymous
 *     request to the Access login.
 *   node tools/gates/src/smoke/cli.ts --base-url http://127.0.0.1:8787 [--expect-env production]
 *     local mode against `wrangler dev`: the HTTP checks only.
 *
 * Environment: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (the deploy
 * job's) for the subdomain-setting check and the Access API check (the token
 * needs "Access: Apps and Policies Read", docs/ops/access.md);
 * RUN_WORKERS_DEV_SUBDOMAIN (the account's workers.dev subdomain, a
 * repository variable) for the probe.
 *
 * Exit status: 0 pass, 1 findings, 2 could not run.
 */
import { Resolver } from 'node:dns/promises';
import { connect } from 'node:tls';
import { parseArgs } from 'node:util';
import { ENVIRONMENTS, isDeployEnvironment } from '../deploy/wranglerConfig.ts';
import {
  type AccessApp,
  type CaaRecord,
  checkAccessApplications,
  checkAccessGate,
  checkCaa,
  checkDnssec,
  checkHealth,
  checkIssuer,
  checkSecurityHeaders,
  checkShell,
  checkSubdomainSetting,
  checkWorkersDevProbe,
  type Observed,
  type SmokeFinding,
} from './checks.ts';

const TIMEOUT_MS = 15_000;

async function get(url: string): Promise<Observed> {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { url, status: res.status, headers: res.headers, body: await res.text() };
}

async function probe(url: string): Promise<{ status: number; location: string | null } | 'unreachable'> {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.body?.cancel();
    return { status: res.status, location: res.headers.get('location') };
  } catch {
    return 'unreachable';
  }
}

/** HTTP checks shared by production and local mode. */
async function httpChecks(base: string, env: string): Promise<SmokeFinding[]> {
  const findings: SmokeFinding[] = [];
  const shell = await get(`${base}/`);
  findings.push(...checkShell(shell));
  const asset = /<script type="module"[^>]* src="(\/assets\/[^"]+\.js)"/.exec(shell.body)?.[1];
  if (asset === undefined) findings.push({ check: 'shell', message: `${base}/: no /assets/*.js entry script found` });
  else findings.push(...checkSecurityHeaders(await get(`${base}${asset}`)));
  const missing = await get(`${base}/smoke-check-${Date.now().toString(36)}-not-found`);
  if (missing.status !== 404) findings.push({ check: 'not-found', message: `${missing.url}: status ${missing.status}, expected 404` });
  findings.push(...checkSecurityHeaders(missing));
  findings.push(...checkHealth(await get(`${base}/api/health`), env));
  return findings;
}

/**
 * Fails closed, naming each missing variable, when the Cloudflare credentials
 * are absent. In CI a step's env: is not inherited by the next step, so each
 * smoke-test step must pass both (ci-policy `smoke-credentials`).
 */
function missingCredentials(check: string, purpose: string): SmokeFinding[] {
  return ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']
    .filter((key) => (process.env[key] ?? '') === '')
    .map((key) => ({ check, message: `${key} is not set: it is needed to ${purpose}; pass it in the env: of this workflow step (nothing was checked, so this fails)` }));
}

async function subdomainSetting(script: string): Promise<SmokeFinding[]> {
  const token = process.env['CLOUDFLARE_API_TOKEN'] ?? '';
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const missing = missingCredentials('preview', 'read the workers.dev and preview settings');
  if (missing.length > 0) return missing;
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(script)}/subdomain`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => null)) as { success?: unknown; result?: unknown } | null;
  if (!res.ok || body?.success !== true) return [{ check: 'preview', message: `Cloudflare API ${res.status}: could not read the subdomain setting of '${script}'` }];
  return checkSubdomainSetting(body.result);
}

async function cloudflare(path: string): Promise<{ ok: boolean; status: number; body: { success?: unknown; result?: unknown; result_info?: { total_pages?: unknown } } | null }> {
  const token = process.env['CLOUDFLARE_API_TOKEN'] ?? '';
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => null)) as { success?: unknown; result?: unknown; result_info?: { total_pages?: unknown } } | null;
  return { ok: res.ok && body?.success === true, status: res.status, body };
}

/** The positive Access check: the Cloudflare API must show an application covering `host`, with no Bypass or Everyone policy. */
async function accessApi(host: string): Promise<SmokeFinding[]> {
  const token = process.env['CLOUDFLARE_API_TOKEN'] ?? '';
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const missing = missingCredentials('access', 'confirm the Access application through the Cloudflare API');
  if (missing.length > 0 || token === '' || account === '') return missing;
  const base = `/accounts/${encodeURIComponent(account)}/access/apps`;
  const apps: unknown[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const r = await cloudflare(`${base}?per_page=100&page=${page}`);
    if (!r.ok || !Array.isArray(r.body?.result)) return [{ check: 'access', message: `Cloudflare API ${r.status}: could not list Access applications` }];
    apps.push(...(r.body.result as unknown[]));
    const pages = r.body.result_info?.total_pages;
    if (typeof pages !== 'number' || page >= pages) break;
  }
  const policies = new Map<unknown, unknown>();
  for (const app of apps as AccessApp[]) {
    if (Array.isArray(app?.policies) || typeof app?.id !== 'string') continue;
    const r = await cloudflare(`${base}/${encodeURIComponent(app.id)}/policies?per_page=100`);
    policies.set(app.id, r.ok ? r.body?.result : undefined);
  }
  return checkAccessApplications(host, apps, (app) => (Array.isArray(app.policies) ? app.policies : policies.get(app.id)));
}

async function workersDevProbe(script: string): Promise<SmokeFinding[]> {
  const sub = process.env['RUN_WORKERS_DEV_SUBDOMAIN'] ?? '';
  if (!/^[a-z0-9-]+$/.test(sub)) return [{ check: 'preview', message: 'RUN_WORKERS_DEV_SUBDOMAIN is not set (repository variable; docs/ops/account.md)' }];
  const url = `https://${script}.${sub}.workers.dev/`;
  return checkWorkersDevProbe(url, await probe(url));
}

async function dnssec(host: string): Promise<SmokeFinding[]> {
  const resolvers = [
    `https://cloudflare-dns.com/dns-query?name=${host}&type=A&do=1`,
    `https://dns.google/resolve?name=${host}&type=A&do=1`,
  ];
  const findings: SmokeFinding[] = [];
  for (const url of resolvers) {
    const res = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    findings.push(...checkDnssec(new URL(url).hostname, res.ok ? await res.json().catch(() => null) : null));
  }
  return findings;
}

/** RFC 8659 tree climbing: the CAA set of the closest name that has one. */
async function caa(host: string): Promise<SmokeFinding[]> {
  const resolver = new Resolver({ timeout: TIMEOUT_MS });
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i += 1) {
    const name = labels.slice(i).join('.');
    try {
      const records = (await resolver.resolveCaa(name)) as CaaRecord[];
      if (records.length > 0) return checkCaa(name, records);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENODATA' && code !== 'ENOTFOUND') return [{ check: 'caa', message: `${name}: CAA lookup failed (${code ?? 'error'})` }];
    }
  }
  return checkCaa(host, []);
}

function issuer(host: string): Promise<SmokeFinding[]> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, timeout: TIMEOUT_MS }, () => {
      const org = socket.getPeerCertificate().issuer?.O;
      socket.end();
      resolve(checkIssuer(host, Array.isArray(org) ? org[0] : org));
    });
    socket.on('error', (error) => {
      resolve([{ check: 'certificate', message: `${host}: TLS connection failed (${error.message})` }]);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve([{ check: 'certificate', message: `${host}: TLS connection timed out` }]);
    });
  });
}

/** Runs one group of checks; an exception (DNS failure, timeout, refused connection) is a finding, never a pass. */
async function guard(check: string, fn: () => Promise<SmokeFinding[]>): Promise<SmokeFinding[]> {
  try {
    return await fn();
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return [{ check, message: `could not complete: ${error instanceof Error ? error.message : String(error)}${cause === undefined ? '' : ` (${cause})`}` }];
  }
}

async function run(argv: readonly string[]): Promise<SmokeFinding[]> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      env: { type: 'string' },
      'pre-deploy': { type: 'boolean' },
      'base-url': { type: 'string' },
      'expect-env': { type: 'string' },
    },
  });
  const base = values['base-url'];
  if (base !== undefined) {
    if (values.env !== undefined || values['pre-deploy'] === true) throw new Error('--base-url is local mode: do not combine it with --env or --pre-deploy');
    return guard('http', () => httpChecks(base.replace(/\/$/, ''), values['expect-env'] ?? 'production'));
  }
  const env = values.env;
  if (env === undefined || !isDeployEnvironment(env)) throw new Error('--env production|staging is required');
  const { host, script } = ENVIRONMENTS[env];
  if (values['pre-deploy'] === true) {
    if (env !== 'staging') throw new Error('--pre-deploy applies to staging only');
    // Positive first: the API must show the Access application. Only then may a host that does not
    // resolve yet (before the first deploy creates the custom domain) pass the probe.
    const api = await guard('access', () => accessApi(host));
    return [...api, ...checkAccessGate(`https://${host}/`, await probe(`https://${host}/`), api.length === 0)];
  }
  const findings: SmokeFinding[] = [];
  if (env === 'production') findings.push(...(await guard('http', () => httpChecks(`https://${host}`, env))));
  else {
    findings.push(...(await guard('access', () => accessApi(host))));
    for (const path of ['/', '/api/health']) findings.push(...checkAccessGate(`https://${host}${path}`, await probe(`https://${host}${path}`), false));
  }
  findings.push(...(await guard('preview', () => subdomainSetting(script))));
  findings.push(...(await guard('preview', () => workersDevProbe(script))));
  findings.push(...(await guard('dnssec', () => dnssec(host))));
  findings.push(...(await guard('caa', () => caa(host))));
  findings.push(...(await guard('certificate', () => issuer(host))));
  return findings;
}

try {
  const findings = await run(process.argv.slice(2));
  if (findings.length > 0) {
    process.stderr.write(`smoke: FAILED with ${findings.length} finding(s)\n`);
    for (const f of findings) process.stderr.write(`  ${f.check.padEnd(12)} ${f.message}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('smoke: all checks passed\n');
  }
} catch (error) {
  process.stderr.write(`smoke: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
