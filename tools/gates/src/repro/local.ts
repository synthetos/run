/**
 * The `build` CI job, locally (ROADMAP P0-03). Run with `pnpm repro`:
 *
 *   node tools/gates/src/repro/local.ts [git-ref]
 *
 * Clones the committed `git-ref` (default HEAD) twice into fresh temporary
 * directories, installs only the build toolchain in each (build/cli.ts),
 * builds both (the web bundle and the Worker script), fails unless the
 * outputs are byte-identical, and runs the bundle scan, exactly as CI does. Uncommitted changes are not included:
 * the check is about what a clean checkout produces. Needs pnpm on PATH
 * (`corepack enable`) and either network access or a warm pnpm store.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../../..');
const ref = process.argv[2] ?? 'HEAD';
const base = mkdtempSync(join(tmpdir(), 'run-repro-'));
const node = (args: readonly string[], cwd = base): void => {
  execFileSync(process.execPath, args, { cwd, stdio: 'inherit' });
};
let status = 0;
try {
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  process.stdout.write(`repro: building ${sha} twice under ${base}\n`);
  for (const name of ['a', 'b']) {
    const dir = join(base, name);
    execFileSync('git', ['clone', '--quiet', '--no-local', '--no-checkout', repo, dir], { stdio: 'inherit' });
    execFileSync('git', ['-C', dir, 'checkout', '--quiet', '--detach', sha], { stdio: 'inherit' });
    node([join(dir, 'tools/gates/src/build/cli.ts'), 'install', dir]);
    execFileSync('pnpm', ['--dir', dir, '--filter', '@synthetos/web', 'build'], { stdio: 'inherit' });
    node([join(dir, 'tools/gates/src/build/worker-cli.ts'), join(dir, 'workers/run/src'), join(dir, 'dist-worker')]);
  }
  node([join(base, 'a/tools/gates/src/repro/cli.ts'), 'compare', join(base, 'a/apps/web/dist'), join(base, 'b/apps/web/dist')]);
  node([join(base, 'a/tools/gates/src/repro/cli.ts'), 'compare', join(base, 'a/dist-worker'), join(base, 'b/dist-worker')]);
  node([join(base, 'a/tools/gates/src/bundle/cli.ts'), join(base, 'a/apps/web/dist')]);
} catch (error) {
  process.stderr.write(`repro: failed: ${error instanceof Error ? error.message : String(error)}\n`);
  status = 1;
} finally {
  rmSync(base, { recursive: true, force: true });
}
process.exitCode = status;
