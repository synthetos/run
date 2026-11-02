/**
 * Reads and checks workers/run/wrangler.jsonc (ROADMAP P0-04, RUN_PLAN §5.2,
 * §6.3, SAFETY H45, H46). Used by the deploy preflight (preflight.ts) and by
 * the config test, so the deploy refuses exactly what CI refuses.
 *
 * Dependency-free (node: only).
 */

/** Removes `//` and `/* *\/` comments outside strings, then trailing commas. Throws on an unterminated comment or string. */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    const next = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) throw new Error('unterminated string');
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated block comment');
      i = end + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  // Trailing commas: a comma followed only by whitespace and a closing bracket.
  // Strings were copied verbatim above, so rebuild with the same scanner.
  let result = '';
  let k = 0;
  while (k < out.length) {
    const c = out[k] as string;
    if (c === '"') {
      let j = k + 1;
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
      result += out.slice(k, j + 1);
      k = j + 1;
    } else if (c === ',' && /^\s*[}\]]/.test(out.slice(k + 1))) {
      k += 1;
    } else {
      result += c;
      k += 1;
    }
  }
  return result;
}

export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonc(text)) as unknown;
}

/**
 * The placeholder kept in the repository until the owner fills in the account
 * id (docs/ops/account.md §2 step 9). Under D39 (which supersedes D34) that is
 * the CURRENT Cloudflare account, locked down (docs/ops/account.md), not a
 * dedicated one. Deploys refuse it.
 */
export const ACCOUNT_ID_PLACEHOLDER = 'RUN_ACCOUNT_ID_PLACEHOLDER';
const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/;

/** Hostnames and Worker names per environment. The smoke test uses the same table. */
export const ENVIRONMENTS = {
  production: { host: 'run.synthetos.com', script: 'run' },
  staging: { host: 'staging.run.synthetos.com', script: 'run-staging' },
} as const;
export type DeployEnvironment = keyof typeof ENVIRONMENTS;

export function isDeployEnvironment(value: string): value is DeployEnvironment {
  return value === 'production' || value === 'staging';
}

export const EXPECTED_ASSETS = {
  directory: '../../apps/web/dist',
  binding: 'ASSETS',
  html_handling: 'auto-trailing-slash',
  not_found_handling: '404-page',
  run_worker_first: ['/api/*', '/auth/*'],
} as const;

/**
 * env.staging's assets settings (P1-00): the top-level ones with the Worker
 * first for every path, so that it can grant `serial=(self)` to staging
 * documents (workers/run/src/headers.ts grantsSerial). Production keeps
 * EXPECTED_ASSETS: the asset layer serves the shell with the `_headers`
 * production set, serial=().
 */
export const EXPECTED_STAGING_ASSETS = { ...EXPECTED_ASSETS, run_worker_first: true } as const;

/** Keys that would add a second origin, a gradual rollout or code from elsewhere. Never allowed. */
const FORBIDDEN_KEYS = ['unsafe', 'routes_preview', 'route', 'tail_consumers', 'dispatch_namespaces', 'legacy_env', 'site'];

/**
 * The only keys the top level may hold (P0-04 review). A POSITIVE list: any
 * other wrangler key, including ones wrangler adds later, is refused. In
 * particular `build`: wrangler runs `build.command` even under `--no-bundle`,
 * in the deploy job that holds CLOUDFLARE_API_TOKEN, where it could replace
 * the attested Worker or read the token (confirmed with the pinned 4.149.0).
 */
export const TOP_LEVEL_KEYS: readonly string[] = [
  '$schema',
  'name',
  'main',
  'compatibility_date',
  'find_additional_modules',
  'rules',
  'account_id',
  'workers_dev',
  'preview_urls',
  'assets',
  'routes',
  'vars',
  'env',
];
/** The only keys env.staging may hold (each one required); everything else is inherited from the top level. */
export const STAGING_KEYS: readonly string[] = ['workers_dev', 'preview_urls', 'routes', 'vars', 'assets'];

/** Pinned values of the module settings the attested --no-bundle deploy depends on. */
export const EXPECTED_MAIN = 'src/index.ts';
export const EXPECTED_RULES = [{ type: 'ESModule', globs: ['**/*.mjs'] }] as const;
const COMPATIBILITY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Where the deploy preflight writes the deployment configuration (relative
 * to the repository root). It sits next to wrangler.jsonc so that relative
 * paths resolve the same way. The deploy and undo steps give wrangler only
 * this file. It is never committed: the preflight refuses to overwrite it.
 */
export const DEPLOY_CONFIG_PATH = 'workers/run/wrangler.deploy.json';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface ConfigFinding {
  readonly where: string;
  readonly message: string;
}

function checkScope(scope: Json, where: string, env: DeployEnvironment, findings: ConfigFinding[]): void {
  const add = (message: string): void => {
    findings.push({ where, message });
  };
  // H45: every environment states both explicitly. wrangler's defaults have
  // changed before, so an omitted key is a finding, not "false".
  if ('build' in scope) {
    findings.push({ where: where === '.' ? 'build' : `${where}.build`, message: 'a custom build is never allowed: wrangler runs build.command even under --no-bundle, with the deploy token (P0-04)' });
  }
  const allowed = env === 'production' ? TOP_LEVEL_KEYS : STAGING_KEYS;
  for (const key of Object.keys(scope)) {
    if (key === 'build' || allowed.includes(key)) continue;
    findings.push({ where: where === '.' ? key : `${where}.${key}`, message: `'${key}' is not in the reviewed allowlist of ${where === '.' ? 'top-level' : where} keys` });
  }
  if (scope['workers_dev'] !== false) add('workers_dev must be explicitly false (SAFETY H45)');
  if (scope['preview_urls'] !== false) add('preview_urls must be explicitly false (SAFETY H45)');
  for (const key of FORBIDDEN_KEYS) if (key in scope) add(`'${key}' is not allowed`);
  const routes = scope['routes'];
  const expected = [{ pattern: ENVIRONMENTS[env].host, custom_domain: true }];
  if (!same(routes, expected)) add(`routes must be exactly ${JSON.stringify(expected)}`);
  const vars = scope['vars'];
  if (!isObject(vars) || vars['RUN_ENV'] !== env) add(`vars.RUN_ENV must be '${env}'`);
  if (isObject(vars) && Object.keys(vars).some((k) => k !== 'RUN_ENV')) {
    findings.push({ where: where === '.' ? 'vars' : `${where}.vars`, message: 'vars may hold RUN_ENV only' });
  }
}

/** Checks the whole configuration. `requireRealAccount` is set by the deploy preflight. */
export function checkWorkerConfig(config: unknown, options: { requireRealAccount: boolean }): ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  if (!isObject(config)) return [{ where: '.', message: 'not a JSON object' }];
  const add = (where: string, message: string): void => {
    findings.push({ where, message });
  };
  if (config['name'] !== ENVIRONMENTS.production.script) add('name', `must be '${ENVIRONMENTS.production.script}'`);
  const account = config['account_id'];
  if (typeof account !== 'string') add('account_id', 'must be set (the current Cloudflare account, locked down, D39)');
  else if (account === ACCOUNT_ID_PLACEHOLDER) {
    if (options.requireRealAccount) add('account_id', 'is still the placeholder: set the current account id (D39, docs/ops/account.md §2 step 9)');
  } else if (!ACCOUNT_ID_RE.test(account)) add('account_id', 'must be a 32-character lower-case hex Cloudflare account id');
  if (!same(config['assets'], EXPECTED_ASSETS)) add('assets', `must be exactly ${JSON.stringify(EXPECTED_ASSETS)}`);
  if (config['main'] !== EXPECTED_MAIN) add('main', `must be '${EXPECTED_MAIN}'`);
  const date = config['compatibility_date'];
  if (typeof date !== 'string' || !COMPATIBILITY_DATE_RE.test(date)) add('compatibility_date', 'must be a YYYY-MM-DD date');
  if (config['find_additional_modules'] !== true) add('find_additional_modules', 'must be true (the artifact Worker is several modules)');
  if (!same(config['rules'], EXPECTED_RULES)) add('rules', `must be exactly ${JSON.stringify(EXPECTED_RULES)}`);
  if ('$schema' in config && typeof config['$schema'] !== 'string') add('$schema', 'must be a string');
  checkScope(config, '.', 'production', findings);
  const envs = config['env'];
  if (!isObject(envs)) {
    add('env', 'must define the staging environment');
  } else {
    for (const name of Object.keys(envs)) {
      if (name !== 'staging') add(`env.${name}`, 'unknown environment: only staging is allowed');
    }
    const staging = envs['staging'];
    if (!isObject(staging)) add('env.staging', 'missing');
    else {
      checkScope(staging, 'env.staging', 'staging', findings);
      for (const key of ['account_id', 'name', 'main']) {
        if (key in staging) add(`env.staging.${key}`, 'must be inherited from the top level, never overridden');
      }
      if (!same(staging['assets'], EXPECTED_STAGING_ASSETS)) add('env.staging.assets', `must be exactly ${JSON.stringify(EXPECTED_STAGING_ASSETS)}`);
    }
  }
  return findings;
}

/**
 * The configuration the deploy job gives wrangler (P0-04 review). Rebuilt
 * key by key from the allowlisted keys of a configuration that passes
 * checkWorkerConfig; anything else in the reviewed file (a build command, a
 * key wrangler adds later) cannot reach it. Throws when the configuration has
 * findings, so a refused file never yields a deployment configuration.
 */
export function deployConfig(config: unknown, options: { requireRealAccount: boolean }): Record<string, unknown> {
  const findings = checkWorkerConfig(config, options);
  if (findings.length > 0 || !isObject(config)) {
    throw new Error(`refused: ${findings.map((f) => `${f.where}: ${f.message}`).join('; ')}`);
  }
  const staging = (config['env'] as Json)['staging'] as Json;
  const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
  const out: Record<string, unknown> = {};
  for (const key of TOP_LEVEL_KEYS) {
    if (key === '$schema' || key === 'env') continue;
    out[key] = copy(config[key]);
  }
  const env: Record<string, unknown> = {};
  for (const key of STAGING_KEYS) env[key] = copy(staging[key]);
  out['env'] = { staging: env };
  // The written file must pass the same check (it is what wrangler reads).
  const again = checkWorkerConfig(out, options);
  if (again.length > 0) throw new Error(`internal: the deployment configuration fails its own check: ${JSON.stringify(again)}`);
  return out;
}
