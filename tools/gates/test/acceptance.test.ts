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

  it('gcode-view importing safety, protocol, machine or gcode fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/gcode-view/src/index.ts', "export { VERSION as S } from '../../safety/src/index.ts';\n");
    expectFailure(repo.deps(), 'layer-gcode-view');
  });

  it('an npm package or Node built-in in gcode-view fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/gcode-view/src/index.ts', "export { readFileSync } from 'node:fs';\n");
    expectFailure(repo.deps(), 'gcode-view-no-npm-or-node');
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
    // schema joined the list in the P0 review (P0-02 #2): all six SAFETY_PATH packages.
    const packages = ['protocol', 'safety', 'machine', 'flasher', 'provenance', 'schema'];
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

describe('package layering (RUN_PLAN §5.3, P0 review)', () => {
  it('protocol importing machine fails dependency-cruiser (and is a cycle)', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/protocol/src/index.ts', "export { VERSION as M } from '../../machine/src/index.ts';\n");
    const result = repo.deps();
    expectFailure(result, 'layer-protocol');
    expect(result.output).toContain('no-circular');
  });

  it('protocol importing safety fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/protocol/src/index.ts', "export { VERSION as S } from '../../safety/src/index.ts';\n");
    expectFailure(repo.deps(), 'layer-protocol');
  });

  it('safety importing machine fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/safety/src/index.ts', "export { VERSION as M } from '../../machine/src/index.ts';\n");
    expectFailure(repo.deps(), 'layer-safety');
  });

  it('the test kit importing machine or safety fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/testkit/src/index.ts', "export { VERSION as M } from '../../machine/src/index.ts';\n");
    repo.append('packages/testkit/src/marker.ts', "export { VERSION as S } from '../../safety/src/index.ts';\n");
    const result = repo.deps();
    expectFailure(result, 'layer-testkit');
    expect(result.output).toContain('packages/machine/src/index.ts');
    expect(result.output).toContain('packages/safety/src/index.ts');
  });

  it('flasher importing machine, and schema importing machine, fail dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/flasher/src/index.ts', "export { VERSION as M } from '../../machine/src/index.ts';\n");
    repo.append('packages/schema/src/index.ts', "export { VERSION as M2 } from '../../machine/src/index.ts';\n");
    const result = repo.deps();
    expectFailure(result, 'layer-flasher');
    expect(result.output).toContain('layer-schema');
  });

  it('a cycle inside one package fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/gcode/src/a.ts', "import { B } from './b.ts';\nexport const A = B;\n");
    repo.write('packages/gcode/src/b.ts', "import { A } from './a.ts';\nexport const B = 1;\nexport const C = A;\n");
    repo.append('packages/gcode/src/index.ts', "export { A } from './a.ts';\n");
    expectFailure(repo.deps(), 'no-circular');
  });

  it('the allowed edges pass: machine to protocol, safety, schema and the flasher entry', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append(
      'packages/machine/src/index.ts',
      "export { VERSION as S } from '../../safety/src/index.ts';\nexport { VERSION as SC } from '../../schema/src/index.ts';\n",
    );
    const result = repo.deps();
    expect(result.status, result.output).toBe(0);
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

});

/** A minimal stand-in for the P1-01 transport: one static read of navigator.serial. */
const TRANSPORT_STANDIN =
  'declare const navigator: { serial: { getPorts(): Promise<unknown[]>; requestPort(): Promise<unknown> } };\n' +
  'export const ports = () => navigator.serial.getPorts();\nexport const request = () => navigator.serial.requestPort();\n';

describe('P1-00: Web Serial is allowed in packages/machine/src/webSerialTransport.ts and nowhere else', () => {
  it('the transport may read navigator.serial: lint and the source check pass', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/machine/src/webSerialTransport.ts', TRANSPORT_STANDIN);
    const lint = repo.lint();
    expect(lint.status, lint.output).toBe(0);
    const deps = repo.deps();
    expect(deps.status, deps.output).toBe(0);
  });

  it.each([
    ['another machine module', 'packages/machine/src/webSerial.ts'],
    ['a file of the same name in the web app', 'apps/web/src/webSerialTransport.ts'],
    ['a file of the same name in another package', 'packages/protocol/src/webSerialTransport.ts'],
    ["the transport's own test", 'packages/machine/test/webSerialTransport.test.ts'],
  ])('the same code in %s fails lint', { timeout: TIMEOUT }, (_name, path) => {
    const repo = fresh();
    repo.write(path, TRANSPORT_STANDIN);
    expectFailure(repo.lint(), 'run/no-web-serial');
  });

  it('a computed lookup in the transport itself still fails lint and the source check', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/machine/src/webSerialTransport.ts', "export const s = (navigator as unknown as Record<string, unknown>)['ser' + 'ial'];\n");
    expectFailure(repo.lint(), 'run/no-capability-lookup');
    expectFailure(repo.deps(), 'capability-lookup');
  });

  it('navigator aliased in the transport still fails lint and the source check', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/machine/src/webSerialTransport.ts', 'const nav = navigator;\nexport const s = nav.language;\n');
    expectFailure(repo.lint(), 'run/no-capability-lookup');
    expectFailure(repo.deps(), 'capability-lookup');
  });

  it('navigator.serial elsewhere fails the source check even if lint were bypassed', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/machine/src/webSerial.ts', 'export const s = navigator.serial;\n');
    expectFailure(repo.deps(), 'capability-lookup');
  });

  it('only the transport seam and machine tests may import the transport (dependency-cruiser)', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/machine/src/webSerialTransport.ts', TRANSPORT_STANDIN);
    repo.append('packages/machine/src/index.ts', "export { ports } from './webSerialTransport.ts';\n");
    expectFailure(repo.deps(), 'web-serial-transport-importers');
  });

  it('the main thread importing the transport fails dependency-cruiser', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/machine/src/webSerialTransport.ts', TRANSPORT_STANDIN);
    repo.append('apps/web/src/shell/Shell.ts', "export { ports } from '../../../../packages/machine/src/webSerialTransport.ts';\n");
    expectFailure(repo.deps(), 'web-serial-transport-importers');
  });

  it('the transport seam may import it', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/machine/src/webSerialTransport.ts', TRANSPORT_STANDIN);
    repo.append('apps/web/src/machine-worker/transport.ts', "export { ports } from '../../../../packages/machine/src/webSerialTransport.ts';\n");
    const deps = repo.deps();
    expect(deps.status, deps.output).toBe(0);
  });
});
