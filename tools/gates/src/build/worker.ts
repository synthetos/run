/**
 * Builds the run Worker script for the attested artifact (ROADMAP P0-04,
 * closing the P0-03 hand-off in docs/ops/ci.md).
 *
 * The deploy jobs must deploy only attested bytes, so the Worker is built in
 * the secret-free `build` job (twice, compared byte for byte, like the web
 * bundle) and deployed with `wrangler deploy --no-bundle`. wrangler is not
 * part of the build toolchain, and the Worker has no npm dependency, so the
 * build is deliberately small and auditable:
 *
 * - every `workers/run/src/*.ts` file becomes `<name>.mjs`, with types erased
 *   by Node's own `stripTypeScriptTypes` (strip mode: type syntax is replaced
 *   by whitespace, nothing else changes; the repo's `erasableSyntaxOnly`
 *   guarantees there is nothing to transform);
 * - every import must be a relative `./<name>.ts` of another file in the same
 *   directory, and is rewritten to `./<name>.mjs`;
 * - anything else fails closed: a bare (npm) or parent-relative specifier, a
 *   dynamic `import()`, `require`, or a subdirectory.
 *
 * When the Worker starts importing `contracts` (A1), this builder refuses the
 * import, and the Worker must move to a real bundler inside the build
 * toolchain (Vite/Rolldown). That is intended: the failure is loud.
 *
 * Dependency-free (node: only), so the build job runs it without dev tools.
 */
import { stripTypeScriptTypes } from 'node:module';

export interface SourceFile {
  /** File name inside workers/run/src, for example `index.ts`. */
  readonly name: string;
  readonly source: string;
}

export interface BuiltModule {
  /** Output file name, for example `index.mjs`. */
  readonly name: string;
  readonly code: string;
}

export class WorkerBuildError extends Error {
  override readonly name = 'WorkerBuildError';
}

const SOURCE_NAME = /^[A-Za-z0-9_-]+\.ts$/;
const LOCAL_SPECIFIER = /^\.\/([A-Za-z0-9_-]+)\.ts$/;
/** `from '<spec>'` and side-effect `import '<spec>'`. */
const STATIC_SPECIFIER = /\b(from|import)(\s*)(['"])([^'"\n]*)\3/g;

/** Erases types and rewrites the local imports of one file. */
export function buildModule(file: SourceFile, available: ReadonlySet<string>): BuiltModule {
  if (!SOURCE_NAME.test(file.name)) throw new WorkerBuildError(`${file.name}: unexpected file name`);
  let code: string;
  try {
    code = stripTypeScriptTypes(file.source, { mode: 'strip' });
  } catch (error) {
    throw new WorkerBuildError(`${file.name}: cannot erase types: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (/\bimport\s*\(/.test(code)) throw new WorkerBuildError(`${file.name}: dynamic import() is not allowed in the Worker`);
  if (/\brequire\s*\(/.test(code)) throw new WorkerBuildError(`${file.name}: require() is not allowed in the Worker`);
  const rewritten = code.replace(STATIC_SPECIFIER, (_all, keyword: string, gap: string, quote: string, spec: string) => {
    const local = LOCAL_SPECIFIER.exec(spec);
    if (local === null) {
      throw new WorkerBuildError(`${file.name}: import '${spec}' is not a local ./<name>.ts module (npm and parent imports need a bundler)`);
    }
    if (!available.has(`${local[1]}.ts`)) throw new WorkerBuildError(`${file.name}: import '${spec}' does not exist in workers/run/src`);
    return `${keyword}${gap}${quote}./${local[1]}.mjs${quote}`;
  });
  return { name: file.name.replace(/\.ts$/, '.mjs'), code: rewritten };
}

/** Builds every source file. `index.ts` must be present: it is the entry. */
export function buildWorker(files: readonly SourceFile[]): BuiltModule[] {
  const names = new Set(files.map((f) => f.name));
  if (!names.has('index.ts')) throw new WorkerBuildError('workers/run/src/index.ts (the entry) is missing');
  return [...files].sort((a, b) => (a.name < b.name ? -1 : 1)).map((f) => buildModule(f, names));
}
