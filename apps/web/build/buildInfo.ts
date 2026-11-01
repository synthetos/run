/**
 * The version and commit the bundle is built from (ROADMAP P0-05: the safety
 * bar shows "the app version and SHA").
 *
 * - version: apps/web/package.json `version`.
 * - sha: `RUN_BUILD_SHA` when set (40 hex digits; the gate tests set it for
 *   their scratch copies, which are not git checkouts), otherwise
 *   `git rev-parse HEAD` in the web root, with `-dirty` appended when the
 *   working tree has uncommitted changes. CI and `pnpm repro` build clean
 *   checkouts, so their SHA is the commit's.
 *
 * A build with no determinable commit is refused: a chip that showed a wrong
 * or missing version would mislead a safety report (SECURITY.md asks for it).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BuildInfo, checkBuildInfo } from '../src/build-info/buildInfo.ts';

function git(webRoot: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', webRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function buildInfo(webRoot: string, env: NodeJS.ProcessEnv = process.env): BuildInfo {
  const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as { version: string };
  const fromEnv = env['RUN_BUILD_SHA'];
  let sha: string;
  if (fromEnv !== undefined && fromEnv !== '') {
    sha = fromEnv;
  } else {
    try {
      sha = git(webRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
      if (git(webRoot, ['status', '--porcelain', '--untracked-files=normal']) !== '') sha += '-dirty';
    } catch (error) {
      throw new Error(
        `refusing to build without a commit SHA: set RUN_BUILD_SHA or build from a git checkout (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  return checkBuildInfo({ version: pkg.version, sha });
}
