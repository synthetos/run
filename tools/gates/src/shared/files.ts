/**
 * Reads a directory tree for the build gates. Dependency-free (node: only).
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TreeFile {
  /** Path relative to the root, with forward slashes. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/**
 * Every regular file under `root`, sorted by path. Symbolic links and other
 * special files are refused: a build output never needs them, and following
 * one could pull in content from outside the tree.
 */
export function readTree(root: string): TreeFile[] {
  const out: TreeFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix === '' ? name : `${prefix}/${name}`;
      const stat = lstatSync(full);
      if (stat.isDirectory()) walk(full, rel);
      else if (stat.isFile()) out.push({ path: rel, bytes: readFileSync(full) });
      else throw new Error(`${rel}: not a regular file or directory (symbolic links are refused)`);
    }
  };
  walk(root, '');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
