/**
 * Installs the production build toolchain from the lockfile subset
 * (ROADMAP P0-03; see toolchain.ts). Used by the `build` CI job on each clean
 * checkout:
 *
 *   node tools/gates/src/build/cli.ts install <checkout>
 *
 * It empties the root importer, runs a frozen, script-free, filtered pnpm
 * install, restores package.json and pnpm-lock.yaml byte for byte, and then
 * fails unless the store holds no test-only dev tool. Exit status: 0 done,
 * 1 a forbidden package was installed, 2 the install could not run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_FILTER,
  forbiddenBuildPackages,
  forbiddenInstalled,
  storePackageNames,
  subsetLockfile,
  subsetRootManifest,
} from './toolchain.ts';

const WORKSPACE_GROUPS = ['packages', 'apps', 'workers', 'tools'];

function workspaceManifests(root: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const group of WORKSPACE_GROUPS) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name, 'package.json');
      if (existsSync(file)) out.set(`${group}/${name}`, JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>);
    }
  }
  return out;
}

function install(root: string): number {
  const manifestPath = join(root, 'package.json');
  const lockPath = join(root, 'pnpm-lock.yaml');
  if (existsSync(join(root, 'node_modules'))) throw new Error(`${root} already has node_modules; use a clean checkout`);
  const manifestText = readFileSync(manifestPath, 'utf8');
  const lockText = readFileSync(lockPath, 'utf8');
  const forbidden = forbiddenBuildPackages(JSON.parse(manifestText) as Record<string, never>, workspaceManifests(root));

  writeFileSync(manifestPath, subsetRootManifest(manifestText));
  writeFileSync(lockPath, subsetLockfile(lockText));
  try {
    execFileSync('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', `--filter=${BUILD_FILTER}`], {
      cwd: root,
      stdio: 'inherit',
    });
  } finally {
    writeFileSync(manifestPath, manifestText);
    writeFileSync(lockPath, lockText);
  }

  const installed = storePackageNames(readdirSync(join(root, 'node_modules', '.pnpm')));
  const bad = forbiddenInstalled(installed, forbidden);
  if (bad.length > 0) {
    process.stderr.write(`build toolchain: test-only packages were installed: ${bad.join(', ')}\n`);
    return 1;
  }
  process.stdout.write(`build toolchain: ${installed.size} packages installed, none of ${forbidden.size} dev-only tools\n`);
  return 0;
}

function main(argv: readonly string[]): number {
  const [command, root] = argv;
  if (command !== 'install' || root === undefined || argv.length !== 2) {
    process.stderr.write('usage: build/cli.ts install <checkout>\n');
    return 2;
  }
  try {
    return install(root);
  } catch (error) {
    process.stderr.write(`build toolchain: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
