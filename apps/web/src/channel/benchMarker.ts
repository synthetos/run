/**
 * The bench build's marker (P1-00). Only ./bench.ts imports it
 * (dependency-cruiser `bench-channel-only-through-the-build`), and bench.ts
 * writes it into the page, so a minifier cannot drop it. The bundle scan
 * refuses this text for the staging and production targets and requires it
 * for the bench target (tools/gates/src/bundle/scan.ts).
 *
 * Dependency-free: the secret-free build job's scan imports it.
 */
export const BENCH_MARKER = 'synthetos-run-bench-build-localhost-only';
