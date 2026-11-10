/**
 * D39: run and accounts share the current Cloudflare account with the site
 * and forumbot, and service bindings work inside one account. The CI policy
 * therefore refuses every Worker configuration other than run's that binds
 * the accounts Worker (tools/gates/src/bindings/check.ts).
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNTS_BINDERS, bindingsToAccounts, checkWranglerFile, WRANGLER_CONFIG_RE } from '../src/bindings/check.ts';
import { checkWorkerConfig, parseJsonc } from '../src/deploy/wranglerConfig.ts';
import { REPO_ROOT, ScratchRepo } from './scratch.ts';

const SITE = 'workers/site/wrangler.jsonc';
const binding = (body: string): string => `{\n  // another Worker in the same account\n  "name": "synthetos",\n  ${body}\n}\n`;

let scratch: ScratchRepo | undefined;
afterEach(() => {
  scratch?.dispose();
  scratch = undefined;
});

describe('which configurations bind accounts', () => {
  it.each([
    ['a service binding to accounts', '"services": [{ "binding": "ACCOUNTS", "service": "accounts" }]'],
    ['a service binding to accounts-staging', '"services": [{ "binding": "A", "service": "accounts-staging" }]'],
    ['the RunEntrypoint of any service', '"services": [{ "binding": "A", "service": "renamed", "entrypoint": "RunEntrypoint" }]'],
    ['a Durable Object hosted by accounts', '"durable_objects": { "bindings": [{ "name": "S", "class_name": "Session", "script_name": "accounts" }] }'],
    ['a Workflow hosted by accounts', '"workflows": [{ "binding": "W", "name": "w", "class_name": "W", "script_name": "accounts" }]'],
    ['accounts as a tail consumer', '"tail_consumers": [{ "service": "accounts" }]'],
    ['a binding inside an environment only', '"env": { "staging": { "services": [{ "binding": "A", "service": "accounts-staging" }] } }'],
  ])('refuses %s outside run', (_name, body) => {
    const findings = checkWranglerFile(SITE, binding(body));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/binds the accounts Worker .*only workers\/run\/wrangler\.jsonc may \(D39/);
  });

  it('allows other bindings outside run', () => {
    expect(checkWranglerFile(SITE, binding('"services": [{ "binding": "FORUM", "service": "forumbot" }, { "binding": "X", "service": "accountsx" }]'))).toEqual([]);
  });

  it('allows run (and the deployment configuration written from it) to bind accounts', () => {
    expect(ACCOUNTS_BINDERS).toEqual(['workers/run/wrangler.jsonc', 'workers/run/wrangler.deploy.json']);
    for (const file of ACCOUNTS_BINDERS) expect(checkWranglerFile(file, binding('"services": [{ "binding": "ACCOUNTS", "service": "accounts" }]'))).toEqual([]);
  });

  it('refuses a configuration it cannot read: TOML, or unparsable JSON', () => {
    expect(checkWranglerFile('wrangler.toml', 'name = "x"\n')[0]?.message).toMatch(/wrangler\.toml is not allowed/);
    expect(checkWranglerFile(SITE, '{ "services": [ ')[0]?.message).toMatch(/does not parse/);
  });

  it('recognises every wrangler configuration file name', () => {
    for (const name of ['wrangler.json', 'wrangler.jsonc', 'wrangler.toml', 'wrangler.deploy.json', 'wrangler.staging.jsonc']) expect(WRANGLER_CONFIG_RE.test(name)).toBe(true);
    for (const name of ['wrangler.ts', 'mywrangler.json', 'wrangler.json.bak']) expect(WRANGLER_CONFIG_RE.test(name)).toBe(false);
  });
});

describe("run's own configuration", () => {
  it('A1-06: binds exactly accounts\' RunEntrypoint on staging, and its key allowlist refuses any other binding', () => {
    const text = readFileSync(join(REPO_ROOT, 'workers/run/wrangler.jsonc'), 'utf8');
    const config = parseJsonc(text) as Record<string, unknown>;
    // Staging only until the owner's production go-live (docs/ops/go-live-staging.md §7).
    expect(bindingsToAccounts(config)).toEqual(['env.staging.services[0].service = "accounts-staging"', 'env.staging.services[0].entrypoint = "RunEntrypoint"']);
    const withoutEntrypoint = { ...config, services: [{ binding: 'ACCOUNTS', service: 'accounts' }] };
    expect(checkWorkerConfig(withoutEntrypoint, { requireRealAccount: false }).map((f) => f.where)).toContain('.');
  });
});

describe('pnpm ci-policy, end to end', () => {
  it('passes the repository as committed', { timeout: 60_000 }, () => {
    scratch = ScratchRepo.create();
    const r = scratch.gate('tools/gates/src/bindings/cli.ts', [scratch.root]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('workers/run/wrangler.jsonc');
  });

  it('fails when another Worker configuration in the tree binds accounts, wherever it is', { timeout: 60_000 }, () => {
    scratch = ScratchRepo.create();
    scratch.write('apps/site/worker/wrangler.json', JSON.stringify({ name: 'synthetos', services: [{ binding: 'ACCOUNTS', service: 'accounts', entrypoint: 'RunEntrypoint' }] }));
    const r = scratch.gate('tools/gates/src/bindings/cli.ts', [scratch.root]);
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain('apps/site/worker/wrangler.json: binds the accounts Worker (services[0].service = "accounts")');
    expect(r.output).toContain('services[0].entrypoint = "RunEntrypoint"');
  });

  it('follows a symlinked directory, so a configuration cannot hide behind one', { timeout: 60_000 }, () => {
    scratch = ScratchRepo.create();
    const hidden = join(scratch.base, 'outside', 'hidden');
    mkdirSync(hidden);
    writeFileSync(join(hidden, 'wrangler.jsonc'), JSON.stringify({ name: 'x', services: [{ binding: 'A', service: 'accounts' }] }));
    symlinkSync(hidden, join(scratch.root, 'linked'));
    const r = scratch.gate('tools/gates/src/bindings/cli.ts', [scratch.root]);
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain('linked/wrangler.jsonc: binds the accounts Worker');
  });

  it('fails on a wrangler.toml anywhere in the tree, and cannot run without run’s configuration', { timeout: 60_000 }, () => {
    scratch = ScratchRepo.create();
    scratch.write('tools/forum/wrangler.toml', 'name = "forumbot"\n');
    expect(scratch.gate('tools/gates/src/bindings/cli.ts', [scratch.root]).status).toBe(1);
    scratch.dispose();
    scratch = ScratchRepo.create();
    rmSync(join(scratch.root, 'workers/run/wrangler.jsonc'));
    expect(scratch.gate('tools/gates/src/bindings/cli.ts', [scratch.root]).status).toBe(2);
  });
});
