/**
 * A deployment whose post-deploy smoke test failed is undone (P0 review;
 * SAFETY H45, D31): staging is deleted, production rolled back. The CLI is
 * run against a fake wrangler binary that records its arguments.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WRANGLER_CONFIG, rollbackPlan } from '../src/deploy/rollback.ts';
import { REPO_ROOT } from './scratch.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeWrangler(exitCode: number): { bin: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'run-rollback-'));
  dirs.push(dir);
  const log = join(dir, 'calls.log');
  const bin = join(dir, 'wrangler');
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> '${log}'\nexit ${exitCode}\n`);
  chmodSync(bin, 0o755);
  return { bin, log };
}

function cli(args: string[], presenceStatus?: number): { status: number | null; output: string } {
  const preloads: string[] = [];
  if (presenceStatus !== undefined) {
    const file = join(dirname(args[1]!), 'fetch.mjs');
    writeFileSync(file, `globalThis.fetch = async () => new Response(JSON.stringify({success:true}), {status:${presenceStatus}});`);
    preloads.push('--import', file);
  }
  const r = spawnSync(process.execPath, [...preloads, join(REPO_ROOT, 'tools/gates/src/deploy/rollback-cli.ts'), ...args], { encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: presenceStatus === undefined ? '' : 'a'.repeat(32), CLOUDFLARE_API_TOKEN: presenceStatus === undefined ? '' : 'test-token' } });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe('rollbackPlan', () => {
  it('deletes staging (a removed Access application is not fixed by older code) and rolls production back', () => {
    expect(rollbackPlan('staging')).toEqual([['delete', '--config', WRANGLER_CONFIG, '--env', 'staging']]);
    expect(rollbackPlan('production')).toEqual([['rollback', '--config', WRANGLER_CONFIG, '--yes', '--message', 'post-deploy smoke test failed']]);
  });
});

describe('rollback CLI', () => {
  it('runs the plan with the given wrangler and reports success', () => {
    const w = fakeWrangler(0);
    const r = cli(['staging', w.bin]);
    expect(r.status, r.output).toBe(0);
    expect(readFileSync(w.log, 'utf8')).toBe(`delete --config ${WRANGLER_CONFIG} --env staging\n`);
  });

  it('reports unknown rather than claiming live when existence cannot be checked', () => {
    const w = fakeWrangler(1);
    const r = cli(['production', w.bin]);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/state UNKNOWN/);
    expect(r.output).not.toMatch(/STILL LIVE/);
  });

  it('checks existence after Wrangler errors and reports deleted versus still live', () => {
    const deleted = cli(['staging', fakeWrangler(1).bin], 404);
    expect(deleted.status).toBe(1);
    expect(deleted.output).toContain('staging Worker deleted; cleanup step failed');
    expect(deleted.output).not.toContain('STILL LIVE');
    const live = cli(['production', fakeWrangler(1).bin], 200);
    expect(live.status).toBe(1);
    expect(live.output).toContain('production Worker STILL LIVE');
    expect(live.output).toContain('deployed version not verified');
  });

  it('refuses an unknown environment or a missing binary argument', () => {
    expect(cli(['preview', '/bin/true']).status).toBe(2);
    expect(cli(['staging']).status).toBe(2);
  });
});

import { workerPresence, rollbackFailure } from '../src/deploy/rollbackStatus.ts';
describe('failed rollback checks actual Worker existence without new permissions', () => {
  it.each(['staging', 'production'] as const)('%s distinguishes present, gone and unknown', async environment => {
    for (const [status, body, expected] of [[200, { success: true }, 'present'], [404, {}, 'absent'], [403, {}, 'unknown'], [500, {}, 'unknown'], [200, { success: false }, 'unknown']] as const) {
      const result = await workerPresence(environment, 'a'.repeat(32), 'existing-token', async (url, options) => {
        expect(String(url)).toContain(`/workers/services/${environment === 'staging' ? 'run-staging' : 'run'}`);
        expect(options?.headers).toEqual({ authorization: 'Bearer existing-token' });
        expect(options?.redirect).toBe('error');
        return new Response(JSON.stringify(body), { status });
      });
      expect(result).toBe(expected);
      expect(rollbackFailure(environment, result).includes('STILL LIVE')).toBe(result === 'present');
    }
    expect(rollbackFailure(environment, 'absent')).toContain('cleanup step failed');
    expect(await workerPresence(environment, 'a'.repeat(32), 'token', async () => { throw Error('network'); })).toBe('unknown');
    expect(await workerPresence(environment, undefined, 'token')).toBe('unknown');
    expect(await workerPresence(environment, 'bad', 'token')).toBe('unknown');
    expect(await workerPresence(environment, 'a'.repeat(32), undefined)).toBe('unknown');
  });
});
