/**
 * P1-00 on the real builds: the localhost bench build (`vite build --mode
 * bench`) differs from the release build only in the build-channel chunk,
 * passes the bundle scan only for the bench target, and is refused by the
 * staging and production scans, so it can never pass for a deployable
 * artifact. Each case works in a scratch copy of the working tree.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type GateResult, SCRATCH_BUILD_SHA, ScratchRepo } from './scratch.ts';
import { spawnSync } from 'node:child_process';

const TIMEOUT = 240_000;
let scratch: ScratchRepo | undefined;

function fresh(): ScratchRepo {
  scratch = ScratchRepo.create();
  return scratch;
}

afterEach(() => {
  scratch?.dispose();
  scratch = undefined;
});

function buildBench(repo: ScratchRepo): GateResult {
  const env: NodeJS.ProcessEnv = { ...process.env, RUN_BUILD_SHA: SCRATCH_BUILD_SHA };
  delete env['NODE_ENV'];
  const r = spawnSync(process.execPath, [join(repo.root, 'apps/web/node_modules/vite/bin/vite.js'), 'build', '--mode', 'bench', '--logLevel', 'warn'], {
    cwd: join(repo.root, 'apps/web'),
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe('the localhost bench build (P1-00)', () => {
  it(
    'differs from release only in the channel chunk; only the bench scan passes it; the release build fails the bench scan',
    () => {
      const repo = fresh();
      const release = repo.buildWeb();
      expect(release.status, release.output).toBe(0);
      const bench = buildBench(repo);
      expect(bench.status, bench.output).toBe(0);
      expect(existsSync(join(repo.root, 'apps/web/dist-bench/index.html'))).toBe(true);

      const diff = repo.gate('tools/gates/src/artifact/bench-cli.ts', [join(repo.root, 'apps/web/dist'), join(repo.root, 'apps/web/dist-bench')]);
      expect(diff.status, diff.output).toBe(0);
      expect(diff.output).toMatch(/^channel +\w+ +\w+ +assets\/build-channel\.js$/m);
      expect(diff.output).toMatch(/^same +\w+ +\w+ +assets\/workspace\.js$/m);
      expect(diff.output).toMatch(/^same +\w+ +\w+ +assets\/machine\.worker\.js$/m);

      const benchScan = repo.scan('bench', 'apps/web/dist-bench');
      expect(benchScan.status, benchScan.output).toBe(0);
      for (const target of ['staging', 'production'] as const) {
        const r = repo.scan(target, 'apps/web/dist-bench');
        expect(r.status, r.output).toBe(1);
        expect(r.output).toMatch(/bench-marker +assets\/build-channel-/);
      }
      const releaseAsBench = repo.scan('bench', 'apps/web/dist');
      expect(releaseAsBench.status, releaseAsBench.output).toBe(1);
      expect(releaseAsBench.output).toContain('bench-marker-missing');
      expect(repo.scan('staging').status).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'a release module importing the bench channel fails dependency-cruiser, and the staging scan of the resulting build',
    () => {
      const repo = fresh();
      repo.append('apps/web/src/entries/page.ts', "\nimport { startBuildChannel } from '../channel/bench.ts';\nstartBuildChannel(document);\n");
      const deps = repo.deps();
      expect(deps.status, deps.output).not.toBe(0);
      expect(deps.output).toContain('bench-channel-only-through-the-build');
      const build = repo.buildWeb();
      expect(build.status, build.output).toBe(0);
      const scan = repo.scan('staging');
      expect(scan.status, scan.output).toBe(1);
      expect(scan.output).toContain('bench-marker');
    },
    TIMEOUT,
  );

  it(
    'machine.worker importing the build channel fails dependency-cruiser (D1: nothing in the machine path consults it)',
    () => {
      const repo = fresh();
      repo.append('apps/web/src/machine-worker/host.ts', "\nimport { startBuildChannel } from '../channel/channel.ts';\nexport const _c = startBuildChannel;\n");
      const deps = repo.deps();
      expect(deps.status, deps.output).not.toBe(0);
      expect(deps.output).toContain('machine-path-never-reaches-build-channel');
    },
    TIMEOUT,
  );

  it(
    'a bench build in which nothing imports the seam fails instead of yielding the release build',
    () => {
      const repo = fresh();
      const entry = repo.read('apps/web/src/entries/workspace.ts');
      expect(entry).toContain("import { startBuildChannel } from '../channel/channel.ts';");
      repo.write(
        'apps/web/src/entries/workspace.ts',
        entry.replace("import { startBuildChannel } from '../channel/channel.ts';\n", '').replace('startBuildChannel(document);\n', ''),
      );
      const bench = buildBench(repo);
      expect(bench.status, bench.output).not.toBe(0);
      expect(bench.output).toContain('the bench build would be the release build');
    },
    TIMEOUT,
  );
});
