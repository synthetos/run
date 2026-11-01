/**
 * The fake-serial test build's configuration (ROADMAP P0-14,
 * build/fakeSerial.ts). The real builds and the artifact diff are exercised
 * in tools/gates/test/fake-serial-acceptance.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { BUILD_MODES, FAKE_SERIAL_MODE, FAKE_SERIAL_OUT_DIR, assertBuildMode, fakeSerialPlugins, transportSeam } from '../build/fakeSerial.ts';

const WEB = resolve(import.meta.dirname, '..');
const seam = transportSeam(WEB);

describe('build modes', () => {
  it('builds only in production, fake-serial and bench mode, into separate directories', () => {
    expect(BUILD_MODES).toEqual(['production', 'fake-serial', 'bench']);
    expect(() => assertBuildMode('build', 'bench')).not.toThrow();
    expect(FAKE_SERIAL_OUT_DIR).not.toBe('dist');
    expect(() => assertBuildMode('build', 'production')).not.toThrow();
    expect(() => assertBuildMode('build', FAKE_SERIAL_MODE)).not.toThrow();
    expect(() => assertBuildMode('build', 'development')).toThrow(/refusing to build in mode "development"/);
    expect(() => assertBuildMode('build', 'test')).toThrow(/refusing/);
    // vitest and the dev server load the config in other modes; only builds are restricted.
    expect(() => assertBuildMode('serve', 'test')).not.toThrow();
  });
});

describe('transportSeam', () => {
  it('names the production seam and its replacement, and nothing else', () => {
    expect(seam.production).toBe(`${WEB}/src/machine-worker/transport.ts`);
    expect(seam.fake).toBe(resolve(WEB, '../../tools/e2e/fake-serial/transport.ts'));
    expect(seam.isSeamModule(seam.production)).toBe(true);
    expect(seam.isSeamModule(seam.fake)).toBe(true);
    expect(seam.isSeamModule(`${WEB}/src/machine-worker/host.ts`)).toBe(false);
    expect(seam.isSeamModule(resolve(WEB, '../../tools/e2e/fake-serial/mockTransport.ts'))).toBe(false);
  });
});

type ResolveHook = (this: unknown, source: string, importer: string | undefined, options: object) => Promise<string | null>;
type EndHook = (this: { error(message: string): never }, error?: Error) => void;

function hooks(): { resolveId: ResolveHook; buildEnd: EndHook } {
  const plugins = fakeSerialPlugins(seam);
  return { resolveId: plugins.worker().resolveId as ResolveHook, buildEnd: plugins.main.buildEnd as EndHook };
}

function ctx(resolved: string | null): { resolve: () => Promise<{ id: string } | null> } {
  return { resolve: () => Promise.resolve(resolved === null ? null : { id: resolved }) };
}

const failing = {
  error(message: string): never {
    throw new Error(message);
  },
};

describe('fakeSerialPlugins', () => {
  it('redirects whatever resolves to the seam, and only that', async () => {
    const { resolveId } = hooks();
    expect(await resolveId.call(ctx(seam.production), './transport.ts', `${WEB}/src/machine-worker/machine.worker.ts`, {})).toBe(seam.fake);
    expect(await resolveId.call(ctx(`${WEB}/src/machine-worker/host.ts`), './host.ts', `${WEB}/src/machine-worker/machine.worker.ts`, {})).toBeNull();
    expect(await resolveId.call(ctx(null), 'missing', `${WEB}/x.ts`, {})).toBeNull();
    expect(await resolveId.call(ctx(seam.production), seam.production, undefined, {})).toBeNull();
  });

  it('fails the build when no worker swapped the seam, and passes once one did', async () => {
    const unswapped = hooks();
    expect(() => unswapped.buildEnd.call(failing)).toThrow(/no worker imported the transport seam/);
    // A build that already failed reports its own error, not this one.
    expect(() => unswapped.buildEnd.call(failing, new Error('earlier'))).not.toThrow();

    const swapped = hooks();
    await swapped.resolveId.call(ctx(seam.production), './transport.ts', `${WEB}/src/machine-worker/machine.worker.ts`, {});
    expect(() => swapped.buildEnd.call(failing)).not.toThrow();
  });
});
