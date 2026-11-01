/**
 * A deployment whose post-deploy smoke test failed is undone (P0 review;
 * SAFETY H45, D31): staging is deleted, production rolled back. The CLI is
 * run against a fake wrangler binary that records its arguments.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function cli(args: string[]): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'tools/gates/src/deploy/rollback-cli.ts'), ...args], { encoding: 'utf8' });
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

  it('fails loudly when wrangler fails: the deployment is still live', () => {
    const w = fakeWrangler(1);
    const r = cli(['production', w.bin]);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/STILL LIVE/);
  });

  it('refuses an unknown environment or a missing binary argument', () => {
    expect(cli(['preview', '/bin/true']).status).toBe(2);
    expect(cli(['staging']).status).toBe(2);
  });
});
