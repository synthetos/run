/**
 * What the Playwright suite serves (ROADMAP P0-04, P0-06).
 *
 * Two modes, chosen ONLY by environment variables, never guessed:
 *
 * - **source** (neither variable set; `pnpm e2e` locally): `wrangler dev`
 *   bundles workers/run/src and serves the freshly built apps/web/dist.
 * - **artifact** (both set; the CI `e2e` job and `pnpm e2e:artifact`):
 *   `wrangler dev <RUN_E2E_WORKER>/index.mjs --no-bundle --assets
 *   <RUN_E2E_SITE>` serves the attested artifact's own bytes: the Worker
 *   modules exactly as built, and the site tree exactly as built, through the
 *   same wrangler.jsonc that the deploy jobs use.
 *
 * Setting only one of the two variables is refused: a half-artifact run
 * would test something that is never deployed.
 */
import { lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export const SITE_ENV = 'RUN_E2E_SITE';
export const WORKER_ENV = 'RUN_E2E_WORKER';

/** The repository root, from this file's location (tools/e2e/src). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

export type ServedMode =
  | { readonly kind: 'source'; readonly siteDir: string }
  | { readonly kind: 'artifact'; readonly siteDir: string; readonly workerDir: string };

function absolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/** Resolves the mode from the environment. Relative paths resolve against `cwd`. */
export function servedMode(env: Readonly<Record<string, string | undefined>>, cwd: string): ServedMode {
  const site = env[SITE_ENV];
  const worker = env[WORKER_ENV];
  const siteSet = site !== undefined && site !== '';
  const workerSet = worker !== undefined && worker !== '';
  if (siteSet !== workerSet) {
    throw new Error(`e2e: set both ${SITE_ENV} and ${WORKER_ENV} (artifact mode) or neither (source mode); got only ${siteSet ? SITE_ENV : WORKER_ENV}`);
  }
  if (siteSet && workerSet) return { kind: 'artifact', siteDir: absolute(site, cwd), workerDir: absolute(worker, cwd) };
  return { kind: 'source', siteDir: join(REPO_ROOT, 'apps/web/dist') };
}

/** The files that must exist in a served site tree before the suite starts. */
export const REQUIRED_SITE_FILES: readonly string[] = [
  'index.html',
  'safety/index.html',
  'privacy/index.html',
  '404.html',
  '_headers',
  'manifest.webmanifest',
];

/** The files that must exist in an artifact Worker directory. */
export const REQUIRED_WORKER_FILES: readonly string[] = ['index.mjs', 'headers.mjs', 'routes.mjs'];

/**
 * The argv (after `node`) that starts `wrangler dev` for the mode. The
 * artifact command is the deploy command with `dev` for `deploy`
 * (.github/workflows/ci.yml, docs/ops/worker.md).
 */
export function wranglerArgs(mode: ServedMode, port: number): string[] {
  const wrangler = join(REPO_ROOT, 'workers/run/node_modules/wrangler/bin/wrangler.js');
  const config = join(REPO_ROOT, 'workers/run/wrangler.jsonc');
  const common = ['--config', config, '--port', String(port), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'];
  if (mode.kind === 'source') return [wrangler, 'dev', ...common];
  return [wrangler, 'dev', join(mode.workerDir, 'index.mjs'), '--no-bundle', '--assets', mode.siteDir, ...common];
}

/** Quotes one argument for the shell line Playwright's webServer runs. */
export function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * The URL path at which the asset layer serves a site file
 * (`html_handling: auto-trailing-slash`), or `undefined` for the two files it
 * never serves under their own name: `_headers` (configuration, consumed by
 * the asset layer) and `404.html` (the body of every not-found response).
 */
export function servedPath(file: string): string | undefined {
  if (file === '_headers' || file === '404.html') return undefined;
  if (file === 'index.html') return '/';
  if (file.endsWith('/index.html')) return `/${file.slice(0, -'index.html'.length)}`;
  return `/${file}`;
}

/** Every regular file under `root`, relative with forward slashes, sorted. Links are refused. */
export function siteFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const rel = prefix === '' ? name : `${prefix}/${name}`;
      const stat = lstatSync(join(dir, name));
      if (stat.isDirectory()) walk(join(dir, name), rel);
      else if (stat.isFile()) out.push(rel);
      else throw new Error(`${rel}: not a regular file or directory`);
    }
  };
  walk(root, '');
  return out.sort();
}
