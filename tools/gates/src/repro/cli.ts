/**
 * Reproducible-build CLI (ROADMAP P0-03).
 *
 *   node tools/gates/src/repro/cli.ts compare <distA> <distB>
 *   node tools/gates/src/repro/cli.ts manifest <dist> <out-file>
 *   node tools/gates/src/repro/cli.ts verify <dir> <manifest-file>
 *
 * `compare` exits 1 unless both trees hold the same paths with the same
 * bytes. `manifest` writes a `sha256sum`-compatible manifest. `verify` exits
 * 1 unless the tree matches the manifest exactly (no file missing, changed
 * or added), which is how CI checks an extracted artifact. Exit status 2
 * means the command could not run (a missing or empty tree never passes).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readTree } from '../shared/files.ts';
import { diffTrees, digestTree, formatManifest, isIdentical, parseManifest, treeHash } from './tree.ts';

function load(dir: string): ReturnType<typeof digestTree> {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const digest = digestTree(readTree(dir));
  if (digest.size === 0) throw new Error(`${dir} is empty`);
  return digest;
}

function main(argv: readonly string[]): number {
  const [command, first, second] = argv;
  try {
    if (command === 'compare' && first !== undefined && second !== undefined && argv.length === 3) {
      const a = load(first);
      const b = load(second);
      const diff = diffTrees(a, b);
      if (!isIdentical(diff)) {
        process.stderr.write('reproducible build: the two builds differ\n');
        for (const p of diff.changed) process.stderr.write(`  changed       ${p}\n`);
        for (const p of diff.onlyInFirst) process.stderr.write(`  only in first ${p}\n`);
        for (const p of diff.onlyInSecond) process.stderr.write(`  only in second ${p}\n`);
        return 1;
      }
      process.stdout.write(`reproducible build: ${a.size} files identical, tree sha256 ${treeHash(a)}\n`);
      return 0;
    }
    if (command === 'manifest' && first !== undefined && second !== undefined && argv.length === 3) {
      const digest = load(first);
      writeFileSync(second, formatManifest(digest));
      process.stdout.write(`manifest: ${digest.size} files, tree sha256 ${treeHash(digest)}\n`);
      return 0;
    }
    if (command === 'verify' && first !== undefined && second !== undefined && argv.length === 3) {
      const actual = load(first);
      const expected = parseManifest(readFileSync(second, 'utf8'));
      const diff = diffTrees(expected, actual);
      if (!isIdentical(diff)) {
        process.stderr.write(`artifact: ${first} does not match ${second}\n`);
        for (const p of diff.changed) process.stderr.write(`  changed     ${p}\n`);
        for (const p of diff.onlyInFirst) process.stderr.write(`  missing     ${p}\n`);
        for (const p of diff.onlyInSecond) process.stderr.write(`  unexpected  ${p}\n`);
        return 1;
      }
      process.stdout.write(`artifact: ${actual.size} files match the manifest, tree sha256 ${treeHash(actual)}\n`);
      return 0;
    }
    process.stderr.write('usage: repro/cli.ts verify <dir> <manifest-file> | compare <distA> <distB> | manifest <dist> <out-file>\n');
    return 2;
  } catch (error) {
    process.stderr.write(`reproducible build: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
