/**
 * Bundle scan CLI (ROADMAP P0-03, P1-00). Run with `pnpm scan` after a build, or:
 *
 *   node tools/gates/src/bundle/cli.ts --target <production|staging> <dist directory>
 *
 * The target is required (scan.ts explains each): CI scans the built and
 * attested artifact, and the staging deploy, as `staging`, and the production
 * deploy as `production` (ci-policy `bundle-scan-target`).
 *
 * Exit status: 0 clean, 1 findings, 2 the scan could not run.
 */
import { existsSync } from 'node:fs';
import { readTree } from '../shared/files.ts';
import { SCAN_TARGETS, isScanTarget, scanBundle } from './scan.ts';

const USAGE = `usage: bundle/cli.ts --target <${SCAN_TARGETS.join('|')}> <dist directory>\n`;

function main(argv: readonly string[]): number {
  const [flag, target, dir] = argv;
  if (argv.length !== 3 || flag !== '--target' || target === undefined || !isScanTarget(target) || dir === undefined) {
    process.stderr.write(USAGE);
    return 2;
  }
  try {
    if (!existsSync(dir)) throw new Error(`${dir} does not exist (build first)`);
    const files = readTree(dir);
    const findings = scanBundle(files, target);
    if (findings.length > 0) {
      process.stderr.write(`bundle scan (${target}): ${findings.length} finding(s) in ${dir}\n`);
      for (const f of findings) process.stderr.write(`  ${f.rule.padEnd(22)} ${f.file}: ${f.match}\n`);
      return 1;
    }
    process.stdout.write(`bundle scan (${target}): ${files.length} files clean in ${dir}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`bundle scan: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
