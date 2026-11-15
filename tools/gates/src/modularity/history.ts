import { execFileSync } from 'node:child_process';
import { BASELINE_PATH, readBaseline, type BaselineFile } from './types.ts';

/** No new allowances after bootstrap, even if source and JSON grow in the same commit. */
export function compareBaselines(before: BaselineFile, after: BaselineFile): string[] {
  const errors: string[] = [];
  for (const [file, entries] of Object.entries(after.files)) {
    for (const [key, value] of Object.entries(entries)) {
      const previous = before.files[file]?.[key];
      if (previous === undefined) errors.push(`New baseline allowance: ${file} ${key}`);
      else if (value > previous) errors.push(`Raised baseline: ${file} ${key}: ${previous} -> ${value}`);
    }
  }
  return errors;
}
function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
/** Check first-parent committed revisions (including merge results) and the working copy; shallow/no-git checkouts fail closed. */
export function checkBaselineHistory(root: string, current: BaselineFile): string[] {
  if (git(root, ['rev-parse', '--is-shallow-repository']) !== 'false') throw new Error('Modularity ratchet requires full git history (fetch-depth: 0).');
  const commits = git(root, ['log', '--first-parent', '--reverse', '--format=%H', '--', BASELINE_PATH]).split('\n').filter(Boolean);
  let previous: BaselineFile | undefined;
  const errors: string[] = [];
  for (const commit of commits) {
    const baseline = readBaseline(JSON.parse(git(root, ['show', `${commit}:${BASELINE_PATH}`])));
    if (previous) errors.push(...compareBaselines(previous, baseline).map(error => `${commit}: ${error}`));
    previous = baseline;
  }
  if (previous) errors.push(...compareBaselines(previous, current));
  return errors;
}
