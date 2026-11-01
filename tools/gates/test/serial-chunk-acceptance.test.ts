/**
 * P1-00 on the real builds: the Web Serial transport lands in a chunk of its
 * own under assets/serial/, the bundle scan admits it there for the staging
 * target only, and nowhere else for any target.
 *
 * P1-01 has not written the transport yet, so each case puts a stand-in at
 * packages/machine/src/webSerialTransport.ts (a static navigator.serial read
 * and a type-only import, as the rules allow) and wires it into the machine
 * worker's transport seam, in a scratch copy of the working tree. The
 * repository's own Vite config builds it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScratchRepo } from './scratch.ts';

const TIMEOUT = 240_000;
const SEAM = 'apps/web/src/machine-worker/transport.ts';
const TRANSPORT = 'packages/machine/src/webSerialTransport.ts';

/** The stand-in transport: a static navigator.serial read, Web Serial method names, a type-only import. */
const STANDIN = [
  "import type { TransportOpenOptions } from './transport.ts';",
  'interface SerialLike { getPorts(): Promise<unknown[]>; requestPort(o: object): Promise<unknown> }',
  'export function webSerialPorts(options?: TransportOpenOptions): Promise<unknown[]> {',
  '  const serial = navigator.serial as unknown as SerialLike;',
  '  return options === undefined ? serial.getPorts() : serial.requestPort({});',
  '}',
  '',
].join('\n');

let scratch: ScratchRepo | undefined;

function fresh(): ScratchRepo {
  scratch = ScratchRepo.create();
  return scratch;
}

afterEach(() => {
  scratch?.dispose();
  scratch = undefined;
});

/** Writes the stand-in and makes the seam use it at run time. */
function wireTransport(repo: ScratchRepo): void {
  repo.write(TRANSPORT, STANDIN);
  const seam = repo.read(SEAM);
  const from = "  return Object.freeze({ kind: 'none', request: (_port: PortSelector) => Promise.resolve(null) });";
  expect(seam).toContain(from);
  repo.write(
    SEAM,
    seam
      .replace("import type { PortSelector, TransportSource } from '@synthetos/machine';", "import type { PortSelector, TransportSource } from '@synthetos/machine';\nimport { webSerialPorts } from '../../../../packages/machine/src/webSerialTransport.ts';")
      .replace(from, "  return Object.freeze({ kind: 'none', request: (_port: PortSelector) => webSerialPorts().then(() => null) });"),
  );
}

function filesUnder(root: string, dir: string): string[] {
  const full = join(root, dir);
  return existsSync(full) ? readdirSync(full).map((f) => `${dir}${f}`) : [];
}

describe('P1-00: the Web Serial chunk on the real build', () => {
  it(
    'the transport gets its own chunk under assets/serial/, which passes the staging scan and fails the production scan',
    () => {
      const repo = fresh();
      wireTransport(repo);
      const lint = repo.lint();
      expect(lint.status, lint.output).toBe(0);
      const deps = repo.deps();
      expect(deps.status, deps.output).toBe(0);
      const build = repo.buildWeb();
      expect(build.status, build.output).toBe(0);

      const serial = filesUnder(join(repo.root, 'apps/web/dist'), 'assets/serial/');
      expect(serial).toHaveLength(1);
      expect(serial[0]).toMatch(/^assets\/serial\/web-serial-[A-Za-z0-9_-]{8}\.js$/);
      const chunk = readFileSync(join(repo.root, 'apps/web/dist', serial[0] as string), 'utf8');
      expect(chunk).toMatch(/navigator\.serial/);
      // The chunk is the transport alone: no import of anything else.
      expect(chunk).not.toMatch(/\bimport\b/);

      const staging = repo.scan('staging');
      expect(staging.status, staging.output).toBe(0);
      const production = repo.scan('production');
      expect(production.status, production.output).toBe(1);
      expect(production.output).toMatch(/serial-chunk +assets\/serial\/web-serial-/);
      expect(production.output).toMatch(/web-serial +assets\/serial\/web-serial-/);
    },
    TIMEOUT,
  );

  it(
    'the fake-serial test build still differs from production only in the seam: the serial chunk is production-only',
    () => {
      const repo = fresh();
      wireTransport(repo);
      const prod = repo.buildWeb();
      expect(prod.status, prod.output).toBe(0);
      const test = repo.buildFakeSerial();
      expect(test.status, test.output).toBe(0);
      const diff = repo.gate('tools/gates/src/artifact/diff-cli.ts', [join(repo.root, 'apps/web/dist'), join(repo.root, 'apps/web/dist-fake-serial')]);
      expect(diff.status, diff.output).toBe(0);
      expect(diff.output).toMatch(/^serial +\w+ +- +assets\/serial\/web-serial\.js$/m);
      expect(diff.output).toMatch(/^same +\w+ +\w+ +assets\/machine\.worker\.js$/m);
      expect(diff.output).toMatch(/^seam +\w+ +\w+ +assets\/machine-transport\.js$/m);
    },
    TIMEOUT,
  );

  it(
    'the clean tree (no transport yet) has no serial chunk and passes both targets',
    () => {
      const repo = fresh();
      const build = repo.buildWeb();
      expect(build.status, build.output).toBe(0);
      expect(filesUnder(join(repo.root, 'apps/web/dist'), 'assets/serial/')).toEqual([]);
      for (const target of ['staging', 'production'] as const) {
        const result = repo.scan(target);
        expect(result.status, result.output).toBe(0);
      }
    },
    TIMEOUT,
  );

  it(
    'a runtime import in the transport fails dependency-cruiser',
    () => {
      const repo = fresh();
      wireTransport(repo);
      repo.write(TRANSPORT, `import { TRANSPORT_BUFFER_SIZE } from './openPolicy.ts';\nexport const SIZE = TRANSPORT_BUFFER_SIZE;\n${STANDIN}`);
      const deps = repo.deps();
      expect(deps.status, deps.output).not.toBe(0);
      expect(deps.output).toContain('web-serial-transport-type-imports-only');
    },
    TIMEOUT,
  );

  it(
    'a transport that pulls other code into its chunk is filed under assets/, where the staging scan refuses it',
    () => {
      const repo = fresh();
      wireTransport(repo);
      // A runtime import (which dependency-cruiser refuses, see above) drags the imported module into the
      // transport's chunk. The build and the scan must not rely on dependency-cruiser for this.
      repo.write(TRANSPORT, `import { TRANSPORT_BUFFER_SIZE } from './openPolicy.ts';\n${STANDIN.replace('options === undefined', 'options === undefined && TRANSPORT_BUFFER_SIZE === 256')}`);
      const build = repo.buildWeb();
      expect(build.status, build.output).toBe(0);
      expect(filesUnder(join(repo.root, 'apps/web/dist'), 'assets/serial/')).toEqual([]);
      const staging = repo.scan('staging');
      expect(staging.status, staging.output).toBe(1);
      expect(staging.output).toMatch(/web-serial +assets\/web-serial-/);
    },
    TIMEOUT,
  );
});
