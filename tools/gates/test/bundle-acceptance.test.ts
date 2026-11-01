/**
 * ROADMAP P0-13 acceptance on the real build (T-S40): each case copies the
 * working tree, changes one thing, builds the web app with the repository's
 * Vite config and runs the real gate CLIs.
 *
 * - "Deliberately importing testkit into an entry fails both
 *   dependency-cruiser and the scan." The import shapes cover what a
 *   minifier does to test-kit code: a bare import, a class it renames, one
 *   deep module, and the marker export itself. Each must leave the marker in
 *   the bundle (packages/testkit/src/marker.ts explains how).
 * - `transport=` handling, a URL scheme other than relative, `data:` and
 *   `blob:`, and Web Serial in an entry each fail the scan.
 *
 * The clean build passing the scan is proved in build-acceptance.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type GateResult, ScratchRepo } from './scratch.ts';

const TIMEOUT = 180_000;
const ENTRY = 'apps/web/src/entries/workspace.ts';
const KIT = '../../../../packages/testkit/src';
let scratch: ScratchRepo | undefined;

function fresh(): ScratchRepo {
  scratch = ScratchRepo.create();
  return scratch;
}

afterEach(() => {
  scratch?.dispose();
  scratch = undefined;
});

function built(repo: ScratchRepo): void {
  const result = repo.buildWeb();
  expect(result.status, result.output).toBe(0);
}

/** The scan exits 1 on findings (2 means it could not run). */
function expectScanFinding(result: GateResult, rule: string): void {
  expect(result.status, result.output).toBe(1);
  expect(result.output).toContain(rule);
}

/** dependency-cruiser exits with its error count. */
function expectDepsFailure(result: GateResult, rule: string): void {
  expect(result.status, result.output).not.toBe(0);
  expect(result.status, result.output).not.toBeNull();
  expect(result.output).toContain(rule);
}

const TESTKIT_IMPORTS: readonly (readonly [string, string])[] = [
  ['a bare import of the package entry', `\nimport '${KIT}/index.ts';\n`],
  [
    'MockSerialPort, used (the minifier renames the class)',
    `\nimport { MockSerialPort, createSim, TinyGEdgeNextModel } from '${KIT}/index.ts';\n` +
      "root.dataset['p'] = String(new MockSerialPort(createSim(new TinyGEdgeNextModel()).endpoint));\n",
  ],
  ['one deep module, used (SeededRng from rng.ts)', `\nimport { SeededRng } from '${KIT}/rng.ts';\nroot.dataset['r'] = String(new SeededRng(1).next());\n`],
  ['the marker export', `\nimport { TESTKIT_MARKER } from '${KIT}/index.ts';\nroot.dataset['m'] = TESTKIT_MARKER;\n`],
];

describe('T-S40: importing the test kit into an entry', () => {
  it.each(TESTKIT_IMPORTS)('%s fails dependency-cruiser and the bundle scan', { timeout: TIMEOUT }, (_name, code) => {
    const repo = fresh();
    repo.append(ENTRY, code);
    expectDepsFailure(repo.deps(), 'entries-never-reach-testkit');
    built(repo);
    expectScanFinding(repo.scan(), 'testkit-marker');
  });

  it('a used MockSerialPort is also reported by name', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(ENTRY, (TESTKIT_IMPORTS[1] as readonly [string, string])[1]);
    built(repo);
    expectScanFinding(repo.scan(), 'mock-serial-port');
  });
});

describe('the other P0-13 rules on the real build', () => {
  it('transport= query handling in an entry fails the scan', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(ENTRY, "\nif (new URLSearchParams(location.search).get('transport') === 'sim') root.dataset['sim'] = '1';\n");
    built(repo);
    expectScanFinding(repo.scan(), 'transport-query');
  });

  it('a mailto: URL in an entry fails the scan', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(ENTRY, "\nroot.dataset['help'] = 'mailto:help@example.org';\n");
    built(repo);
    expectScanFinding(repo.scan(), 'url-scheme');
  });

  it('a data: URL in an entry passes the scan', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(ENTRY, "\nroot.dataset['img'] = 'data:image/png;base64,iVBORw0KGgo=';\n");
    built(repo);
    const result = repo.scan();
    expect(result.status, result.output).toBe(0);
  });

  it('Web Serial in an entry fails the scan (Phase 0)', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(ENTRY, "\nroot.dataset['serial'] = String('serial' in navigator);\n");
    built(repo);
    expectScanFinding(repo.scan(), 'web-serial');
  });
});
