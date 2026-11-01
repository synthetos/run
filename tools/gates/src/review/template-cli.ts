/**
 * PR template check CLI (ROADMAP P0-03), part of `pnpm ci-policy`:
 *
 *   node tools/gates/src/review/template-cli.ts [repo-root]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkTemplate } from './template.ts';

function main(argv: readonly string[]): number {
  const root = argv[0] ?? '.';
  try {
    const problems = checkTemplate(
      readFileSync(join(root, '.github/pull_request_template.md'), 'utf8'),
      readFileSync(join(root, 'SAFETY.md'), 'utf8'),
    );
    if (problems.length > 0) {
      process.stderr.write(`pr template: ${problems.length} problem(s)\n`);
      for (const p of problems) process.stderr.write(`  ${p}\n`);
      return 1;
    }
    process.stdout.write('pr template: SAFETY §8 checklist complete and in sync with SAFETY.md\n');
    return 0;
  } catch (error) {
    process.stderr.write(`pr template: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
