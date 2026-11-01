/**
 * Production vs fake-serial test artifact (ROADMAP P0-14). Run with
 * `pnpm fake-serial:diff` after both builds, or:
 *
 *   node tools/gates/src/artifact/diff-cli.ts <production site> <test site>
 *
 * Prints the hash list of both trees, then any finding (diff.ts).
 * Exit status: 0 only the seam chunk differs, 1 findings, 2 could not run.
 */
import { existsSync } from 'node:fs';
import { readTree } from '../shared/files.ts';
import { compareArtifacts, renderHashList } from './diff.ts';

function main(argv: readonly string[]): number {
  const [production, test] = argv;
  if (production === undefined || test === undefined || argv.length !== 2) {
    process.stderr.write('usage: artifact/diff-cli.ts <production site directory> <test site directory>\n');
    return 2;
  }
  try {
    for (const dir of [production, test]) if (!existsSync(dir)) throw new Error(`${dir} does not exist (build first)`);
    const result = compareArtifacts(readTree(production), readTree(test));
    process.stdout.write(renderHashList(result.production, result.test));
    if (result.findings.length > 0) {
      process.stderr.write(`artifact diff: ${result.findings.length} finding(s): ${production} vs ${test}\n`);
      for (const f of result.findings) process.stderr.write(`  ${f.rule.padEnd(22)} ${f.message}\n`);
      return 1;
    }
    process.stdout.write(`artifact diff: ${result.production.entries.length} files; only the transport seam chunk differs\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`artifact diff: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
