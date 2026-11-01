/**
 * The BENCH replacement for the build-channel seam (P1-00, D41 proposed).
 * BENCH BUILD ONLY: `vite build --mode bench` resolves every import of
 * ./channel.ts to this file (apps/web/build/bench.ts). Nothing imports it
 * directly (dependency-cruiser `bench-channel-only-through-the-build`).
 *
 * The bench build runs on the owner's computer, served by the loopback bench
 * server with `Permissions-Policy: serial=(self)`. `startBuildChannel`
 * refuses any other host before the machine worker starts (the entry calls
 * it right after hydration), so a copy of dist-bench served from anywhere
 * else never starts the machine worker.
 * On loopback it marks the page as the bench build, visibly.
 */
import { BENCH_MARKER } from './benchMarker.ts';
import type { BuildChannel } from './channel.ts';

export type { BuildChannel };

/** The only hosts the bench build runs on (the bench server binds 127.0.0.1; browsers resolve localhost to loopback). */
export const BENCH_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/** The text added to the version chip. */
export const BENCH_LABEL = 'bench build, localhost only';

export class BenchHostError extends Error {
  override readonly name = 'BenchHostError';
}

/** The bench identity's subject: whoever sits at this computer (D41 proposed). */
export const BENCH_SUBJECT = 'bench operator (localhost)';

/**
 * The D1 gate's bench identity. It re-checks the host on every request, so
 * it can only ever say "signed in" on loopback over plain HTTP.
 */
function benchIdentityFor(doc: Document): BuildChannel['benchIdentity'] {
  return Object.freeze({
    kind: 'bench' as const,
    current() {
      const onLoopback = BENCH_HOSTS.includes(doc.location.hostname) && doc.location.protocol === 'http:';
      return Promise.resolve(onLoopback ? { provider: 'bench' as const, subject: BENCH_SUBJECT } : null);
    },
  });
}

/** Throws on any host but loopback; otherwise marks the page and the version chip. */
export function startBuildChannel(doc: Document): BuildChannel {
  const host = doc.location.hostname;
  if (!BENCH_HOSTS.includes(host) || doc.location.protocol !== 'http:') {
    throw new BenchHostError(`the bench build runs only on localhost over plain HTTP (the loopback bench server), not on ${host}`);
  }
  doc.documentElement.dataset['channel'] = 'bench';
  doc.documentElement.dataset['buildMarker'] = BENCH_MARKER;
  const chip = doc.querySelector('[data-version]');
  if (chip !== null) {
    chip.setAttribute('data-channel', 'bench');
    chip.textContent = `${chip.textContent ?? ''} · ${BENCH_LABEL}`;
  }
  doc.title = `[bench] ${doc.title}`;
  return Object.freeze({ kind: 'bench', benchIdentity: benchIdentityFor(doc) });
}
