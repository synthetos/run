/**
 * Source capability check CLI: the second step of `pnpm deps`, after
 * dependency-cruiser (P0 review fix pass, P0-13, P0-14). See scan.ts.
 *
 *   node tools/gates/src/source/cli.ts [repository root]
 *
 * Scans every runtime source file: `src/` of each package, app and Worker.
 * The dev-only test kit gets the dynamic-import rule only (it installs its
 * fake serial seam on the global object; no production build can contain
 * it). WEB_SERIAL_TRANSPORT_MODULE (P1-00) and WEB_SERIAL_CHOOSER_MODULE
 * (OD-3), and only they, may read `navigator.serial`. Exit status: 0 clean, 1 findings, 2 the check could not run.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanSource, type SourceFinding } from './scan.ts';
import { WEB_SERIAL_MODULES, WEB_SERIAL_PROPERTY } from '../shared/webSerialNames.ts';

const WORKSPACE_GROUPS = ['packages', 'apps', 'workers'];
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
/** Generated or installed directories never hold source. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-fake-serial', 'dist-bench', 'coverage', '.wrangler']);
const TESTKIT = 'packages/testkit';

/** Every runtime source file, relative to `root`, sorted. */
function runtimeSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(child);
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(child);
      }
    }
  };
  for (const group of WORKSPACE_GROUPS) {
    if (!existsSync(join(root, group))) continue;
    for (const pkg of readdirSync(join(root, group), { withFileTypes: true })) {
      const src = `${group}/${pkg.name}/src`;
      if (pkg.isDirectory() && existsSync(join(root, src))) walk(src);
    }
  }
  return out.sort();
}

function main(argv: readonly string[]): number {
  if (argv.length > 1) {
    process.stderr.write('usage: source/cli.ts [repository root]\n');
    return 2;
  }
  const root = resolve(argv[0] ?? process.cwd());
  try {
    const files = runtimeSourceFiles(root);
    if (files.length === 0) throw new Error(`no runtime source found under ${root}`);
    const findings: SourceFinding[] = [];
    for (const file of files) {
      const capabilities = !file.startsWith(`${TESTKIT}/`);
      const navigatorProperties = WEB_SERIAL_MODULES.includes(file) ? [WEB_SERIAL_PROPERTY] : [];
      findings.push(...scanSource(file, readFileSync(join(root, file), 'utf8'), { capabilities, navigatorProperties }));
    }
    if (findings.length > 0) {
      process.stderr.write(`source check: ${findings.length} finding(s)\n`);
      for (const f of findings) process.stderr.write(`  ${f.rule.padEnd(18)} ${f.file}:${f.line}: ${f.message}\n`);
      return 1;
    }
    process.stdout.write(`source check: ${files.length} runtime source files clean (capability-lookup, dynamic-import)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`source check: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
