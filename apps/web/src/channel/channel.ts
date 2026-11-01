/**
 * THE BUILD-CHANNEL SEAM of the workspace page (P1-00; owner decision D41,
 * proposed: docs/ops/owner-decisions.md).
 *
 * This module is the one place where a build says which channel it is:
 *
 * - `release` (this file): the artifact CI builds, attests and deploys
 *   (staging now, production from Phase 6). `startBuildChannel` does nothing.
 * - `bench`: `vite build --mode bench` (apps/web/build/bench.ts) resolves
 *   every import of this module to ./bench.ts instead, into
 *   `apps/web/dist-bench/`, which only the loopback bench server serves
 *   (`pnpm bench:serve`). It is never deployed: the bundle scan refuses its
 *   marker for the staging and production targets, ci-policy refuses any
 *   workflow line that builds, scans or serves it, and the deploy jobs only
 *   deploy the attested release artifact.
 *
 * The build puts this module (or its bench replacement) in a chunk of its
 * own, `build-channel`, and `pnpm bench:check` (tools/gates/src/artifact/
 * bench.ts) proves that the bench artifact differs from the release artifact
 * in that chunk and nowhere else: the bench owner tests the release code.
 *
 * P1-05 hangs the D1 sign-in gate's localhost bench identity off the bench
 * channel, in the UI/auth layer only. Nothing in the machine path imports
 * this module (machine.worker never does).
 *
 * Both modules export exactly `BuildChannel` and `startBuildChannel` with
 * this signature (apps/web/test/channel.test.ts).
 */

/** The bench identity's shape (the same as live/authGate.ts IdentityProvider; kept here so this module imports nothing). */
export interface BenchIdentityProvider {
  readonly kind: 'bench';
  current(): Promise<{ readonly provider: 'bench'; readonly subject: string } | null>;
}

export interface BuildChannel {
  readonly kind: 'release' | 'bench';
  /** The D1 gate's localhost bench identity (D41 proposed): only the bench channel has one. */
  readonly benchIdentity: BenchIdentityProvider | null;
}

const RELEASE: BuildChannel = Object.freeze({ kind: 'release', benchIdentity: null });

/**
 * Called by the workspace entry before it hydrates the shell or starts the
 * machine worker. The release channel changes nothing.
 */
export function startBuildChannel(_doc: Document): BuildChannel {
  return RELEASE;
}
