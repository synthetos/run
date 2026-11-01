import { defineConfig } from 'vite';
import { buildInfo } from './build/buildInfo.ts';
import { CLOUD_CHUNK_NAME, chunkPolicy } from './build/chunks.ts';
import { prerender } from './build/prerender.ts';

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
  const build = buildInfo(import.meta.dirname);
  return {
    base: '/',
    // Every page is prerendered from the Preact components (build/prerender.ts).
    plugins: [prerender(build)],
    // The version chip's values for the client bundle (src/env.d.ts).
    define: { __RUN_BUILD__: JSON.stringify(build) },
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
      // Never inline assets as data: URIs. The CSP allows fonts from 'self'
      // only (`font-src 'self'`), so an inlined font would be blocked.
      assetsInlineLimit: 0,
      // Chrome and Edge support <link rel="modulepreload"> natively. Vite's
      // polyfill would put a fetch() call in every entry chunk, outside the
      // cloud client, which the bundle scan rightly refuses (RUN_PLAN §6.2).
      modulePreload: { polyfill: false },
      rolldownOptions: {
        // Multi-page app: one HTML input per page, relative to the project root.
        // 404.html is the asset layer's not-found page (wrangler.jsonc
        // `not_found_handling: 404-page`). Each page is registered in
        // src/pages/registry.ts, which the prerender plugin enforces.
        input: {
          workspace: 'index.html',
          safety: 'safety/index.html',
          privacy: 'privacy/index.html',
          notFound: '404.html',
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
