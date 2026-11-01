/**
 * ROADMAP P0-14 on the real builds: each case copies the working tree,
 * optionally changes one thing, builds the production web app and the
 * fake-serial test build with the repository's Vite config, and runs the
 * real gate CLIs.
 *
 * - Clean tree: the two artifacts differ only in the transport seam chunk;
 *   the bundle scan passes production and refuses the test build.
 * - A replacement that shares a production module (here the machine
 *   package) changes the worker chunk too, and the diff check refuses it.
 * - A worker that no longer imports the seam makes the test build fail,
 *   rather than produce a "test" artifact that runs production code.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ScratchRepo } from './scratch.ts';

const TIMEOUT = 240_000;
const FAKE = 'tools/e2e/fake-serial/transport.ts';
const DIFF = 'tools/gates/src/artifact/diff-cli.ts';
let scratch: ScratchRepo | undefined;

function fresh(): ScratchRepo {
  scratch = ScratchRepo.create();
  return scratch;
}

afterEach(() => {
  scratch?.dispose();
  scratch = undefined;
});

function bothBuilt(repo: ScratchRepo): void {
  const prod = repo.buildWeb();
  expect(prod.status, prod.output).toBe(0);
  const test = repo.buildFakeSerial();
  expect(test.status, test.output).toBe(0);
}

function diff(repo: ScratchRepo): ReturnType<ScratchRepo['gate']> {
  return repo.gate(DIFF, [join(repo.root, 'apps/web/dist'), join(repo.root, 'apps/web/dist-fake-serial')]);
}

describe('fake-serial test build (P0-14)', () => {
  it(
    'differs from production only in the seam chunk, and only production passes the bundle scan',
    () => {
      const repo = fresh();
      bothBuilt(repo);
      const result = diff(repo);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toMatch(/^seam +\w+ +\w+ +assets\/machine-transport\.js$/m);
      expect(result.output).toMatch(/^same +\w+ +\w+ +assets\/machine\.worker\.js$/m);
      expect(repo.scan().status).toBe(0);
      const testScan = repo.gate('tools/gates/src/bundle/cli.ts', [join(repo.root, 'apps/web/dist-fake-serial')]);
      expect(testScan.status, testScan.output).toBe(1);
      expect(testScan.output).toMatch(/testkit-marker +assets\/machine-transport-/);
    },
    TIMEOUT,
  );

  it(
    'refuses a replacement that pulls a production module into the seam chunk',
    () => {
      const repo = fresh();
      const fake = repo.read(FAKE);
      repo.write(
        FAKE,
        fake
          .replace("import type { TransportSource } from '@synthetos/machine';", "import { TRANSPORT_BUFFER_SIZE, type TransportSource } from '@synthetos/machine';")
          .replace("kind: 'fake',", "kind: TRANSPORT_BUFFER_SIZE === 256 ? 'fake' : 'none',"),
      );
      bothBuilt(repo);
      const result = diff(repo);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toMatch(/unexpected-difference +assets\/machine\.worker\.js differs/);
    },
    TIMEOUT,
  );

  it(
    'fails the test build when no worker imports the seam',
    () => {
      const repo = fresh();
      repo.write('apps/web/src/machine-worker/transport2.ts', repo.read('apps/web/src/machine-worker/transport.ts'));
      const worker = 'apps/web/src/machine-worker/machine.worker.ts';
      repo.write(worker, repo.read(worker).replace("from './transport.ts'", "from './transport2.ts'"));
      const result = repo.buildFakeSerial();
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/fake-serial: no worker imported the transport seam/);
    },
    TIMEOUT,
  );
});
