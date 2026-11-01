/**
 * Bundle scan CLI (ROADMAP P0-03). Run with `pnpm scan` after a build, or:
 *
 *   node tools/gates/src/bundle/cli.ts apps/web/dist
 *
 * Exit status: 0 clean, 1 findings, 2 the scan could not run.
 */
import { existsSync } from 'node:fs';
import { readTree } from '../shared/files.ts';
import { scanBundle } from './scan.ts';

function main(argv: readonly string[]): number {
  const dir = argv[0];
  if (dir === undefined || argv.length !== 1) {
    process.stderr.write('usage: bundle/cli.ts <dist directory>\n');
    return 2;
  }
  try {
    if (!existsSync(dir)) throw new Error(`${dir} does not exist (build first)`);
    const files = readTree(dir);
    const findings = scanBundle(files);
    if (findings.length > 0) {
      process.stderr.write(`bundle scan: ${findings.length} finding(s) in ${dir}\n`);
      for (const f of findings) process.stderr.write(`  ${f.rule.padEnd(22)} ${f.file}: ${f.match}\n`);
      return 1;
    }
    process.stdout.write(`bundle scan: ${files.length} files clean in ${dir}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`bundle scan: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
