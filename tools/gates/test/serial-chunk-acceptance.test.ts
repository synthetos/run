/**
 * P1-00 and P1-01 on the real builds: the Web Serial transport
 * (packages/machine/src/webSerialTransport.ts), wired into the machine
 * worker's transport seam by P1-01, lands in a chunk of its own under
 * assets/serial/; the bundle scan admits it there for staging and production
 * (OD-29), and nowhere else for any target. Each case builds a scratch copy of
 * the working tree with the repository's own Vite config.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScratchRepo } from './scratch.ts';

const TIMEOUT = 240_000;
const SEAM = 'apps/web/src/machine-worker/transport.ts';
const TRANSPORT = 'packages/machine/src/webSerialTransport.ts';
const CHOOSER = 'packages/machine/src/webSerialChooser.ts';

/** The Phase 0 seam body: no transport at all. */
const PHASE0_SEAM = [
  "import type { PortSelector, TransportSource } from '@synthetos/machine';",
  'export function createTransportSource(): TransportSource {',
  "  return Object.freeze({ kind: 'none', request: (_port: PortSelector) => Promise.resolve(null) });",
  '}',
  '',
].join('\n');

/** The buffer-size check, which a runtime import of the open policy is made to replace below. */
const BUFFER_CHECK = 'if (bufferSize !== WEB_SERIAL_BUFFER_SIZE) {';

/** Gives the transport a runtime import of the open policy (which its rules forbid) that the code really uses. */
function withRuntimeImport(repo: ScratchRepo): void {
  const source = repo.read(TRANSPORT);
  expect(source).toContain(BUFFER_CHECK);
  repo.write(
    TRANSPORT,
    `import { TRANSPORT_BUFFER_SIZE } from './openPolicy.ts';\n${source.replace(BUFFER_CHECK, 'if (bufferSize !== TRANSPORT_BUFFER_SIZE) {')}`,
  );
}

let scratch: ScratchRepo | undefined;

function fresh(): ScratchRepo {
  scratch = ScratchRepo.create();
  return scratch;
}

afterEach(() => {
  scratch?.dispose();
  scratch = undefined;
});

function filesUnder(root: string, dir: string): string[] {
  const full = join(root, dir);
  return existsSync(full) ? readdirSync(full).map((f) => `${dir}${f}`) : [];
}

describe('P1-00, P1-01: the Web Serial chunk on the real build', () => {
  it(
    'the transport gets its own chunk under assets/serial/, which passes the staging scan and (OD-29) the production scan',
    () => {
      const repo = fresh();
      const lint = repo.lint();
      expect(lint.status, lint.output).toBe(0);
      const deps = repo.deps();
      expect(deps.status, deps.output).toBe(0);
      const build = repo.buildWeb();
      expect(build.status, build.output).toBe(0);

      const serial = filesUnder(join(repo.root, 'apps/web/dist'), 'assets/serial/');
      // The worker's transport chunk and (OD-3) the page's port chooser chunk, nothing else.
      expect(serial).toHaveLength(2);
      const transport = serial.filter((f) => !f.includes('chooser'));
      expect(transport).toHaveLength(1);
      expect(transport[0]).toMatch(/^assets\/serial\/web-serial-[A-Za-z0-9_-]{8}\.js$/);
      const chunk = readFileSync(join(repo.root, 'apps/web/dist', transport[0] as string), 'utf8');
      expect(chunk).toMatch(/navigator\.serial/);
      // The chunk is the transport alone: no import of anything else.
      expect(chunk).not.toMatch(/\bimport\b/);
      const chooser = serial.filter((f) => f.includes('chooser'));
      expect(chooser[0]).toMatch(/^assets\/serial\/web-serial-chooser-[A-Za-z0-9_-]{8}\.js$/);
      const chooserChunk = readFileSync(join(repo.root, 'apps/web/dist', chooser[0] as string), 'utf8');
      expect(chooserChunk).toMatch(/requestPort/);
      expect(chooserChunk).not.toMatch(/\bimport\b/);
      // The chooser chunk holds no transport code: it cannot open a port.
      expect(chooserChunk).not.toMatch(/\.open\(|getWriter|getReader/);

      const staging = repo.scan('staging');
      expect(staging.status, staging.output).toBe(0);
      // OD-29 (owner, 2026-11-09): production admits the serial chunk as staging does.
      const production = repo.scan('production');
      expect(production.status, production.output).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'the fake-serial test build still differs from production only in the seam: the serial chunk is production-only',
    () => {
      const repo = fresh();
      const prod = repo.buildWeb();
      expect(prod.status, prod.output).toBe(0);
      const test = repo.buildFakeSerial();
      expect(test.status, test.output).toBe(0);
      const diff = repo.gate('tools/gates/src/artifact/diff-cli.ts', [join(repo.root, 'apps/web/dist'), join(repo.root, 'apps/web/dist-fake-serial')]);
      expect(diff.status, diff.output).toBe(0);
      expect(diff.output).toMatch(/^serial +\w+ +- +assets\/serial\/web-serial\.js$/m);
      expect(diff.output).toMatch(/^same +\w+ +\w+ +assets\/serial\/web-serial-chooser\.js$/m);
      expect(diff.output).toMatch(/^same +\w+ +\w+ +assets\/machine\.worker\.js$/m);
      expect(diff.output).toMatch(/^seam +\w+ +\w+ +assets\/machine-transport\.js$/m);
    },
    TIMEOUT,
  );

  it(
    'with the Phase 0 seam (no transport) only the chooser chunk is under assets/serial/: staging and (OD-29) production pass',
    () => {
      const repo = fresh();
      repo.write(SEAM, PHASE0_SEAM);
      const build = repo.buildWeb();
      expect(build.status, build.output).toBe(0);
      const serial = filesUnder(join(repo.root, 'apps/web/dist'), 'assets/serial/');
      expect(serial).toHaveLength(1);
      expect(serial[0]).toMatch(/^assets\/serial\/web-serial-chooser-/);
      const staging = repo.scan('staging');
      expect(staging.status, staging.output).toBe(0);
      const production = repo.scan('production');
      expect(production.status, production.output).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'a runtime import in the transport fails dependency-cruiser',
    () => {
      const repo = fresh();
      withRuntimeImport(repo);
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
      // A runtime import (which dependency-cruiser refuses, see above) drags the imported module into the
      // transport's chunk. The build and the scan must not rely on dependency-cruiser for this.
      withRuntimeImport(repo);
      const build = repo.buildWeb();
      expect(build.status, build.output).toBe(0);
      expect(filesUnder(join(repo.root, 'apps/web/dist'), 'assets/serial/').filter((f) => !f.includes('chooser'))).toEqual([]);
      const staging = repo.scan('staging');
      expect(staging.status, staging.output).toBe(1);
      expect(staging.output).toMatch(/web-serial +assets\/web-serial-/);
    },
    TIMEOUT,
  );

  it(
    'OD-3: a port chooser that pulls other code into its chunk is filed under assets/, where the staging scan refuses it',
    () => {
      const repo = fresh();
      // A runtime import of a module only the chooser uses: the bundler merges it into the chooser's chunk.
      repo.write('packages/machine/src/chooserHelper.ts', 'export function helperLimit(text: string): number {\n  return Number.parseInt(text.trim(), 10);\n}\n');
      const source = repo.read(CHOOSER);
      repo.write(CHOOSER, source.replace('const MAX_GRANT_INDEX = 255;', "import { helperLimit } from './chooserHelper.ts';\nconst MAX_GRANT_INDEX = helperLimit(String(globalThis.length ?? ' 255 '));"));
      const deps = repo.deps();
      expect(deps.output).toContain('web-serial-chooser-type-imports-only');
      const build = repo.buildWeb();
      expect(build.status, build.output).toBe(0);
      expect(filesUnder(join(repo.root, 'apps/web/dist'), 'assets/serial/').filter((f) => f.includes('chooser'))).toEqual([]);
      const staging = repo.scan('staging');
      expect(staging.status, staging.output).toBe(1);
      expect(staging.output).toMatch(/web-serial +assets\/web-serial-chooser-/);
    },
    TIMEOUT,
  );
});
