/**
 * Where cloud-client code lands in the built bundle (ROADMAP P0-03,
 * RUN_PLAN §5.3, §6.2).
 *
 * The bundle scan allows network identifiers only in chunks under
 * `assets/cloud/`, so membership of that directory must be decided by what a
 * chunk contains, never by its name. Two pieces work together:
 *
 * - a code-splitting group pulls every module under `apps/web/src/cloud/`
 *   (and, by Rolldown's default, the modules it imports) into its own chunk,
 *   so cloud code is never merged into an entry chunk;
 * - `chunkFileName` puts a chunk under `assets/cloud/` only when it holds at
 *   least one cloud module and every module in it is either cloud code or one
 *   of the cloud client's permitted dependencies (contracts, provenance,
 *   valibot; dependency-cruiser enforces that list) or Rolldown's runtime
 *   helper. Any other chunk, whatever
 *   it is called, goes to `assets/`, where the scan refuses network code.
 *
 * A change to this file changes what the bundle scan trusts and needs
 * safety-path review (CODEOWNERS).
 */
import { resolve, sep } from 'node:path';

/** Directory (inside dist) that holds cloud-client chunks. The bundle scan reads this. */
export const CLOUD_ASSET_DIR = 'assets/cloud/';

/** The chunk group name for cloud-client code. */
export const CLOUD_CHUNK_NAME = 'cloud';

/** Normalises a module id to forward slashes so the tests below hold on every OS. */
function slashes(id: string): string {
  return id.split(sep).join('/');
}

/** Module-classification helpers bound to one checkout of the repository. */
export interface ChunkPolicy {
  /** True when the module is cloud-client source (`apps/web/src/cloud/**`). */
  isCloudModule(id: string): boolean;
  /** True when the module is cloud source or a permitted dependency of it. */
  isCloudChunkMember(id: string): boolean;
  /** The output file name pattern for a non-entry chunk. */
  chunkFileName(chunk: { readonly moduleIds: readonly string[] }): string;
}

/**
 * Builds the policy for the web app rooted at `webRoot` (the directory that
 * holds `vite.config.ts`). Paths are compared after resolving against that
 * root, so a module elsewhere that merely has `cloud` in its path never
 * matches.
 */
export function chunkPolicy(webRoot: string): ChunkPolicy {
  const web = slashes(resolve(webRoot));
  const repo = slashes(resolve(webRoot, '..', '..'));
  const cloudDir = `${web}/src/cloud/`;
  const allowedDependencyPrefixes = [`${repo}/packages/contracts/`, `${repo}/packages/provenance/`];
  const allowedNpm = /\/node_modules\/valibot\//;
  // Rolldown's own helper module (export/interop shims), which the bundler
  // places in whichever chunk first needs it. It is bundler code, not
  // application code, and holds no network identifier.
  const bundlerRuntime = '\0rolldown/runtime.js';

  const isCloudModule = (id: string): boolean => slashes(id).startsWith(cloudDir);
  const isCloudChunkMember = (id: string): boolean => {
    const path = slashes(id);
    return (
      id === bundlerRuntime ||
      path.startsWith(cloudDir) ||
      allowedDependencyPrefixes.some((prefix) => path.startsWith(prefix)) ||
      allowedNpm.test(path)
    );
  };

  return {
    isCloudModule,
    isCloudChunkMember,
    chunkFileName(chunk) {
      const ids = chunk.moduleIds;
      const cloud = ids.length > 0 && ids.some(isCloudModule) && ids.every(isCloudChunkMember);
      return cloud ? `${CLOUD_ASSET_DIR}[name]-[hash].js` : 'assets/[name]-[hash].js';
    },
  };
}
