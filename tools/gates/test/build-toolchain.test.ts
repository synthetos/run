/**
 * The `build` job's minimal toolchain install (ROADMAP P0-03: "installs only
 * the production build toolchain from a minimal lockfile subset").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILD_ENTRY,
  BUILD_FILTER_FLAG,
  forbiddenBuildPackages,
  forbiddenInstalled,
  productionClosure,
  storePackageNames,
  subsetLockfile,
  subsetRootManifest,
} from '../src/build/toolchain.ts';
import { REPO_ROOT } from './scratch.ts';

const rootManifestText = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');
const lockText = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
const json = (path: string): Record<string, never> => JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as Record<string, never>;

describe('lockfile subset', () => {
  it('empties only the root importer of the real lockfile', () => {
    const subset = subsetLockfile(lockText);
    expect(subset).toContain('\n  .: {}\n');
    expect(subset).not.toMatch(/\n {2}\.:\n/);
    // Every other line is untouched: removing the root importer's block from
    // the original gives exactly the subset.
    const original = lockText.split('\n');
    const kept = subset.split('\n');
    expect(original.filter((l) => !kept.includes(l)).every((l) => l === '  .:' || l.startsWith('    '))).toBe(true);
    expect(subset).toContain('\n  apps/web:\n');
    expect(subset).toContain("\n  vite@8.3.4:\n");
  });

  it('is idempotent and fails closed on an unexpected layout', () => {
    expect(subsetLockfile(subsetLockfile(lockText))).toBe(subsetLockfile(lockText));
    expect(() => subsetLockfile('lockfileVersion: 9.0\n')).toThrow(/importers/);
    expect(() => subsetLockfile('importers:\n\n  apps/web: {}\n')).toThrow(/root importer/);
  });

  it('drops the root devDependencies and keeps everything else', () => {
    const subset = JSON.parse(subsetRootManifest(rootManifestText)) as Record<string, unknown>;
    const original = JSON.parse(rootManifestText) as Record<string, unknown>;
    expect(subset['devDependencies']).toBeUndefined();
    expect(subset['packageManager']).toBe(original['packageManager']);
    expect(subset['scripts']).toEqual(original['scripts']);
  });

  it('refuses a root that declares runtime dependencies', () => {
    expect(() => subsetRootManifest(JSON.stringify({ dependencies: { leftpad: '1.0.0' } }))).toThrow(/devDependencies only/);
  });
});

describe('production closure (P0 review: runtime workspace edges are dependencies)', () => {
  const dirs = ['apps/web', 'packages/machine', 'packages/safety', 'packages/protocol', 'packages/flasher', 'packages/testkit', 'packages/schema', 'tools/e2e'];
  const workspace = new Map(dirs.map((d) => [d, json(`${d}/package.json`)]));

  it('follows dependencies only: web, machine, safety, schema (the read allowlists, P1-02), protocol and flasher, never the test kit', () => {
    expect([...productionClosure(BUILD_ENTRY, workspace)].sort()).toEqual(
      ['apps/web', 'packages/flasher', 'packages/machine', 'packages/protocol', 'packages/safety', 'packages/schema'].sort(),
    );
  });

  it('is installed with --filter-prod, so pnpm selects the same graph', () => {
    expect(BUILD_FILTER_FLAG).toBe('--filter-prod');
  });

  it('ignores non-workspace specs and unknown names', () => {
    const fake = new Map([
      ['a', { name: 'a', dependencies: { b: 'workspace:*', npm: '1.0.0', ghost: 'workspace:*' }, devDependencies: { c: 'workspace:*' } }],
      ['b', { name: 'b', dependencies: { a: 'workspace:*' } }],
      ['c', { name: 'c' }],
    ]) as unknown as Parameters<typeof productionClosure>[1];
    expect([...productionClosure('a', fake)].sort()).toEqual(['a', 'b']);
  });
});

describe('forbidden packages', () => {
  const workspace = new Map<string, Record<string, never>>([
    ['apps/web', json('apps/web/package.json')],
    ['workers/run', json('workers/run/package.json')],
    ['tools/gates', json('tools/gates/package.json')],
  ]);
  const forbidden = forbiddenBuildPackages(json('package.json'), workspace);

  it('covers every test and lint tool and wrangler, but not the build toolchain', () => {
    for (const name of ['vitest', 'eslint', '@playwright/test', 'dependency-cruiser', 'fast-check', 'typescript', 'typescript-eslint', 'wrangler']) {
      expect(forbidden.has(name), name).toBe(true);
    }
    for (const name of ['vite', 'preact', '@preact/signals', '@types/node']) expect(forbidden.has(name), name).toBe(false);
  });

  it('reads package names from pnpm store entries', () => {
    expect([...storePackageNames(['@preact+signals@2.11.3_preact@11.0.1', 'vite@8.3.4_@types+node@22.20.5', 'node_modules', 'lock.yaml'])]).toEqual([
      '@preact/signals',
      'vite',
    ]);
    expect(() => storePackageNames(['garbage'])).toThrow(/unrecognised/);
  });

  it('flags a test tool that slipped into the build store', () => {
    const installed = storePackageNames(['vite@8.3.4', 'vitest@5.0.3_vite@8.3.4', 'preact@11.0.1']);
    expect(forbiddenInstalled(installed, forbidden)).toEqual(['vitest']);
    expect(forbiddenInstalled(storePackageNames(['vite@8.3.4', 'preact@11.0.1']), forbidden)).toEqual([]);
  });
});

describe('deploy toolchain', () => {
  it('pins the same wrangler as the workspace, with the same integrity hash', () => {
    const deploy = JSON.parse(readFileSync(join(REPO_ROOT, 'ci/deploy-toolchain/package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const worker = json('workers/run/package.json') as unknown as { devDependencies: Record<string, string> };
    const version = worker.devDependencies['wrangler'];
    expect(deploy.dependencies).toEqual({ wrangler: version });
    const integrity = (text: string): string | undefined =>
      new RegExp(`\\n {2}wrangler@${String(version).replace(/\./g, '\\.')}:\\n {4}resolution: \\{integrity: (sha512-[A-Za-z0-9+/=]+)\\}`).exec(text)?.[1];
    const deployLock = readFileSync(join(REPO_ROOT, 'ci/deploy-toolchain/pnpm-lock.yaml'), 'utf8');
    expect(integrity(deployLock)).toBeDefined();
    expect(integrity(deployLock)).toBe(integrity(lockText));
  });

  it('is a standalone project with the same supply-chain settings', () => {
    const settings = readFileSync(join(REPO_ROOT, 'ci/deploy-toolchain/pnpm-workspace.yaml'), 'utf8');
    expect(settings).toMatch(/^minimumReleaseAge: 10080$/m);
    expect(settings).toMatch(/^onlyBuiltDependencies: \[\]$/m);
    expect(settings).not.toMatch(/^packages:/m);
    expect(readFileSync(join(REPO_ROOT, 'ci/deploy-toolchain/.npmrc'), 'utf8')).toMatch(/^ignore-scripts=true$/m);
    const pm = (path: string): unknown => (JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as { packageManager?: unknown }).packageManager;
    expect(pm('ci/deploy-toolchain/package.json')).toBe(pm('package.json'));
  });
});

describe('repository supply-chain settings (ROADMAP P0-03)', () => {
  it('keeps minimumReleaseAge at 7 days and packageManager pinned with its hash', () => {
    expect(readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8')).toMatch(/^minimumReleaseAge: 10080$/m);
    expect((JSON.parse(rootManifestText) as { packageManager: string }).packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
  });
});

describe('CI scripts run before anything is installed', () => {
  // The build, e2e, deploy and safety-review jobs run these with plain node,
  // with no dev tooling installed (or none at all). Each must reach only
  // node: built-ins and other repository files that do the same.
  const ENTRY_POINTS = [
    'tools/gates/src/build/cli.ts',
    'tools/gates/src/repro/cli.ts',
    'tools/gates/src/repro/local.ts',
    'tools/gates/src/bundle/cli.ts',
    'tools/gates/src/review/cli.ts',
    'tools/gates/src/review/template-cli.ts',
    'tools/gates/src/codeowners/cli.ts',
    'tools/gates/src/workflow/cli.ts',
    'tools/gates/src/bindings/cli.ts',
  ];

  it('import only node: built-ins and relative modules, transitively', () => {
    const seen = new Set<string>();
    const queue = ENTRY_POINTS.map((p) => join(REPO_ROOT, p));
    const external: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop() ?? '';
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
        const spec = m[1] ?? '';
        if (/^\s*(?:import|export)\s+type\s/.test(m[0])) continue; // erased at run time
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('.')) queue.push(join(file, '..', spec));
        else external.push(`${file.slice(REPO_ROOT.length + 1)} -> ${spec}`);
      }
    }
    expect(external).toEqual([]);
    expect(seen.size).toBeGreaterThan(ENTRY_POINTS.length);
  });
});
