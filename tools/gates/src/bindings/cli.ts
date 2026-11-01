/**
 * Accounts-binding check CLI (DECISIONS D39). Run by `pnpm ci-policy`:
 *
 *   node tools/gates/src/bindings/cli.ts [repo-root]
 *
 * Finds every wrangler configuration in the tree (outside dependencies and
 * build output) and refuses any, other than run's, that binds the accounts
 * Worker (check.ts). Exit status: 0 clean, 1 findings, 2 could not run (no
 * configuration found at all never passes: run's must be there).
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkWranglerFile, SKIPPED_DIRS, WRANGLER_CONFIG_RE } from './check.ts';

/** Every wrangler configuration under `dir`. Symlinked directories are followed (once each), so none can hide a configuration. */
function find(root: string, dir: string, out: string[], seen: Set<string>): void {
  const real = realpathSync(dir);
  if (seen.has(real)) return;
  seen.add(real);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(path, { throwIfNoEntry: false })?.isDirectory() === true);
    if (isDir) {
      if (!SKIPPED_DIRS.includes(entry.name)) find(root, path, out, seen);
    } else if (WRANGLER_CONFIG_RE.test(entry.name)) {
      out.push(relative(root, path).split(sep).join('/'));
    }
  }
}

function main(argv: readonly string[]): number {
  const root = argv[0] ?? '.';
  try {
    const files: string[] = [];
    find(root, root, files, new Set());
    files.sort();
    if (!files.includes('workers/run/wrangler.jsonc')) throw new Error('workers/run/wrangler.jsonc not found');
    const findings = files.flatMap((f) => checkWranglerFile(f, readFileSync(join(root, f), 'utf8')));
    if (findings.length > 0) {
      process.stderr.write(`accounts binding: ${findings.length} finding(s)\n`);
      for (const f of findings) process.stderr.write(`  ${f.file}: ${f.message}\n`);
      return 1;
    }
    process.stdout.write(`accounts binding: ${files.length} wrangler configuration(s); only run may bind accounts (${files.join(', ')})\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`accounts binding: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
