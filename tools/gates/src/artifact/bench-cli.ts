/**
 * Release vs localhost bench artifact (P1-00). Run with `pnpm bench:check`
 * after both builds, or:
 *
 *   node tools/gates/src/artifact/bench-cli.ts <release site> <bench site>
 *
 * Prints the hash list of both trees, then any finding (bench.ts).
 * Exit status: 0 only the build-channel chunk differs, 1 findings, 2 could not run.
 */
import { existsSync } from 'node:fs';
import { readTree } from '../shared/files.ts';
import { compareBenchArtifacts, renderBenchHashList } from './bench.ts';

function main(argv: readonly string[]): number {
  const [release, bench] = argv;
  if (release === undefined || bench === undefined || argv.length !== 2) {
    process.stderr.write('usage: artifact/bench-cli.ts <release site directory> <bench site directory>\n');
    return 2;
  }
  try {
    for (const dir of [release, bench]) if (!existsSync(dir)) throw new Error(`${dir} does not exist (build first)`);
    const result = compareBenchArtifacts(readTree(release), readTree(bench));
    process.stdout.write(renderBenchHashList(result.release, result.bench));
    if (result.findings.length > 0) {
      process.stderr.write(`bench diff: ${result.findings.length} finding(s): ${release} vs ${bench}\n`);
      for (const f of result.findings) process.stderr.write(`  ${f.rule.padEnd(22)} ${f.message}\n`);
      return 1;
    }
    process.stdout.write(`bench diff: ${result.release.entries.length} files; only the build-channel chunk differs\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`bench diff: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
