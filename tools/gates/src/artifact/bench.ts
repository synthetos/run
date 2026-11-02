/**
 * Release artifact vs the localhost bench artifact (P1-00; D41, accepted 2026-11-02).
 *
 * The owner looks at a real TinyG through the bench build, so what the bench
 * shows must be the release code. This check takes both site trees and
 * proves that they differ only in the build-channel chunk, the way
 * diff.ts proves it for the fake-serial test build:
 *
 * - every file gets the same logical name and normalised hash as in diff.ts;
 * - `file-set`: both trees have exactly the same logical files (the Web
 *   Serial chunk included: both builds contain the same transport);
 * - `unexpected-difference`: any file other than `assets/build-channel.js`
 *   differs;
 * - `channel-missing` / `channel-unchanged`: the channel chunk must exist in
 *   both and differ (otherwise the bench build swapped nothing);
 * - `release-bench-marker`: the release tree contains the bench marker
 *   anywhere; `bench-channel-unmarked`: the bench channel chunk lacks it,
 *   so the bundle scan would not refuse the bench tree for staging or
 *   production;
 * - `bench-testkit`: the bench tree contains the test kit marker.
 *
 * Dependency-free (node: only).
 */
import type { TreeFile } from '../shared/files.ts';
import { TESTKIT_MARKER } from '../../../../packages/testkit/src/marker.ts';
import { BENCH_MARKER } from '../../../../apps/web/src/channel/benchMarker.ts';
import { CHANNEL_CHUNK_NAME } from '../../../../apps/web/build/bench.ts';
import { type HashList, hashList } from './diff.ts';

/** The one file allowed to differ. */
export const CHANNEL_CHUNK = `assets/${CHANNEL_CHUNK_NAME}.js`;

export type BenchDiffRule =
  | 'file-set'
  | 'name-collision'
  | 'unexpected-difference'
  | 'channel-missing'
  | 'channel-unchanged'
  | 'release-bench-marker'
  | 'bench-channel-unmarked'
  | 'bench-testkit';

export interface BenchDiffFinding {
  readonly rule: BenchDiffRule;
  readonly file: string;
  readonly message: string;
}

const text = (f: TreeFile): string => new TextDecoder('utf-8', { fatal: false }).decode(f.bytes);

/** Compares the release tree with the bench tree. */
export function compareBenchArtifacts(
  release: readonly TreeFile[],
  bench: readonly TreeFile[],
): { findings: BenchDiffFinding[]; release: HashList; bench: HashList } {
  const rel = hashList(release, 'release');
  const ben = hashList(bench, 'bench');
  const findings: BenchDiffFinding[] = [...rel.findings, ...ben.findings].map((f) => ({ rule: 'name-collision' as const, file: f.file, message: f.message }));
  const relBy = new Map(rel.entries.map((e) => [e.logical, e]));
  const benBy = new Map(ben.entries.map((e) => [e.logical, e]));

  for (const logical of relBy.keys()) {
    if (!benBy.has(logical)) findings.push({ rule: 'file-set', file: logical, message: `${logical} is in the release artifact but not in the bench artifact` });
  }
  for (const logical of benBy.keys()) {
    if (!relBy.has(logical)) findings.push({ rule: 'file-set', file: logical, message: `${logical} is in the bench artifact but not in the release artifact` });
  }
  for (const [logical, r] of relBy) {
    const b = benBy.get(logical);
    if (b === undefined || logical === CHANNEL_CHUNK || b.sha256 === r.sha256) continue;
    findings.push({ rule: 'unexpected-difference', file: logical, message: `${logical} differs (release ${r.file}, bench ${b.file}); only ${CHANNEL_CHUNK} may differ` });
  }

  const relChannel = relBy.get(CHANNEL_CHUNK);
  const benChannel = benBy.get(CHANNEL_CHUNK);
  if (relChannel === undefined || benChannel === undefined) {
    findings.push({ rule: 'channel-missing', file: CHANNEL_CHUNK, message: `${CHANNEL_CHUNK} must exist in both artifacts (apps/web/build/bench.ts)` });
  } else if (relChannel.sha256 === benChannel.sha256) {
    findings.push({ rule: 'channel-unchanged', file: CHANNEL_CHUNK, message: `${CHANNEL_CHUNK} is identical in both artifacts: the bench build swapped nothing` });
  }

  for (const f of release) {
    if (text(f).includes(BENCH_MARKER)) findings.push({ rule: 'release-bench-marker', file: f.path, message: `the release artifact contains the bench marker in ${f.path}` });
  }
  for (const f of bench) {
    if (text(f).includes(TESTKIT_MARKER)) findings.push({ rule: 'bench-testkit', file: f.path, message: `the bench artifact contains the test kit marker in ${f.path}` });
  }
  if (benChannel !== undefined) {
    const file = bench.find((f) => f.path === benChannel.file);
    if (file !== undefined && !text(file).includes(BENCH_MARKER)) {
      findings.push({ rule: 'bench-channel-unmarked', file: benChannel.file, message: `the bench channel chunk ${benChannel.file} lacks the bench marker, so the bundle scan would not refuse it` });
    }
  }
  return { findings, release: rel, bench: ben };
}

/** The hash list as text: one line per logical file, both hashes, and whether it differs. */
export function renderBenchHashList(release: HashList, bench: HashList): string {
  const benchBy = new Map(bench.entries.map((e) => [e.logical, e]));
  const lines = release.entries.map((r) => {
    const b = benchBy.get(r.logical);
    const state = b === undefined ? 'MISSING' : b.sha256 === r.sha256 ? 'same' : r.logical === CHANNEL_CHUNK ? 'channel' : 'DIFFERS';
    return `${state.padEnd(8)} ${r.sha256.slice(0, 16)} ${(b?.sha256 ?? '-').slice(0, 16).padEnd(16)} ${r.logical}`;
  });
  return `${'state'.padEnd(8)} ${'release'.padEnd(16)} ${'bench'.padEnd(16)} file\n${lines.join('\n')}\n`;
}
