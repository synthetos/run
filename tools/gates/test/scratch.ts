/**
 * A throwaway copy of the working tree, used to prove that each gate fails
 * on a violation exactly as it would on a scratch branch in CI.
 *
 * The copy holds every tracked and untracked-but-not-ignored file, with the
 * real `node_modules` directories symlinked in (nothing is installed). It
 * lives under the OS temp directory, next to an `outside/` directory that
 * stands in for code outside the repository.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const WORKSPACE_GROUPS = ['packages', 'apps', 'workers', 'tools'];

export interface GateResult {
  readonly status: number | null;
  readonly output: string;
}

export class ScratchRepo {
  readonly base: string;
  readonly root: string;

  private constructor(base: string) {
    this.base = base;
    this.root = join(base, 'repo');
  }

  static create(): ScratchRepo {
    const scratch = new ScratchRepo(mkdtempSync(join(tmpdir(), 'run-gates-')));
    mkdirSync(scratch.root);
    mkdirSync(join(scratch.base, 'outside'));
    const listed = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
    });
    for (const file of listed.split('\0')) {
      // Deleted-but-tracked files are listed too; skip what is not there.
      if (file === '' || !existsSync(join(REPO_ROOT, file))) continue;
      const target = join(scratch.root, file);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(REPO_ROOT, file), target);
    }
    scratch.linkNodeModules('.');
    for (const group of WORKSPACE_GROUPS) {
      const dir = join(REPO_ROOT, group);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) scratch.linkNodeModules(join(group, entry));
    }
    return scratch;
  }

  private linkNodeModules(relativeDir: string): void {
    const source = join(REPO_ROOT, relativeDir, 'node_modules');
    const target = join(this.root, relativeDir, 'node_modules');
    if (existsSync(source) && existsSync(dirname(target))) symlinkSync(source, target, 'dir');
  }

  /** Writes (creating directories as needed) a file relative to the copy's root. */
  write(relativePath: string, content: string): void {
    const target = join(this.root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  /** Appends to an existing file relative to the copy's root. */
  append(relativePath: string, content: string): void {
    const target = join(this.root, relativePath);
    writeFileSync(target, readFileSync(target, 'utf8') + content);
  }

  /** `pnpm lint`: ESLint over the whole tree with the repository config. */
  lint(): GateResult {
    return this.run([join(this.root, 'node_modules/eslint/bin/eslint.js'), '.']);
  }

  /** `pnpm deps`: dependency-cruiser with the repository config. */
  deps(): GateResult {
    return this.run([
      join(this.root, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
      'packages',
      'apps',
      'workers',
      'tools',
      '--config',
      '.dependency-cruiser.cjs',
    ]);
  }

  /** `pnpm licence`, fed with the given `pnpm licenses list --json` reports. */
  licence(prodReport: unknown, allReport: unknown): GateResult {
    const prodPath = join(this.base, 'licences-prod.json');
    const allPath = join(this.base, 'licences-all.json');
    writeFileSync(prodPath, JSON.stringify(prodReport));
    writeFileSync(allPath, JSON.stringify(allReport));
    return this.run([join(this.root, 'tools/gates/src/licence/cli.ts'), '--prod-json', prodPath, '--all-json', allPath]);
  }

  private run(args: readonly string[]): GateResult {
    const result = spawnSync(process.execPath, args, { cwd: this.root, encoding: 'utf8', timeout: 120_000 });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  dispose(): void {
    rmSync(this.base, { recursive: true, force: true });
  }
}
