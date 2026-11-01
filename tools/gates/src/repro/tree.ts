/**
 * Reproducible-build check (ROADMAP P0-03, RUN_PLAN §6.2).
 *
 * The `build` CI job builds the web app twice, from two clean checkouts in
 * different directories, and fails unless the two outputs are byte-identical.
 * A build that embeds a timestamp, a random value or an absolute path cannot
 * pass, so the attested artifact is exactly what the reviewed source and the
 * locked toolchain produce.
 *
 * The manifest format is that of `sha256sum` (`<hex>  <path>`), sorted by
 * path, so `sha256sum -c` can verify an extracted artifact.
 * Dependency-free (node: only).
 */
import { createHash } from 'node:crypto';
import type { TreeFile } from '../shared/files.ts';

export type TreeDigest = ReadonlyMap<string, string>;

export function digestTree(files: readonly TreeFile[]): TreeDigest {
  const digest = new Map<string, string>();
  for (const file of files) digest.set(file.path, createHash('sha256').update(file.bytes).digest('hex'));
  return digest;
}

/** `sha256sum`-compatible manifest, one line per file, sorted by path. */
export function formatManifest(digest: TreeDigest): string {
  return [...digest.keys()]
    .sort()
    .map((path) => `${digest.get(path) ?? ''}  ${path}\n`)
    .join('');
}

/** Parses a manifest written by `formatManifest`. Fails on any malformed or duplicate line. */
export function parseManifest(text: string): TreeDigest {
  const digest = new Map<string, string>();
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const [index, line] of lines.entries()) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (m?.[1] === undefined || m[2] === undefined) throw new Error(`manifest line ${index + 1} is malformed`);
    if (digest.has(m[2])) throw new Error(`manifest line ${index + 1} repeats ${m[2]}`);
    digest.set(m[2], m[1]);
  }
  if (digest.size === 0) throw new Error('the manifest is empty');
  return digest;
}

/** One digest over the whole tree: the SHA-256 of its manifest. */
export function treeHash(digest: TreeDigest): string {
  return createHash('sha256').update(formatManifest(digest)).digest('hex');
}

export interface TreeDifference {
  readonly onlyInFirst: readonly string[];
  readonly onlyInSecond: readonly string[];
  readonly changed: readonly string[];
}

export function diffTrees(first: TreeDigest, second: TreeDigest): TreeDifference {
  const onlyInFirst = [...first.keys()].filter((p) => !second.has(p)).sort();
  const onlyInSecond = [...second.keys()].filter((p) => !first.has(p)).sort();
  const changed = [...first.keys()].filter((p) => second.has(p) && second.get(p) !== first.get(p)).sort();
  return { onlyInFirst, onlyInSecond, changed };
}

export function isIdentical(diff: TreeDifference): boolean {
  return diff.onlyInFirst.length === 0 && diff.onlyInSecond.length === 0 && diff.changed.length === 0;
}
