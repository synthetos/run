/**
 * P0 review fix pass on the source gates (findings P0-02 #1 and #2, P0-13,
 * P0-14). Each case copies the working tree, adds the reviewer's own
 * reproduction files (verbatim where the finding gave them) and runs the real
 * gate command with the real repository configuration: `pnpm lint` and
 * `pnpm deps` (dependency-cruiser followed by the source capability check,
 * tools/gates/src/source/cli.ts). The built-output side of the same
 * reproductions is in bundle-acceptance.test.ts.
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

function expectPass(result: GateResult): void {
  expect(result.status, result.output).toBe(0);
}

/** The reviewer's computed Web Serial probe (Batch 15 #1), verbatim. */
const COMPUTED_SERIAL_PROBE =
  "const s = Reflect.get(navigator, ['ser', 'ial'].join(''));\n" + "void Reflect.apply(Reflect.get(s, ['get', 'Ports'].join('')), s, []);\n";

/** The reviewer's caller-selected dynamic import (Batch 15 #2), verbatim. */
const DYNAMIC_IMPORT_PROBE = 'export async function loadModule(path: string): Promise<unknown> {\n  return import(/* @vite-ignore */ path);\n}\n';

describe('P0-02 #1: the cloud client cannot reach the machine path transitively', () => {
  it('cloud -> a web-app helper -> machine fails dependency-cruiser (the reviewer files)', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/cloud/reviewLayer.ts', "export { VERSION } from '../helpers/reviewController.ts';\n");
    repo.write('apps/web/src/helpers/reviewController.ts', "export { VERSION } from '../../../../packages/machine/src/reviewLeaf.ts';\n");
    repo.write('packages/machine/src/reviewLeaf.ts', "export const VERSION = 'review';\n");
    const result = repo.deps();
    expectFailure(result, 'cloud-never-reaches-machine-path');
    expect(result.output).toContain('cloud-imports-only-contracts-and-provenance');
  });

  it('a longer chain, through cloud-internal modules and two helpers, still fails', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/cloud/client.ts', "export { LEAF } from './inner/session.ts';\n");
    repo.write('apps/web/src/cloud/inner/session.ts', "export { LEAF } from '../../loaders/jobLoader.ts';\n");
    repo.write('apps/web/src/loaders/jobLoader.ts', "export { LEAF } from '../shell/bridge.ts';\n");
    repo.write('apps/web/src/shell/bridge.ts', "export { VERSION as LEAF } from '../../../../packages/flasher/src/index.ts';\n");
    const result = repo.deps();
    expectFailure(result, 'cloud-never-reaches-machine-path');
    expect(result.output).toContain('apps/web/src/cloud/client.ts');
  });

  it('cloud reaching machine through a workspace link (@synthetos/machine) via a helper fails', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/cloud/client.ts', "export { L } from '../helpers/h.ts';\n");
    repo.write('apps/web/src/helpers/h.ts', "export { VERSION as L } from '@synthetos/machine';\n");
    expectFailure(repo.deps(), 'cloud-never-reaches-machine-path');
  });

  it('the provenance exception holds: cloud -> provenance -> safety -> protocol passes, as do cloud-internal modules', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('packages/provenance/src/index.ts', "export { VERSION as SAFETY_VERSION } from '../../safety/src/index.ts';\n");
    repo.write(
      'apps/web/src/cloud/client.ts',
      "export { VERSION as A } from '../../../../packages/contracts/src/index.ts';\n" +
        "export { SAFETY_VERSION as B } from '../../../../packages/provenance/src/index.ts';\n" +
        "export { C } from './inner/c.ts';\n",
    );
    repo.write('apps/web/src/cloud/inner/c.ts', "export { VERSION as C } from '../../../../../packages/contracts/src/index.ts';\n");
    expectPass(repo.deps());
  });
});

describe('P0-02 #2: schema is in the no-network lint scope', () => {
  it('machine -> a schema helper that calls fetch fails lint (the reviewer files)', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/schema/src/reviewNetwork.ts', "export const load = (): Promise<Response> => fetch('/api/control');\n");
    repo.write('packages/machine/src/reviewNetwork.ts', "export { load } from '../../schema/src/reviewNetwork.ts';\n");
    const result = repo.lint();
    expectFailure(result, 'run/no-network-api');
    expect(result.output).toContain('packages/schema/src/reviewNetwork.ts');
  });
});

describe('P0-13: computed or reflective capability access fails every source gate', () => {
  it('the reviewer probe in the web app fails lint and pnpm deps', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/reviewProbe.ts', COMPUTED_SERIAL_PROBE);
    const lint = repo.lint();
    expectFailure(lint, 'run/no-capability-lookup');
    expect(lint.output).toContain('apps/web/src/reviewProbe.ts');
    const deps = repo.deps();
    expectFailure(deps, 'capability-lookup');
    expect(deps.output).toContain('apps/web/src/reviewProbe.ts');
  });

  it.each([
    ['a string-built navigator member', "export const s = navigator['ser' + 'ial'];\n"],
    ['a string-built global lookup of navigator', "export const n = (globalThis as Record<string, unknown>)['navi' + 'gator'];\n"],
    ['navigator aliased into a variable', 'const n = navigator;\nexport const k = Object.keys(n);\n'],
    ['the navigator name as a string', "export const n = Reflect.get(globalThis, 'navigator');\n"],
    ['a window alias passed as a value', 'const g = globalThis as unknown as Record<string, unknown>;\nexport const pick = (k: string): unknown => g[k];\n'],
    ['a defaultView reached from the document', "export const w = (k: string): unknown => (document.defaultView as unknown as Record<string, unknown>)[k];\n"],
    ['a locally declared navigator (ambient declarations do not shadow the global)', 'declare const navigator: Record<string, unknown>;\nexport const n = (k: string): unknown => navigator[k];\n'],
    ['Chrome clientInformation', "export const c = (k: string): unknown => (clientInformation as unknown as Record<string, unknown>)[k];\n"],
  ])('%s fails lint and pnpm deps', { timeout: TIMEOUT }, (_name, code) => {
    const repo = fresh();
    repo.write('packages/machine/src/reviewCapability.ts', code);
    expectFailure(repo.lint(), 'run/no-capability-lookup');
    expectFailure(repo.deps(), 'capability-lookup');
  });

  it('the static, reviewed forms the app uses still pass both gates', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write(
      'apps/web/src/reviewAllowed.ts',
      'export const lang = (): string => navigator.language;\n' +
        'export const origin = (): string => globalThis.location.origin;\n' +
        "export const hasTT = (): boolean => typeof window !== 'undefined' && 'trustedTypes' in globalThis;\n" +
        "export const tt = (): unknown => (globalThis as { trustedTypes?: unknown })['trustedTypes'];\n" +
        'export const local = (): number => { const top = 1; const parent = 2; return top + parent; };\n',
    );
    expectPass(repo.lint());
    expectPass(repo.deps());
  });
});

describe('P0-14: a non-static dynamic import fails every source gate', () => {
  it('the reviewer loader in machine fails lint and pnpm deps', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/machine/src/reviewImport.ts', DYNAMIC_IMPORT_PROBE);
    const lint = repo.lint();
    expectFailure(lint, 'run/no-dynamic-import');
    expect(lint.output).toContain('packages/machine/src/reviewImport.ts');
    const deps = repo.deps();
    expectFailure(deps, 'dynamic-import');
    expect(deps.output).toContain('packages/machine/src/reviewImport.ts');
  });

  it.each([
    ['a template with a substitution', 'export const load = (n: string): Promise<unknown> => import(`./${n}.ts`);\n'],
    ['a concatenation', "export const load = (n: string): Promise<unknown> => import('./' + n);\n"],
  ])('%s in the web app fails lint and pnpm deps', { timeout: TIMEOUT }, (_name, code) => {
    const repo = fresh();
    repo.write('apps/web/src/reviewImport.ts', code);
    expectFailure(repo.lint(), 'run/no-dynamic-import');
    expectFailure(repo.deps(), 'dynamic-import');
  });

  it('a static dynamic import passes, and its edge is checked by the layering rules', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('packages/machine/src/reviewImport.ts', "export const load = (): Promise<unknown> => import('../../safety/src/index.ts');\n");
    expectPass(repo.lint());
    expectPass(repo.deps());
    repo.write('packages/safety/src/reviewImport.ts', "export const load = (): Promise<unknown> => import('../../machine/src/index.ts');\n");
    expectFailure(repo.deps(), 'layer-safety');
  });
});
