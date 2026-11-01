/**
 * `safety-review` check CLI (ROADMAP P0-03). The workflow
 * `.github/workflows/safety-review.yml` fetches the PR's files and reviews
 * with `gh api ... --paginate --slurp` and runs this from the BASE branch's
 * checkout, so a PR cannot weaken the check that judges it:
 *
 *   node tools/gates/src/review/cli.ts --files files.json --reviews reviews.json \
 *     --author <login> --head-sha <sha> --body-file body.md
 *
 * Exit status: 0 pass, 1 requirements not met, 2 could not run.
 */
import { readFileSync } from 'node:fs';
import { evaluateSafetyReview, type Review } from './safetyReview.ts';

function arg(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined) throw new Error(`missing ${flag}`);
  return value;
}

/** `gh api --paginate --slurp` returns an array of pages; accept a flat array too. */
function pages(path: string): Record<string, unknown>[] {
  const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(data)) throw new Error(`${path}: expected a JSON array`);
  return (data.every(Array.isArray) ? data.flat() : data) as Record<string, unknown>[];
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`unexpected API data: ${what} is not a string`);
  return value;
}

function main(argv: readonly string[]): number {
  try {
    const changedFiles = pages(arg(argv, '--files')).flatMap((f) => {
      const names = [str(f['filename'], 'filename')];
      if (typeof f['previous_filename'] === 'string') names.push(f['previous_filename']);
      return names;
    });
    if (changedFiles.length === 0) throw new Error('the PR has no changed files according to the API');
    const reviews: Review[] = pages(arg(argv, '--reviews')).map((r) => ({
      user: str((r['user'] as Record<string, unknown> | null)?.['login'] ?? '', 'review user'),
      state: str(r['state'], 'review state'),
      commitId: str(r['commit_id'], 'review commit_id'),
      association: str(r['author_association'], 'review author_association'),
      submittedAt: typeof r['submitted_at'] === 'string' ? r['submitted_at'] : '',
    }));
    const result = evaluateSafetyReview({
      author: arg(argv, '--author'),
      headSha: arg(argv, '--head-sha'),
      body: readFileSync(arg(argv, '--body-file'), 'utf8'),
      changedFiles,
      reviews,
    });
    if (result.safetyPaths.length === 0) {
      process.stdout.write('safety review: no safety-review path touched; the normal review rules apply\n');
      return 0;
    }
    process.stdout.write(`safety review: ${result.safetyPaths.length} safety-review path(s) touched:\n`);
    for (const p of result.safetyPaths) process.stdout.write(`  ${p}\n`);
    process.stdout.write(`approvals of the head commit: ${result.approvers.join(', ') || 'none'}\n`);
    if (result.problems.length > 0) {
      for (const p of result.problems) process.stderr.write(`safety review: ${p}\n`);
      return 1;
    }
    process.stdout.write('safety review: checklist complete and approvals present\n');
    return 0;
  } catch (error) {
    process.stderr.write(`safety review: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
