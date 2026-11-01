/**
 * ROADMAP P0-02 acceptance: "A scratch-branch violation of each rule fails
 * CI ... Clean main passes." Each case copies the working tree, introduces
 * one violation and runs the real gate command with the real repository
 * configuration, asserting both a failing exit status and the rule that
 * caught it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type GateResult, ScratchRepo } from './scratch.ts';

const TIMEOUT = 120_000;
let scratch: ScratchRepo | undefined;

function fresh(): ScratchRepo {
  scratch = ScratchRepo.create();
  return scratch;
}

afterEach(() => {
  scratch?.dispose();
  scratch = undefined;
});

function expectFailure(result: GateResult, rule: string): void {
  expect(result.status, result.output).not.toBe(0);
  expect(result.status, result.output).not.toBeNull();
  expect(result.output).toContain(rule);
}

/** A clean licence report: what `pnpm licenses list --json [--prod]` returns for allowed trees. */
const CLEAN_PROD = { MIT: [{ name: 'preact', versions: ['11.0.1'] }] };
const CLEAN_ALL = {
  MIT: [
    { name: 'preact', versions: ['11.0.1'] },
    { name: 'vitest', versions: ['5.0.3'] },
  ],
  'MPL-2.0': [{ name: 'lightningcss', versions: ['1.33.0'] }],
};

describe('clean tree', () => {
  it('passes lint, dependency-cruiser and the licence gate', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    const lint = repo.lint();
    expect(lint.status, lint.output).toBe(0);
    const deps = repo.deps();
    expect(deps.status, deps.output).toBe(0);
    expect(deps.output).toContain('no dependency violations found');
    const licence = repo.licence(CLEAN_PROD, CLEAN_ALL);
    expect(licence.status, licence.output).toBe(0);
  });
});

describe('the six ROADMAP P0-02 acceptance violations', () => {
  it('an npm import in safety fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/safety/src/index.ts', "import fc from 'fast-check';\nexport const _fc = fc;\n");
    expectFailure(repo.deps(), 'safety-path-no-npm');
  });

  it('fetch in machine fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/machine/src/index.ts', "export const load = (): Promise<Response> => fetch('/api/x');\n");
    expectFailure(repo.lint(), 'run/no-network-api');
  });

  it('innerHTML in a component fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write(
      'apps/web/src/shell/Banner.tsx',
      [
        "import type { VNode } from 'preact';",
        'export function Banner(props: { html: string }): VNode {',
        '  return <div ref={(el) => { if (el) el.innerHTML = props.html; }} />;',
        '}',
        '',
      ].join('\n'),
    );
    expectFailure(repo.lint(), 'run/no-html-sink');
  });

  it('dangerouslySetInnerHTML in a component fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write(
      'apps/web/src/shell/Banner.tsx',
      [
        "import type { VNode } from 'preact';",
        'export function Banner(props: { html: string }): VNode {',
        '  return <div dangerouslySetInnerHTML={{ __html: props.html }} />;',
        '}',
        '',
      ].join('\n'),
    );
    expectFailure(repo.lint(), 'run/no-html-sink');
  });

  it('a GPL dependency fails the licence gate', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    const gpl = { name: 'copyleft-widget', versions: ['1.0.0'] };
    const result = repo.licence({ ...CLEAN_PROD, 'GPL-3.0-only': [gpl] }, { ...CLEAN_ALL, 'GPL-3.0-only': [gpl] });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('copyleft-widget@1.0.0');
  });

  it('a GPL dev dependency also fails the licence gate', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    const gpl = { name: 'copyleft-tool', versions: ['2.0.0'] };
    const result = repo.licence(CLEAN_PROD, { ...CLEAN_ALL, 'AGPL-3.0-or-later': [gpl] });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('never allowed');
  });

  it('navigator.serial in machine fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(
      'packages/machine/src/index.ts',
      'declare const navigator: { serial: { getPorts(): Promise<unknown[]> } };\nexport const ports = () => navigator.serial.getPorts();\n',
    );
    expectFailure(repo.lint(), 'run/no-web-serial');
  });

  it('an import of testkit from an entry fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(
      'apps/web/src/entries/workspace.ts',
      "import { TESTKIT_MARKER } from '../../../../packages/testkit/src/index.ts';\nexport const _m = TESTKIT_MARKER;\n",
    );
    expectFailure(repo.deps(), 'entries-never-reach-testkit');
  });
});

describe('the remaining P0-02 rules', () => {
  it('testkit reached transitively from an entry fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(
      'apps/web/src/shell/Shell.ts',
      "import { TESTKIT_MARKER } from '../../../../packages/testkit/src/index.ts';\nexport const _m = TESTKIT_MARKER;\n",
    );
    const result = repo.deps();
    expectFailure(result, 'entries-never-reach-testkit');
    expect(result.output).toContain('production-source-never-imports-testkit');
  });

  it('npm reached transitively through another workspace package fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/gcode/src/index.ts', "import fc from 'fast-check';\nexport const _fc = fc;\n");
    repo.append('packages/safety/src/index.ts', "export { VERSION as GCODE } from '../../gcode/src/index.ts';\n");
    expectFailure(repo.deps(), 'safety-path-no-npm');
  });

  it('a Node built-in in a safety-path package fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/protocol/src/index.ts', "export { readFileSync } from 'node:fs';\n");
    expectFailure(repo.deps(), 'safety-path-no-node-core');
  });

  it('a safety-path package importing contracts fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/machine/src/index.ts', "export { VERSION as C } from '../../contracts/src/index.ts';\n");
    expectFailure(repo.deps(), 'safety-path-no-contracts-or-cloud');
  });

  it('a safety-path package importing the cloud client fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/cloud/client.ts', 'export const CLOUD = 1;\n');
    repo.append('packages/provenance/src/index.ts', "export { CLOUD } from '../../../apps/web/src/cloud/client.ts';\n");
    expectFailure(repo.deps(), 'safety-path-no-contracts-or-cloud');
  });

  it('the cloud client importing machine fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/cloud/client.ts', "export { VERSION } from '../../../../packages/machine/src/index.ts';\n");
    expectFailure(repo.deps(), 'cloud-imports-only-contracts-and-provenance');
  });

  it('the cloud client importing contracts and provenance passes dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write(
      'apps/web/src/cloud/client.ts',
      "export { VERSION as A } from '../../../../packages/contracts/src/index.ts';\n" +
        "export { VERSION as B } from '../../../../packages/provenance/src/index.ts';\n",
    );
    const result = repo.deps();
    expect(result.status, result.output).toBe(0);
  });

  it('the run Worker importing safety fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('workers/run/src/index.ts', "export { VERSION as S } from '../../../packages/safety/src/index.ts';\n");
    expectFailure(repo.deps(), 'worker-imports-only-contracts');
  });

  it('an import from outside the repository fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    // The target exists, so the import resolves and only the boundary rule can catch it.
    repo.write('../outside/site.ts', 'export const SITE = 1;\n');
    repo.append('packages/wiring/src/index.ts', "export { SITE } from '../../../../outside/site.ts';\n");
    const result = repo.deps();
    expectFailure(result, 'no-import-outside-repo');
  });

  it('production source importing the dev-only gates fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/wiring/src/index.ts', "export { default as plugin } from '../../../tools/gates/src/eslint/plugin.ts';\n");
    expectFailure(repo.deps(), 'production-source-never-imports-tools');
  });

  it('Math.random in safety fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/safety/src/index.ts', 'export const jitter = (): number => Math.random();\n');
    expectFailure(repo.lint(), 'no-restricted-properties');
  });

  it('Math.random in protocol fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/protocol/src/index.ts', 'export const jitter = (): number => Math.random();\n');
    expectFailure(repo.lint(), 'no-restricted-properties');
  });

  it('a writer abort in machine fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(
      'packages/machine/src/index.ts',
      'export async function stop(w: { abort(): Promise<void> }): Promise<void> { await w.abort(); }\n',
    );
    expectFailure(repo.lint(), 'run/no-writer-abort');
  });

  it('a network identifier in each machine-path package fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    const packages = ['protocol', 'safety', 'machine', 'flasher', 'provenance'];
    for (const name of packages) {
      repo.append(`packages/${name}/src/index.ts`, "export const ws = (): unknown => new WebSocket('wss://x');\n");
    }
    const result = repo.lint();
    expectFailure(result, 'run/no-network-api');
    for (const name of packages) expect(result.output).toContain(`packages/${name}/src/index.ts`);
  });

  it('a network identifier outside the machine path passes lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/cloud/client.ts', "export const get = (): Promise<Response> => fetch('/api/health');\n");
    const result = repo.lint();
    expect(result.status, result.output).toBe(0);
  });

  it('a signal-word string outside strings.ts fails lint, and passes inside it', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    const text = `WARNING ${'—'} This software is not an emergency stop.`;
    repo.write('packages/safety/src/strings.ts', `export const W1 = (): string => '${text}';\n`);
    { const r = repo.lint(); expect(r.status, r.output).toBe(0); }
    repo.append('apps/web/src/shell/Shell.ts', `export const BAR = '${text}';\n`);
    expectFailure(repo.lint(), 'run/no-signal-word-literal');
  });

  it('innerHTML is allowed only in apps/web/src/security/tt.ts', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/security/tt.ts', 'export function set(el: Element, html: string): void { el.innerHTML = html; }\n');
    { const r = repo.lint(); expect(r.status, r.output).toBe(0); }
  });

  it('an inline eslint-disable cannot switch off a safety rule', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(
      'packages/machine/src/index.ts',
      [
        '/* eslint-disable run/no-web-serial, run/no-network-api */',
        'declare const navigator: { serial: unknown };',
        '// eslint-disable-next-line',
        'export const s = navigator.serial;',
        "export const load = (): Promise<Response> => fetch('/api/x'); // eslint-disable-line",
        '',
      ].join('\n'),
    );
    const result = repo.lint();
    expectFailure(result, 'run/no-web-serial');
    expect(result.output).toContain('run/no-network-api');
  });

  it('navigator.serial reached through an alias fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(
      'apps/web/src/shell/Shell.ts',
      'declare const navigator: { serial: { requestPort(): Promise<unknown> } };\n' +
        'const nav = navigator;\nexport const open = () => nav.serial.requestPort();\n',
    );
    expectFailure(repo.lint(), 'run/no-web-serial');
  });

  it('eval anywhere fails lint', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('apps/cli/src/index.ts', "export const x = eval('1');\n");
    expectFailure(repo.lint(), 'no-eval');
  });
});

describe('ROADMAP P0-12 rules', () => {
  it('machine source importing the bootloader capability mint fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/machine/src/index.ts', "export { mintBootloaderCapability } from '@synthetos/flasher/bootloader-capability';\n");
    expectFailure(repo.deps(), 'bootloader-capability-mint-is-flasher-only');
  });

  it('web app source importing the mint by relative path fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(
      'apps/web/src/shell/Shell.ts',
      "export { mintBootloaderCapability } from '../../../../packages/flasher/src/bootloaderCapability.ts';\n",
    );
    expectFailure(repo.deps(), 'bootloader-capability-mint-is-flasher-only');
  });

  it('the P0-02 Web Serial rule is still in force, even in the file P1-01 will exempt', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write(
      'packages/machine/src/webSerialTransport.ts',
      'declare const navigator: { serial: { getPorts(): Promise<unknown[]> } };\nexport const ports = () => navigator.serial.getPorts();\n',
    );
    expectFailure(repo.lint(), 'run/no-web-serial');
  });
});
