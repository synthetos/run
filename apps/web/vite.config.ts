import { defineConfig } from 'vite';
import { CLOUD_CHUNK_NAME, chunkPolicy } from './build/chunks.ts';

const chunks = chunkPolicy(import.meta.dirname);

/**
 * Vite keeps a NODE_ENV that is already set, so `NODE_ENV=test vite build`
 * silently produces a development bundle (development code paths in
 * libraries, and JSX `__source` with absolute file paths). That bundle is
 * neither the reviewed production code nor reproducible across checkouts, so
 * a build under any other NODE_ENV is refused (ROADMAP P0-03).
 */
function assertProductionBuild(command: string): void {
  const env = process.env['NODE_ENV'];
  if (command === 'build' && env !== undefined && env !== 'production') {
    throw new Error(`refusing to build with NODE_ENV=${env}: the web bundle is built only with NODE_ENV unset or 'production'`);
  }
}

export default defineConfig(({ command }) => {
  assertProductionBuild(command);
  return {
    base: '/',
    // Preact automatic JSX runtime, configured directly (no extra plugin).
    // `development: false` keeps file paths and source positions out of the
    // bundle whatever the mode.
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'preact', development: false },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      // Chrome and Edge support <link rel="modulepreload"> natively. Vite's
      // polyfill would put a fetch() call in every entry chunk, outside the
      // cloud client, which the bundle scan rightly refuses (RUN_PLAN §6.2).
      modulePreload: { polyfill: false },
      rolldownOptions: {
        // Multi-page app: one HTML input per page, relative to the project root.
        // /safety/ and the other static pages join in P0-05.
        input: {
          workspace: 'index.html',
        },
        output: {
          // Cloud-client code gets its own chunk, filed under assets/cloud/
          // only when its contents qualify (build/chunks.ts). The bundle scan
          // allows network identifiers nowhere else.
          codeSplitting: {
            groups: [{ name: CLOUD_CHUNK_NAME, test: (id: string) => chunks.isCloudModule(id) }],
          },
          chunkFileNames: (chunk) => chunks.chunkFileName(chunk),
        },
      },
    },
  };
});
