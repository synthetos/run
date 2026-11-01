/**
 * Minimal build-toolchain install for the `build` CI job (ROADMAP P0-03,
 * RUN_PLAN §6.2, red-team round 2 AS-F19).
 *
 * The attested bundle must not be built where test-only dev tools (vitest,
 * Playwright, ESLint, dependency-cruiser, ...) have been installed: one
 * compromised test dependency could otherwise alter the bundle. Those tools
 * are all root devDependencies, and pnpm always installs the workspace root,
 * even under `--filter`. So the build job installs from a lockfile subset:
 *
 * 1. the root importer is emptied, in `package.json` (no devDependencies)
 *    and in `pnpm-lock.yaml` (`.: {}`), and nothing else changes;
 * 2. `pnpm install --frozen-lockfile --ignore-scripts --filter-prod
 *    @synthetos/web...` then installs only the web app and the workspace
 *    packages it reaches through `dependencies` (never `devDependencies`, so
 *    the dev-only test kit is not installed), with every package version and
 *    integrity hash taken from the committed lockfile;
 * 3. the installed store is checked: no root devDependency and no
 *    devDependency of a workspace package outside the build may be present,
 *    and no workspace package outside the production closure may have been
 *    installed.
 *
 * Dependency-free (node: only), so it runs before anything is installed.
 */

/**
 * The pnpm filter that selects the production build: the web app and the
 * workspace packages it reaches through `dependencies`. Used with
 * `--filter-prod`, so a workspace package that is only a devDependency
 * somewhere in the graph (the test kit) is not selected.
 */
export const BUILD_FILTER = '@synthetos/web...';

/** The pnpm flag `BUILD_FILTER` is passed with. */
export const BUILD_FILTER_FLAG = '--filter-prod';

/** The workspace package name of the production build's entry. */
export const BUILD_ENTRY = '@synthetos/web';

/** The workspace packages whose devDependencies are the production build toolchain. */
export const BUILD_IMPORTERS: readonly string[] = ['apps/web'];

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly [key: string]: unknown;
}

/**
 * The root package.json without its devDependencies. The root must declare
 * no runtime dependencies at all: anything it declared would be installed
 * into the build.
 */
export function subsetRootManifest(text: string): string {
  const manifest = JSON.parse(text) as Manifest;
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    if (manifest[field] !== undefined && Object.keys(manifest[field]).length > 0) {
      throw new Error(`the root package.json declares ${field}; the root may hold devDependencies only`);
    }
  }
  const { devDependencies: _dropped, ...rest } = manifest;
  return `${JSON.stringify(rest, null, 2)}\n`;
}

/**
 * The lockfile with its root importer (`.`) emptied. Everything else,
 * including every package's resolution and integrity, is unchanged. Fails
 * closed if the layout is not the one pnpm 10 writes.
 */
export function subsetLockfile(text: string): string {
  const lines = text.split('\n');
  const importers = lines.indexOf('importers:');
  if (importers === -1) throw new Error('pnpm-lock.yaml has no top-level importers: section');
  let start = -1;
  for (let i = importers + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line !== '' && !line.startsWith(' ')) break; // next top-level section
    if (line === '  .:' || line === '  .: {}') {
      start = i;
      break;
    }
  }
  if (start === -1) throw new Error('pnpm-lock.yaml has no root importer (".") under importers:');
  let end = start + 1;
  while (end < lines.length && ((lines[end] ?? '').startsWith('    ') || (lines[end] ?? '').startsWith('\t'))) end++;
  return [...lines.slice(0, start), '  .: {}', ...lines.slice(end)].join('\n');
}

/**
 * Package names that must not be installed in the build: every root
 * devDependency and every devDependency of a workspace package outside
 * `BUILD_IMPORTERS`. Type-only packages (`@types/*`) are exempt: they hold no
 * executable code, and the build tools resolve `@types/node` as a peer.
 */
export function forbiddenBuildPackages(
  root: Manifest,
  workspace: ReadonlyMap<string, Manifest>,
): ReadonlySet<string> {
  const forbidden = new Set<string>(Object.keys(root.devDependencies ?? {}));
  for (const [dir, manifest] of workspace) {
    if (BUILD_IMPORTERS.includes(dir)) continue;
    for (const name of Object.keys(manifest.devDependencies ?? {})) forbidden.add(name);
  }
  for (const name of [...forbidden]) if (name.startsWith('@types/')) forbidden.delete(name);
  return forbidden;
}

/**
 * Package names from the directory names of pnpm's virtual store
 * (`node_modules/.pnpm`): `@scope+name@1.2.3_peer...` is `@scope/name`,
 * `name@1.2.3` is `name`. Store bookkeeping entries are skipped.
 */
export function storePackageNames(entries: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'lock.yaml' || entry.startsWith('.')) continue;
    const scoped = entry.startsWith('@');
    const at = entry.indexOf('@', scoped ? 1 : 0);
    if (at <= 0) throw new Error(`unrecognised pnpm store entry '${entry}'`);
    const name = entry.slice(0, at);
    names.add(scoped ? name.replace('+', '/') : name);
  }
  return names;
}

/** The forbidden packages that are installed. Empty means the build toolchain is minimal. */
export function forbiddenInstalled(installed: ReadonlySet<string>, forbidden: ReadonlySet<string>): string[] {
  return [...installed].filter((name) => forbidden.has(name)).sort();
}

/**
 * The workspace directories in the production closure of `entry`: the entry
 * and every workspace package reached through `dependencies` (a
 * `workspace:` spec), transitively. devDependencies are never followed.
 */
export function productionClosure(entry: string, workspace: ReadonlyMap<string, Manifest & { readonly name?: unknown }>): ReadonlySet<string> {
  const byName = new Map<string, string>();
  for (const [dir, manifest] of workspace) if (typeof manifest.name === 'string') byName.set(manifest.name, dir);
  const out = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    const dir = byName.get(name);
    if (dir === undefined || out.has(dir)) continue;
    out.add(dir);
    const deps = (workspace.get(dir) as Manifest).dependencies ?? {};
    for (const [dep, spec] of Object.entries(deps)) if (spec.startsWith('workspace:')) queue.push(dep);
  }
  return out;
}
