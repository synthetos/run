import { defineConfig } from 'vite';
import { buildInfo } from './build/buildInfo.ts';
import { CLOUD_CHUNK_NAME, SERIAL_CHOOSER_CHUNK_NAME, SERIAL_CHUNK_NAME, chunkPolicy } from './build/chunks.ts';
import { FAKE_SERIAL_MODE, FAKE_SERIAL_OUT_DIR, TRANSPORT_CHUNK_NAME, assertBuildMode, fakeSerialPlugins, transportSeam } from './build/fakeSerial.ts';
import { prerender } from './build/prerender.ts';
import { BENCH_MODE, BENCH_OUT_DIR, CHANNEL_CHUNK_NAME, benchPlugin, channelSeam } from './build/bench.ts';

const chunks = chunkPolicy(import.meta.dirname);
const seam = transportSeam(import.meta.dirname);
const channel = channelSeam(import.meta.dirname);

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

export default defineConfig(({ command, mode }) => {
  assertProductionBuild(command);
  // `production`; `fake-serial`, the test-only build for the e2e suite
  // (build/fakeSerial.ts, ROADMAP P0-14); or `bench`, the localhost bench
  // build that is never deployed (build/bench.ts, P1-00). Any other mode is
  // refused.
  assertBuildMode(command, mode);
  const fakeSerial = command === 'build' && mode === FAKE_SERIAL_MODE ? fakeSerialPlugins(seam) : undefined;
  const bench = command === 'build' && mode === BENCH_MODE ? benchPlugin(channel) : undefined;
  const outDir = fakeSerial !== undefined ? FAKE_SERIAL_OUT_DIR : bench !== undefined ? BENCH_OUT_DIR : 'dist';
  const build = buildInfo(import.meta.dirname);
  return {
    base: '/',
    // Every page is prerendered from the Preact components (build/prerender.ts).
    plugins: [prerender(build), ...(fakeSerial === undefined ? [] : [fakeSerial.main]), ...(bench === undefined ? [] : [bench])],
    // The version chip's values for the client bundle (src/env.d.ts).
    define: { __RUN_BUILD__: JSON.stringify(build) },
    // Preact automatic JSX runtime, configured directly (no extra plugin).
    // `development: false` keeps file paths and source positions out of the
    // bundle whatever the mode.
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'preact', development: false },
    },
    // Workers (machine.worker, RUN_PLAN §5.4) are ES modules. The transport
    // seam gets a chunk of its own in every build, so the fake-serial test
    // build differs from production in that chunk only (build/fakeSerial.ts).
    // The Web Serial transport gets its own chunk too, filed under
    // assets/serial/ only when its contents qualify (build/chunks.ts); the
    // bundle scan admits Web Serial nowhere else (P1-00).
    worker: {
      format: 'es',
      plugins: () => (fakeSerial === undefined ? [] : [fakeSerial.worker()]),
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: SERIAL_CHUNK_NAME, test: (id: string) => chunks.isWebSerialModule(id), priority: 2 },
              { name: TRANSPORT_CHUNK_NAME, test: (id: string) => seam.isSeamModule(id), priority: 1 },
            ],
          },
          chunkFileNames: (chunk) => chunks.workerChunkFileName(chunk),
        },
      },
    },
    build: {
      outDir,
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
          wiring: 'wiring/index.html',
          notFound: '404.html',
        },
        output: {
          // Cloud-client code gets its own chunk, filed under assets/cloud/
          // only when its contents qualify (build/chunks.ts). The bundle scan
          // allows network identifiers nowhere else.
          // The build-channel seam gets a chunk of its own in every build, so
          // the bench build differs from release in that chunk only
          // (build/bench.ts). The window's port chooser (OD-3) gets its own
          // chunk too, filed under assets/serial/ only when its contents
          // qualify (build/chunks.ts).
          codeSplitting: {
            groups: [
              { name: SERIAL_CHOOSER_CHUNK_NAME, test: (id: string) => chunks.isWebSerialChooserModule(id), priority: 2 },
              { name: CLOUD_CHUNK_NAME, test: (id: string) => chunks.isCloudModule(id) },
              { name: CHANNEL_CHUNK_NAME, test: (id: string) => channel.isSeamModule(id) },
            ],
          },
          chunkFileNames: (chunk) => chunks.chunkFileName(chunk),
        },
      },
    },
  };
});
