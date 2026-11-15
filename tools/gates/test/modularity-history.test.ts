import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { checkBaselineHistory } from '../src/modularity/history.ts';
import { BASELINE_PATH, type BaselineFile } from '../src/modularity/types.ts';
// Ephemeral fixtures stay outside the source tree and are removed in afterEach.
const roots: string[] = [];
const empty: BaselineFile = { format: 1, files: {} };
const baseline = (value: number): BaselineFile => ({ format: 1, files: { 'packages/a.ts': { 'complexity $/f': value } } });
function git(root: string, args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'run-modularity-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  mkdirSync(join(root, 'tools/gates'), { recursive: true });
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'Initial']);
  return root;
}
function commit(root: string, value: BaselineFile): void {
  writeFileSync(join(root, BASELINE_PATH), JSON.stringify(value));
  git(root, ['add', BASELINE_PATH]);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'Baseline']);
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('allows bootstrap and reductions but catches committed and uncommitted increases', () => {
  const root = repo();
  expect(checkBaselineHistory(root, baseline(20))).toEqual([]);
  commit(root, baseline(20));
  expect(checkBaselineHistory(root, baseline(21))[0]).toContain('Raised baseline');
  commit(root, baseline(18));
  expect(checkBaselineHistory(root, baseline(18))).toEqual([]);
  commit(root, baseline(19));
  expect(checkBaselineHistory(root, baseline(19))[0]).toContain('Raised baseline');
});
it('does not re-grant a removed allowance and fails closed without history', () => {
  const root = repo();
  commit(root, baseline(20));
  commit(root, empty);
  expect(checkBaselineHistory(root, baseline(20))[0]).toContain('New baseline allowance');
  writeFileSync(join(root, '.git/shallow'), `${git(root, ['rev-parse', 'HEAD'])}\n`);
  expect(() => checkBaselineHistory(root, empty)).toThrow('full git history');
});
