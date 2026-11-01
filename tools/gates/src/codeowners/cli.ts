/**
 * CODEOWNERS check CLI (ROADMAP P0-03). Run with `pnpm codeowners`:
 *
 *   node tools/gates/src/codeowners/cli.ts [repo-root]
 *
 * Exit status: 0 complete, 1 a required path is missing or not owned,
 * 2 the check could not run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADDITIONAL_REQUIRED_PATHS, checkCodeowners, safetySection8Paths } from './check.ts';

function main(argv: readonly string[]): number {
  const root = argv[0] ?? '.';
  try {
    const required = [...safetySection8Paths(readFileSync(join(root, 'SAFETY.md'), 'utf8')), ...ADDITIONAL_REQUIRED_PATHS];
    const problems = checkCodeowners(readFileSync(join(root, '.github/CODEOWNERS'), 'utf8'), required);
    if (problems.length > 0) {
      process.stderr.write(`codeowners: ${problems.length} problem(s)\n`);
      for (const p of problems) process.stderr.write(`  ${p}\n`);
      return 1;
    }
    process.stdout.write(`codeowners: all ${required.length} SAFETY §8 paths are owned\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`codeowners: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
