/**
 * The localhost BENCH build (P1-00; owner decision D41, accepted 2026-11-02:
 * docs/ops/owner-decisions.md).
 *
 * `vite build --mode bench` writes `dist-bench/` (never `dist/`, which is
 * what CI attests and deploys). In that build, and only there, every import
 * of the build-channel seam (src/channel/channel.ts) resolves to
 * src/channel/bench.ts instead. In BOTH builds the seam (or its bench
 * replacement) is a chunk of its own, `build-channel`, so the swap changes
 * that chunk and nothing else: tools/gates/src/artifact/bench.ts checks it on
 * the real outputs (`pnpm bench:check`). The bench replacement carries the
 * bench marker, which the bundle scan refuses for the staging and production
 * targets, so a bench artifact can never pass for a deployable one.
 *
 * The bench build fails if the swap never happened, so a renamed seam can
 * never yield a "bench" artifact that is really the release build.
 *
 * Served only by the loopback bench server (tools/gates/src/bench), with
 * `serial=(self)`. Nothing deploys it (ci-policy `bench-never-in-ci`).
 *
 * A change to this file needs safety-path review (CODEOWNERS).
 */
import { resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/** `vite build --mode <this>` builds the bench artifact. */
export const BENCH_MODE = 'bench';

/** Where the bench artifact goes, relative to apps/web. Never `dist`. */
export const BENCH_OUT_DIR = 'dist-bench';

/** The chunk that holds the build-channel seam (release) or its bench replacement. */
export const CHANNEL_CHUNK_NAME = 'build-channel';

function slashes(id: string): string {
  return id.split(sep).join('/');
}

export interface ChannelSeam {
  /** The release seam module. */
  readonly release: string;
  /** Its bench replacement. */
  readonly bench: string;
  /** True for the two modules that root the `build-channel` chunk. */
  isSeamModule(id: string): boolean;
}

/** The seam for the web app rooted at `webRoot` (the directory holding vite.config.ts). */
export function channelSeam(webRoot: string): ChannelSeam {
  const release = slashes(resolve(webRoot, 'src/channel/channel.ts'));
  const bench = slashes(resolve(webRoot, 'src/channel/bench.ts'));
  return {
    release,
    bench,
    isSeamModule: (id) => {
      const path = slashes(id);
      return path === release || path === bench;
    },
  };
}

/**
 * The swap, for the page build. It redirects the seam to its replacement
 * after normal resolution (so every spelling of the import is caught), and
 * fails the build at its end if nothing was swapped.
 */
export function benchPlugin(seam: ChannelSeam): Plugin {
  const state = { swapped: 0 };
  return {
    name: 'run:bench-channel',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (importer === undefined) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved === null || slashes(resolved.id) !== seam.release) return null;
      state.swapped += 1;
      return seam.bench;
    },
    buildEnd(error) {
      if (error === undefined && state.swapped === 0) {
        this.error(`bench: nothing imported the build-channel seam ${seam.release}; the bench build would be the release build`);
      }
    },
  };
}
