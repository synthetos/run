/**
 * Production artifact vs fake-serial test artifact (ROADMAP P0-14,
 * RUN_PLAN §8.5, docs/testing/fake-serial.md).
 *
 * The fake-serial suite tests a TEST build, in which the machine worker's
 * transport seam is swapped for a mock port. Its results speak for the
 * production artifact only if nothing else differs. This check takes both
 * site trees and proves it with a hash list of every file:
 *
 * - Each file gets a logical name: under `assets/`, the content hash Vite
 *   puts before the extension (`-` and 8 characters) is dropped. Text files
 *   are hashed after every hashed file name in the tree is replaced by its
 *   logical name, so a chunk that merely refers to a changed chunk is still
 *   "the same". Binary files are hashed as they are.
 * - `file-set`: both trees have exactly the same logical files.
 * - `name-collision`: two files in one tree with the same logical name
 *   (the comparison would be ambiguous), refused.
 * - `unexpected-difference`: any file other than the seam chunk
 *   `assets/machine-transport.js` differs.
 * - `seam-missing` / `seam-unchanged`: the seam chunk must exist in both and
 *   must differ (otherwise the test build did not swap anything).
 * - `production-testkit`: the production tree contains the test kit's
 *   marker anywhere. `test-seam-not-testkit`: the test seam chunk lacks it,
 *   so the bundle scan would not refuse the test build.
 * - The Web Serial transport's chunk (`assets/serial/`, P1-00): the
 *   production seam imports the transport, the test seam replaces it, so the
 *   chunk exists in production only. It is the one file the production tree
 *   may have that the test tree lacks. `test-web-serial`: the test tree has
 *   a file there; the test build must never reach a real port.
 *
 * Dependency-free (node: only), like the other build gates.
 */
import { createHash } from 'node:crypto';
import type { TreeFile } from '../shared/files.ts';
import { TESTKIT_MARKER } from '../../../../packages/testkit/src/marker.ts';
import { TRANSPORT_CHUNK_NAME } from '../../../../apps/web/build/fakeSerial.ts';
import { SERIAL_ASSET_DIR } from '../../../../apps/web/build/chunks.ts';

/** The one file allowed to differ. */
export const SEAM_CHUNK = `assets/${TRANSPORT_CHUNK_NAME}.js`;

/** File types whose content can name other files (and is normalised before hashing). */
const TEXT = /\.(js|mjs|css|html|json|webmanifest|svg|txt|xml|map)$|(^|\/)_headers$|(^|\/)LICENSE[^/]*$/;

/** Vite's `[name]-[hash].ext` under assets/: the hash is 8 base64url characters. */
const HASHED = /^(assets\/(?:.*\/)?[^/]+)-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)$/;

export type DiffRule =
  | 'file-set'
  | 'name-collision'
  | 'unexpected-difference'
  | 'seam-missing'
  | 'seam-unchanged'
  | 'production-testkit'
  | 'test-seam-not-testkit'
  | 'test-web-serial';

export interface DiffFinding {
  readonly rule: DiffRule;
  readonly file: string;
  readonly message: string;
}

export interface HashEntry {
  /** The path with any content hash removed. */
  readonly logical: string;
  /** The path as built. */
  readonly file: string;
  /** sha256 of the normalised content, hex. */
  readonly sha256: string;
}

export interface HashList {
  readonly entries: readonly HashEntry[];
  readonly findings: readonly DiffFinding[];
}

/** The logical name of a built file. */
export function logicalName(path: string): string {
  const m = HASHED.exec(path);
  return m === null ? path : `${m[1] ?? ''}${m[2] ?? ''}`;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The hash list of one tree. `label` names the tree in findings. */
export function hashList(files: readonly TreeFile[], label: string): HashList {
  const findings: DiffFinding[] = [];
  // Every hashed basename in the tree, longest first, so no name is replaced inside a longer one.
  const renames = files
    .filter((f) => logicalName(f.path) !== f.path)
    .map((f) => [basename(f.path), basename(logicalName(f.path))] as const)
    .sort((a, b) => b[0].length - a[0].length);
  const seen = new Map<string, string>();
  const entries: HashEntry[] = [];
  for (const f of files) {
    const logical = logicalName(f.path);
    const other = seen.get(logical);
    if (other !== undefined) {
      findings.push({ rule: 'name-collision', file: f.path, message: `${label}: ${f.path} and ${other} share the logical name ${logical}` });
      continue;
    }
    seen.set(logical, f.path);
    let content: Uint8Array = f.bytes;
    if (TEXT.test(f.path)) {
      let text = new TextDecoder('utf-8', { fatal: false }).decode(f.bytes);
      for (const [from, to] of renames) text = text.split(from).join(to);
      content = new TextEncoder().encode(text);
    }
    entries.push({ logical, file: f.path, sha256: createHash('sha256').update(content).digest('hex') });
  }
  entries.sort((a, b) => (a.logical < b.logical ? -1 : a.logical > b.logical ? 1 : 0));
  return { entries, findings };
}

function containsMarker(file: TreeFile): boolean {
  return new TextDecoder('utf-8', { fatal: false }).decode(file.bytes).includes(TESTKIT_MARKER);
}

/** Compares the production tree with the fake-serial test tree. */
export function compareArtifacts(production: readonly TreeFile[], test: readonly TreeFile[]): { findings: DiffFinding[]; production: HashList; test: HashList } {
  const prod = hashList(production, 'production');
  const fake = hashList(test, 'test');
  const findings: DiffFinding[] = [...prod.findings, ...fake.findings];
  const prodBy = new Map(prod.entries.map((e) => [e.logical, e]));
  const fakeBy = new Map(fake.entries.map((e) => [e.logical, e]));

  for (const logical of prodBy.keys()) {
    if (fakeBy.has(logical) || logical.startsWith(SERIAL_ASSET_DIR)) continue;
    findings.push({ rule: 'file-set', file: logical, message: `${logical} is in the production artifact but not in the test artifact` });
  }
  for (const logical of fakeBy.keys()) {
    if (logical.startsWith(SERIAL_ASSET_DIR)) {
      findings.push({ rule: 'test-web-serial', file: logical, message: `${logical}: the test artifact holds the Web Serial transport's chunk; it must never reach a real port` });
    } else if (!prodBy.has(logical)) {
      findings.push({ rule: 'file-set', file: logical, message: `${logical} is in the test artifact but not in the production artifact` });
    }
  }
  for (const [logical, p] of prodBy) {
    const t = fakeBy.get(logical);
    if (t === undefined || logical === SEAM_CHUNK || t.sha256 === p.sha256) continue;
    findings.push({
      rule: 'unexpected-difference',
      file: logical,
      message: `${logical} differs (production ${p.file}, test ${t.file}); only ${SEAM_CHUNK} may differ`,
    });
  }

  const prodSeam = prodBy.get(SEAM_CHUNK);
  const fakeSeam = fakeBy.get(SEAM_CHUNK);
  if (prodSeam === undefined || fakeSeam === undefined) {
    findings.push({ rule: 'seam-missing', file: SEAM_CHUNK, message: `${SEAM_CHUNK} must exist in both artifacts (apps/web/build/fakeSerial.ts)` });
  } else if (prodSeam.sha256 === fakeSeam.sha256) {
    findings.push({ rule: 'seam-unchanged', file: SEAM_CHUNK, message: `${SEAM_CHUNK} is identical in both artifacts: the test build swapped nothing` });
  }

  for (const f of production) {
    if (containsMarker(f)) findings.push({ rule: 'production-testkit', file: f.path, message: `the production artifact contains the test kit marker in ${f.path}` });
  }
  if (fakeSeam !== undefined) {
    const file = test.find((f) => f.path === fakeSeam.file);
    if (file !== undefined && !containsMarker(file)) {
      findings.push({ rule: 'test-seam-not-testkit', file: fakeSeam.file, message: `the test seam chunk ${fakeSeam.file} lacks the test kit marker, so the bundle scan would not refuse it` });
    }
  }
  return { findings, production: prod, test: fake };
}

/** The hash list as text: one line per logical file, both hashes, and whether it differs. */
export function renderHashList(production: HashList, test: HashList): string {
  const testBy = new Map(test.entries.map((e) => [e.logical, e]));
  const lines = production.entries.map((p) => {
    const t = testBy.get(p.logical);
    const state =
      t === undefined ? (p.logical.startsWith(SERIAL_ASSET_DIR) ? 'serial' : 'MISSING') : t.sha256 === p.sha256 ? 'same' : p.logical === SEAM_CHUNK ? 'seam' : 'DIFFERS';
    return `${state.padEnd(8)} ${p.sha256.slice(0, 16)} ${(t?.sha256 ?? '-').slice(0, 16).padEnd(16)} ${p.logical}`;
  });
  return `${'state'.padEnd(8)} ${'production'.padEnd(16)} ${'test'.padEnd(16)} file\n${lines.join('\n')}\n`;
}
