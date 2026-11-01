/**
 * ROADMAP P0-14: the production artifact and the fake-serial test artifact
 * may differ only in the transport seam chunk (src/artifact/diff.ts). Each
 * rule is shown to fire on a synthetic pair of trees; the real builds are
 * compared in fake-serial-acceptance.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { SEAM_CHUNK, compareArtifacts, hashList, logicalName, renderHashList } from '../src/artifact/diff.ts';
import type { TreeFile } from '../src/shared/files.ts';
import { TESTKIT_MARKER } from '../../../packages/testkit/src/marker.ts';

const enc = new TextEncoder();
const file = (path: string, text: string): TreeFile => ({ path, bytes: enc.encode(text) });

/** A production-shaped tree: page → workspace chunk → worker chunk → seam chunk. */
function tree(opts: { seamHash: string; workerHash: string; seam: string; extra?: TreeFile[]; worker?: string }): TreeFile[] {
  return [
    file('index.html', `<script type="module" src="/assets/workspace-AAAAAAAA.js"></script>`),
    file('assets/workspace-AAAAAAAA.js', `new Worker("/assets/machine.worker-${opts.workerHash}.js")`),
    file(`assets/machine.worker-${opts.workerHash}.js`, opts.worker ?? `import{t as e}from"./machine-transport-${opts.seamHash}.js";e();`),
    file(`assets/machine-transport-${opts.seamHash}.js`, opts.seam),
    { path: 'assets/font-BBBBBBBB.woff2', bytes: new Uint8Array([0, 1, 2, 255]) },
    ...(opts.extra ?? []),
  ];
}

const PROD = tree({ seamHash: 'Prod0001', workerHash: 'WorkP001', seam: 'function e(){return null}export{e as t};' });
const TEST = tree({ seamHash: 'Test0001', workerHash: 'WorkT001', seam: `globalThis["${TESTKIT_MARKER}"];function e(){return 1}export{e as t};` });

const rules = (prod: TreeFile[], test: TreeFile[]): string[] => compareArtifacts(prod, test).findings.map((f) => `${f.rule} ${f.file}`);

describe('logicalName', () => {
  it('drops the 8-character content hash under assets/ only', () => {
    expect(logicalName('assets/machine.worker-CwLJKZex.js')).toBe('assets/machine.worker.js');
    expect(logicalName('assets/IBMPlexSans-Medium-Latin1-B2CuUu4P.woff2')).toBe('assets/IBMPlexSans-Medium-Latin1.woff2');
    expect(logicalName('assets/cloud/sync-Ab_-1234.js')).toBe('assets/cloud/sync.js');
    expect(logicalName('icons/icon-192.png')).toBe('icons/icon-192.png');
    expect(logicalName('assets/short-abc.js')).toBe('assets/short-abc.js');
  });
});

describe('compareArtifacts', () => {
  it('passes when only the seam chunk differs, even though every hashed name changed', () => {
    expect(rules(PROD, TEST)).toEqual([]);
  });

  it('normalises references, so a renamed chunk alone does not count as a difference', () => {
    const p = hashList(PROD, 'p').entries.find((e) => e.logical === 'assets/machine.worker.js');
    const t = hashList(TEST, 't').entries.find((e) => e.logical === 'assets/machine.worker.js');
    expect(p?.sha256).toBe(t?.sha256);
  });

  it('refuses a difference in any other chunk (unexpected-difference)', () => {
    const test = tree({ seamHash: 'Test0001', workerHash: 'WorkT001', seam: `${TESTKIT_MARKER}`, worker: 'import"./machine-transport-Test0001.js";globalThis.extra=1;' });
    expect(rules(PROD, test)).toEqual(['unexpected-difference assets/machine.worker.js']);
  });

  it('refuses a difference in a binary file', () => {
    const test = TEST.map((f) => (f.path.endsWith('.woff2') ? { path: f.path, bytes: new Uint8Array([9]) } : f));
    expect(rules(PROD, test)).toEqual(['unexpected-difference assets/font.woff2']);
  });

  it('refuses a file present in only one artifact (file-set)', () => {
    expect(rules(PROD, [...TEST, file('assets/extra-CCCCCCCC.js', 'x')])).toEqual(['file-set assets/extra.js']);
    expect(rules([...PROD, file('robots.txt', 'x')], TEST)).toEqual(['file-set robots.txt']);
  });

  it('refuses two files with one logical name (name-collision)', () => {
    const prod = [...PROD, file('assets/workspace-ZZZZZZZZ.js', 'other')];
    expect(rules(prod, TEST)).toContain('name-collision assets/workspace-ZZZZZZZZ.js');
  });

  it('refuses a test build that swapped nothing (seam-unchanged)', () => {
    const test = tree({ seamHash: 'Test0001', workerHash: 'WorkT001', seam: 'function e(){return null}export{e as t};' });
    expect(rules(PROD, test)).toEqual(['seam-unchanged assets/machine-transport.js', 'test-seam-not-testkit assets/machine-transport-Test0001.js']);
  });

  it('refuses artifacts without the seam chunk (seam-missing)', () => {
    const noSeam = (t: TreeFile[]): TreeFile[] =>
      t.filter((f) => !f.path.includes('machine-transport')).map((f) => (f.path.includes('machine.worker') ? file(f.path, 'self.x=1') : f));
    expect(rules(noSeam(PROD), noSeam(TEST))).toEqual([`seam-missing ${SEAM_CHUNK}`]);
  });

  it('refuses a production artifact that carries the test kit marker (production-testkit)', () => {
    const prod = PROD.map((f) => (f.path === 'index.html' ? file(f.path, `${TESTKIT_MARKER}`) : f));
    const test = TEST.map((f) => (f.path === 'index.html' ? file(f.path, `${TESTKIT_MARKER}`) : f));
    expect(rules(prod, test)).toEqual(['production-testkit index.html']);
  });

  it('refuses a test seam chunk the bundle scan would not catch (test-seam-not-testkit)', () => {
    const test = tree({ seamHash: 'Test0001', workerHash: 'WorkT001', seam: 'function e(){return 1}export{e as t};' });
    expect(rules(PROD, test)).toEqual(['test-seam-not-testkit assets/machine-transport-Test0001.js']);
  });
});

describe('renderHashList', () => {
  it('lists every logical file with its state', () => {
    const r = compareArtifacts(PROD, [...TEST.filter((f) => !f.path.endsWith('.woff2'))]);
    const text = renderHashList(r.production, r.test);
    expect(text).toMatch(/^seam +\w{16} \w{16} assets\/machine-transport\.js$/m);
    expect(text).toMatch(/^same +\w{16} \w{16} assets\/machine\.worker\.js$/m);
    expect(text).toMatch(/^MISSING +\w{16} - +assets\/font\.woff2$/m);
    const changed = compareArtifacts(PROD, TEST.map((f) => (f.path === 'index.html' ? file(f.path, 'changed') : f)));
    expect(renderHashList(changed.production, changed.test)).toMatch(/^DIFFERS +\w{16} \w{16} index\.html$/m);
  });
});
