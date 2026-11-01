/**
 * CI policy CLI (ROADMAP P0-03). Run with `pnpm ci-policy` (which also runs
 * the CODEOWNERS and PR-template checks):
 *
 *   node tools/gates/src/workflow/cli.ts [repo-root]
 *
 * Checks every `.github/workflows/*.yml` against policy.ts. Exit status:
 * 0 clean, 1 findings, 2 could not run (no workflow found never passes).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkWorkflow } from './policy.ts';

function main(argv: readonly string[]): number {
  const dir = join(argv[0] ?? '.', '.github', 'workflows');
  try {
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
    if (!files.includes('ci.yml')) throw new Error(`${dir}/ci.yml not found`);
    const findings = files.flatMap((f) => checkWorkflow(f, readFileSync(join(dir, f), 'utf8')));
    if (findings.length > 0) {
      process.stderr.write(`workflow policy: ${findings.length} finding(s)\n`);
      for (const f of findings) process.stderr.write(`  ${f.file}:${f.line} ${f.rule}: ${f.message}\n`);
      return 1;
    }
    process.stdout.write(`workflow policy: ${files.length} workflow(s) clean (${files.join(', ')})\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`workflow policy: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
