/**
 * Who may bind the `accounts` Worker (DECISIONS D39, SAFETY H46).
 *
 * D39 keeps run and accounts in the current Cloudflare account, next to the
 * site and forumbot. Service bindings work inside one account, so another
 * Worker in it could declare a binding to accounts' `RunEntrypoint` and call
 * it as if it were run. The platform does not stop that; review and this
 * check do. In this repository, `workers/run/wrangler.jsonc` is the ONLY
 * Worker configuration allowed to bind accounts, and run's own key
 * allowlist (deploy/wranglerConfig.ts `EXPECTED_SERVICES`, A1-06) allows
 * exactly that one binding to accounts' `RunEntrypoint` per environment.
 * Every other wrangler configuration in the tree
 * that binds accounts in any way is refused. The accounts and site
 * repositories carry the matching rule (docs/ops/account.md §1).
 *
 * Fails closed: a wrangler.toml cannot be read by this dependency-free check,
 * so any is refused (use wrangler.json or wrangler.jsonc); a configuration
 * that does not parse is refused.
 *
 * "Binds accounts" means, at the top level or in any `env.<name>`:
 * - `services[].service` is `accounts` or starts with `accounts-`
 *   (accounts-staging);
 * - `services[].entrypoint` is `RunEntrypoint`;
 * - `durable_objects.bindings[].script_name`, `workflows[].script_name` or
 *   `tail_consumers[].service` names accounts as above.
 *
 * Dependency-free (node: only).
 */
import { parseJsonc } from '../deploy/wranglerConfig.ts';

/** The configuration allowed to bind accounts, and the deployment configuration the preflight writes from it. */
export const ACCOUNTS_BINDERS: readonly string[] = ['workers/run/wrangler.jsonc', 'workers/run/wrangler.deploy.json'];

/** A file name wrangler reads as configuration. */
export const WRANGLER_CONFIG_RE = /^wrangler(\.[A-Za-z0-9_-]+)?\.(json|jsonc|toml)$/;

/** Directories never searched (dependencies and build output, which are not reviewed source). */
export const SKIPPED_DIRS: readonly string[] = ['node_modules', '.git', 'dist', 'dist-fake-serial', 'dist-worker', '.wrangler', 'coverage', 'test-results', 'playwright-report', '.stryker-tmp'];

export interface BindingFinding {
  readonly file: string;
  readonly message: string;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const namesAccounts = (v: unknown): boolean => typeof v === 'string' && (v === 'accounts' || v.startsWith('accounts-'));

/** Where in one scope (top level or one env) a configuration binds accounts. */
function accountsBindings(scope: Json, where: string): string[] {
  const out: string[] = [];
  const list = (key: string): unknown[] => (Array.isArray(scope[key]) ? (scope[key] as unknown[]) : []);
  list('services').forEach((s, i) => {
    if (!isObject(s)) return;
    if (namesAccounts(s['service'])) out.push(`${where}services[${i}].service = ${JSON.stringify(s['service'])}`);
    if (s['entrypoint'] === 'RunEntrypoint') out.push(`${where}services[${i}].entrypoint = "RunEntrypoint"`);
  });
  const durable = isObject(scope['durable_objects']) ? scope['durable_objects']['bindings'] : undefined;
  (Array.isArray(durable) ? durable : []).forEach((d: unknown, i) => {
    if (isObject(d) && namesAccounts(d['script_name'])) out.push(`${where}durable_objects.bindings[${i}].script_name = ${JSON.stringify(d['script_name'])}`);
  });
  list('workflows').forEach((w, i) => {
    if (isObject(w) && namesAccounts(w['script_name'])) out.push(`${where}workflows[${i}].script_name = ${JSON.stringify(w['script_name'])}`);
  });
  list('tail_consumers').forEach((t, i) => {
    if (isObject(t) && namesAccounts(t['service'])) out.push(`${where}tail_consumers[${i}].service = ${JSON.stringify(t['service'])}`);
  });
  return out;
}

/** Every place a parsed wrangler configuration binds accounts (top level and each environment). */
export function bindingsToAccounts(config: unknown): string[] {
  if (!isObject(config)) return [];
  const out = accountsBindings(config, '');
  if (isObject(config['env'])) {
    for (const [name, scope] of Object.entries(config['env'])) {
      if (isObject(scope)) out.push(...accountsBindings(scope, `env.${name}.`));
    }
  }
  return out;
}

/** Checks one wrangler configuration file (path relative to the repository root, forward slashes). */
export function checkWranglerFile(file: string, text: string): BindingFinding[] {
  const name = file.split('/').pop() ?? file;
  if (name.endsWith('.toml')) {
    return [{ file, message: 'wrangler.toml is not allowed: the accounts-binding check (D39) reads only wrangler.json or wrangler.jsonc' }];
  }
  let config: unknown;
  try {
    config = parseJsonc(text);
  } catch (error) {
    return [{ file, message: `does not parse, so the accounts-binding check (D39) cannot clear it: ${error instanceof Error ? error.message : String(error)}` }];
  }
  if (ACCOUNTS_BINDERS.includes(file)) return [];
  return bindingsToAccounts(config).map((where) => ({
    file,
    message: `binds the accounts Worker (${where}); only workers/run/wrangler.jsonc may (D39, SAFETY H46)`,
  }));
}
