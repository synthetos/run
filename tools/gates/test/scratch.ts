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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** The commit SHA scratch builds report (they are copies, not git checkouts). */
export const SCRATCH_BUILD_SHA = '5c7a7c405c7a7c405c7a7c405c7a7c405c7a7c40';

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

  /**
   * Links a node_modules directory into the copy. The root's is linked whole.
   * A workspace package's is rebuilt entry by entry, so that links to other
   * workspace packages (`@synthetos/*`) point into the copy, not back into
   * the real tree, while installed npm packages are shared.
   */
  private linkNodeModules(relativeDir: string): void {
    const source = join(REPO_ROOT, relativeDir, 'node_modules');
    const target = join(this.root, relativeDir, 'node_modules');
    if (!existsSync(source) || !existsSync(dirname(target))) return;
    if (relativeDir === '.') {
      symlinkSync(source, target, 'dir');
      return;
    }
    const link = (from: string, to: string): void => {
      mkdirSync(dirname(to), { recursive: true });
      const real = realpathSync(from);
      const inRepo = real.startsWith(`${REPO_ROOT}/`) && !real.includes('/node_modules/');
      symlinkSync(inRepo ? join(this.root, relative(REPO_ROOT, real)) : from, to, 'dir');
    };
    for (const entry of readdirSync(source)) {
      if (entry.startsWith('@')) {
        for (const scoped of readdirSync(join(source, entry))) link(join(source, entry, scoped), join(target, entry, scoped));
      } else {
        link(join(source, entry), join(target, entry));
      }
    }
  }

  /** Writes (creating directories as needed) a file relative to the copy's root. */
  write(relativePath: string, content: string): void {
    const target = join(this.root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  /** Reads a file relative to the copy's root. */
  read(relativePath: string): string {
    return readFileSync(join(this.root, relativePath), 'utf8');
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

  /**
   * `pnpm --filter web build`: Vite with the repository's web config, in the
   * copy. Vitest sets NODE_ENV=test, which the web config refuses to build
   * under, so the build gets the environment CI gives it (NODE_ENV unset)
   * unless `nodeEnv` says otherwise. The copy is not a git checkout, so the
   * build gets a fixed commit SHA for the version chip (apps/web/build/buildInfo.ts).
   */
  buildWeb(nodeEnv?: string): GateResult {
    const env: NodeJS.ProcessEnv = { ...process.env, RUN_BUILD_SHA: SCRATCH_BUILD_SHA };
    delete env['NODE_ENV'];
    if (nodeEnv !== undefined) env['NODE_ENV'] = nodeEnv;
    return this.run([join(this.root, 'apps/web/node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], join(this.root, 'apps/web'), env);
  }

  /** `pnpm build:fake-serial`: the copy's fake-serial test build into apps/web/dist-fake-serial (ROADMAP P0-14). */
  buildFakeSerial(): GateResult {
    const env: NodeJS.ProcessEnv = { ...process.env, RUN_BUILD_SHA: SCRATCH_BUILD_SHA };
    delete env['NODE_ENV'];
    return this.run([join(this.root, 'apps/web/node_modules/vite/bin/vite.js'), 'build', '--mode', 'fake-serial', '--logLevel', 'warn'], join(this.root, 'apps/web'), env);
  }

  /** `pnpm scan`: the bundle scan over the copy's built web app. */
  scan(): GateResult {
    return this.run([join(this.root, 'tools/gates/src/bundle/cli.ts'), join(this.root, 'apps/web/dist')]);
  }

  /** Runs one of the repository's dependency-free gate CLIs (path relative to the copy's root). */
  gate(script: string, args: readonly string[] = []): GateResult {
    return this.run([join(this.root, script), ...args]);
  }

  private run(args: readonly string[], cwd: string = this.root, env: NodeJS.ProcessEnv = process.env): GateResult {
    const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 120_000 });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  dispose(): void {
    rmSync(this.base, { recursive: true, force: true });
  }
}
