/**
 * The fake-serial TEST build (ROADMAP P0-14, RUN_PLAN §8.5,
 * docs/testing/fake-serial.md).
 *
 * The P0-14 spike found that a Playwright init script does not run inside a
 * dedicated worker, so the end-to-end suite cannot give `machine.worker` a
 * fake port from outside. The fallback is a test-only build:
 *
 * - `vite build --mode fake-serial` writes `dist-fake-serial/` (never
 *   `dist/`, which is what CI attests and deploys);
 * - in that build, and only there, every import of the transport seam
 *   (src/machine-worker/transport.ts) resolves to
 *   tools/e2e/fake-serial/transport.ts instead, a `MockTransport` over the
 *   test kit's `MockSerialPort`;
 * - in BOTH builds the seam (or its replacement, with everything only it
 *   imports) is a chunk of its own, `machine-transport`, so the swap changes
 *   that chunk and nothing else. tools/gates/src/artifact/diff.ts checks it
 *   on the real outputs, and the test kit's marker in the replacement makes
 *   the bundle scan refuse the test build, so it can never pass for a
 *   production artifact.
 *
 * The test build fails if the swap never happened, so a renamed seam can
 * never yield a "test" artifact that silently runs production code.
 *
 * A change to this file changes what the e2e suite tests and needs
 * safety-path review (CODEOWNERS).
 */
import { resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/** `vite build --mode <this>` builds the test artifact. */
export const FAKE_SERIAL_MODE = 'fake-serial';

/** Where the test artifact goes, relative to apps/web. Never `dist`. */
export const FAKE_SERIAL_OUT_DIR = 'dist-fake-serial';

/** The chunk that holds the transport seam (production) or its replacement (test). */
export const TRANSPORT_CHUNK_NAME = 'machine-transport';

/** Build modes `vite build` accepts. */
export const BUILD_MODES: readonly string[] = ['production', FAKE_SERIAL_MODE];

function slashes(id: string): string {
  return id.split(sep).join('/');
}

export interface TransportSeam {
  /** The production seam module. */
  readonly production: string;
  /** Its test-build replacement. */
  readonly fake: string;
  /** True for the two modules that root the `machine-transport` chunk. */
  isSeamModule(id: string): boolean;
}

/** The seam for the web app rooted at `webRoot` (the directory holding vite.config.ts). */
export function transportSeam(webRoot: string): TransportSeam {
  const production = slashes(resolve(webRoot, 'src/machine-worker/transport.ts'));
  const fake = slashes(resolve(webRoot, '../../tools/e2e/fake-serial/transport.ts'));
  return {
    production,
    fake,
    isSeamModule: (id) => {
      const path = slashes(id);
      return path === production || path === fake;
    },
  };
}

/** Refuses `vite build` in any mode but production and fake-serial. */
export function assertBuildMode(command: string, mode: string): void {
  if (command === 'build' && !BUILD_MODES.includes(mode)) {
    throw new Error(`refusing to build in mode ${JSON.stringify(mode)}: only ${BUILD_MODES.map((m) => JSON.stringify(m)).join(' and ')}`);
  }
}

/** The plugins of the test build: one for the main build, a factory for each worker build. */
export interface FakeSerialPlugins {
  readonly main: Plugin;
  worker(): Plugin;
}

/**
 * The swap. The worker plugin redirects the seam to its replacement after
 * normal resolution (so every spelling of the import is caught); the main
 * plugin fails the build at its end if no worker build ever swapped it.
 * Vite bundles workers while it transforms the main build, so the worker
 * builds have finished by then.
 */
export function fakeSerialPlugins(seam: TransportSeam): FakeSerialPlugins {
  const state = { swapped: 0 };
  return {
    main: {
      name: 'run:fake-serial-check',
      buildEnd(error) {
        if (error === undefined && state.swapped === 0) {
          this.error(`fake-serial: no worker imported the transport seam ${seam.production}; the test build would run production code`);
        }
      },
    },
    worker: () => ({
      name: 'run:fake-serial-swap',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (importer === undefined) return null;
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (resolved === null || slashes(resolved.id) !== seam.production) return null;
        state.swapped += 1;
        return seam.fake;
      },
    }),
  };
}
