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
 * The same idea files the Web Serial transport (P1-00, ROADMAP P1-01). In
 * the machine worker's build, a code-splitting group gives
 * `packages/machine/src/webSerialTransport.ts` a chunk of its own, and
 * `workerChunkFileName` puts a chunk under `assets/serial/` only when it
 * holds that module and nothing else but the bundler runtime. The transport
 * may have type-only imports (dependency-cruiser
 * `web-serial-transport-type-imports-only`), so nothing else can join it;
 * should anything ever do so, the chunk is filed under `assets/` instead and
 * the bundle scan refuses its Web Serial code. The bundle scan admits Web
 * Serial only in `assets/serial/`, and only for the staging and bench
 * targets.
 *
 * The page build has exactly one serial case (OD-3, approved 2026-11-02):
 * the window's port chooser, `packages/machine/src/webSerialChooser.ts`.
 * A code-splitting group gives it a chunk of its own, and `chunkFileName`
 * files a chunk under `assets/serial/` only when it holds the chooser and
 * nothing else but the bundler runtime. The transport never goes there
 * from the page build (dependency-cruiser keeps it out of the main
 * thread), and should anything join the chooser's chunk it lands under
 * `assets/`, where the scan refuses its Web Serial code.
 *
 * A change to this file changes what the bundle scan trusts and needs
 * safety-path review (CODEOWNERS).
 */
import { resolve, sep } from 'node:path';

/** Directory (inside dist) that holds cloud-client chunks. The bundle scan reads this. */
export const CLOUD_ASSET_DIR = 'assets/cloud/';

/** The chunk group name for cloud-client code. */
export const CLOUD_CHUNK_NAME = 'cloud';

/** Directory (inside dist) that holds the Web Serial transport's chunk. The bundle scan reads this. */
export const SERIAL_ASSET_DIR = 'assets/serial/';

/** The worker build's chunk group name for the Web Serial transport. */
export const SERIAL_CHUNK_NAME = 'web-serial';

/** The page build's chunk group name for the window's port chooser (OD-3). */
export const SERIAL_CHOOSER_CHUNK_NAME = 'web-serial-chooser';

/**
 * The one module that may use Web Serial, repository-relative. The gates'
 * copy (tools/gates/src/shared/webSerialNames.ts, WEB_SERIAL_TRANSPORT_MODULE)
 * is the canonical one; apps/ may not import tools/, so this is a copy, and
 * tools/gates/test/bundle-scan.test.ts fails if the two ever differ.
 */
export const WEB_SERIAL_TRANSPORT_PATH = 'packages/machine/src/webSerialTransport.ts';

/** The window's port chooser, repository-relative (copy of WEB_SERIAL_CHOOSER_MODULE; the same test checks it). */
export const WEB_SERIAL_CHOOSER_PATH = 'packages/machine/src/webSerialChooser.ts';

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
  /** The output file name pattern for a non-entry chunk of the page build. */
  chunkFileName(chunk: { readonly moduleIds: readonly string[] }): string;
  /** True for the Web Serial transport module. */
  isWebSerialModule(id: string): boolean;
  /** True for a module that may be in the serial chunk: the transport itself and the bundler runtime. */
  isSerialChunkMember(id: string): boolean;
  /** True for the window's port chooser (OD-3). */
  isWebSerialChooserModule(id: string): boolean;
  /** The output file name pattern for a non-entry chunk of a worker build. */
  workerChunkFileName(chunk: { readonly moduleIds: readonly string[] }): string;
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

  const webSerial = `${repo}/${WEB_SERIAL_TRANSPORT_PATH}`;
  const isWebSerialModule = (id: string): boolean => slashes(id) === webSerial;
  const isSerialChunkMember = (id: string): boolean => id === bundlerRuntime || isWebSerialModule(id);
  const chooser = `${repo}/${WEB_SERIAL_CHOOSER_PATH}`;
  const isWebSerialChooserModule = (id: string): boolean => slashes(id) === chooser;
  const isChooserChunkMember = (id: string): boolean => id === bundlerRuntime || isWebSerialChooserModule(id);

  const chunkFileName = (chunk: { readonly moduleIds: readonly string[] }): string => {
    const ids = chunk.moduleIds;
    if (ids.some(isWebSerialChooserModule) && ids.every(isChooserChunkMember)) return `${SERIAL_ASSET_DIR}[name]-[hash].js`;
    const cloud = ids.length > 0 && ids.some(isCloudModule) && ids.every(isCloudChunkMember);
    return cloud ? `${CLOUD_ASSET_DIR}[name]-[hash].js` : 'assets/[name]-[hash].js';
  };

  return {
    isCloudModule,
    isCloudChunkMember,
    chunkFileName,
    isWebSerialModule,
    isSerialChunkMember,
    isWebSerialChooserModule,
    workerChunkFileName(chunk) {
      const ids = chunk.moduleIds;
      const serial = ids.some(isWebSerialModule) && ids.every(isSerialChunkMember);
      return serial ? `${SERIAL_ASSET_DIR}[name]-[hash].js` : chunkFileName(chunk);
    },
  };
}
