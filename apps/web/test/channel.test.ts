/**
 * The build-channel seam (P1-00, D41, accepted 2026-11-02): the release module does
 * nothing; the bench replacement refuses every host but loopback over plain
 * HTTP, before the machine worker starts, and marks the page visibly. The
 * bench build configuration is checked here too; the real builds and the
 * release/bench diff are in tools/gates/test/bench-acceptance.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import * as release from '../src/channel/channel.ts';
import * as bench from '../src/channel/bench.ts';
import { BENCH_MARKER } from '../src/channel/benchMarker.ts';
import { BENCH_MODE, BENCH_OUT_DIR, CHANNEL_CHUNK_NAME, benchPlugin, channelSeam } from '../build/bench.ts';
import { FAKE_SERIAL_OUT_DIR } from '../build/fakeSerial.ts';

const WEB = resolve(import.meta.dirname, '..');

interface FakeDoc {
  location: { hostname: string; protocol: string };
  documentElement: { dataset: Record<string, string> };
  title: string;
  chip: { attrs: Record<string, string>; textContent: string | null; setAttribute(n: string, v: string): void } | null;
  querySelector(sel: string): unknown;
}

function fakeDoc(url: string, withChip = true): FakeDoc {
  const u = new URL(url);
  const chip = withChip
    ? {
        attrs: {} as Record<string, string>,
        textContent: 'v0.0.0 · 0123456789ab' as string | null,
        setAttribute(n: string, v: string) {
          this.attrs[n] = v;
        },
      }
    : null;
  return {
    location: { hostname: u.hostname, protocol: u.protocol },
    documentElement: { dataset: {} },
    title: 'run.synthetos.com',
    chip,
    querySelector: (sel: string) => (sel === '[data-version]' ? chip : null),
  };
}

const asDoc = (d: FakeDoc): Document => d as unknown as Document;

describe('the release channel', () => {
  it('changes nothing on any host', () => {
    const d = fakeDoc('https://staging.run.synthetos.com/');
    expect(release.startBuildChannel(asDoc(d))).toEqual({ kind: 'release', benchIdentity: null });
    expect(d.documentElement.dataset).toEqual({});
    expect(d.title).toBe('run.synthetos.com');
    expect(d.chip?.textContent).toBe('v0.0.0 · 0123456789ab');
  });

  it('exports the same runtime names as the bench replacement uses for the seam', () => {
    expect(Object.keys(release).sort()).toEqual(['startBuildChannel']);
    expect(typeof bench.startBuildChannel).toBe('function');
  });
});

describe('the bench channel', () => {
  it.each(['http://localhost:8793/', 'http://127.0.0.1:8793/', 'http://localhost/'])('runs on %s and marks the page and the version chip', (url) => {
    const d = fakeDoc(url);
    expect(bench.startBuildChannel(asDoc(d))).toMatchObject({ kind: 'bench' });
    expect(d.documentElement.dataset).toEqual({ channel: 'bench', buildMarker: BENCH_MARKER });
    expect(d.chip?.attrs).toEqual({ 'data-channel': 'bench' });
    expect(d.chip?.textContent).toBe(`v0.0.0 · 0123456789ab · ${bench.BENCH_LABEL}`);
    expect(d.title).toBe('[bench] run.synthetos.com');
  });

  it.each([
    'https://staging.run.synthetos.com/',
    'https://run.synthetos.com/',
    'https://localhost:8793/',
    'http://192.168.1.20:8793/',
    'http://localhost.evil.example:8793/',
    'http://[::1]:8793/',
    'http://bench.local:8793/',
  ])('refuses %s, and marks nothing', (url) => {
    const d = fakeDoc(url);
    expect(() => bench.startBuildChannel(asDoc(d))).toThrow(bench.BenchHostError);
    expect(d.documentElement.dataset).toEqual({});
    expect(d.chip?.attrs).toEqual({});
  });

  it('works without a version chip on the page', () => {
    expect(bench.startBuildChannel(asDoc(fakeDoc('http://localhost:8793/', false)))).toMatchObject({ kind: 'bench' });
  });

  it('P1-05 (D41, accepted 2026-11-02): carries the localhost bench identity, which re-checks the host on every request', async () => {
    const d = fakeDoc('http://localhost:8793/');
    const identity = bench.startBuildChannel(asDoc(d)).benchIdentity;
    if (identity === null) throw new Error('the bench channel must carry the bench identity');
    expect(identity.kind).toBe('bench');
    expect(await identity.current()).toEqual({ provider: 'bench', subject: bench.BENCH_SUBJECT });
    d.location = { hostname: 'staging.run.synthetos.com', protocol: 'https:' };
    expect(await identity.current()).toBeNull();
    d.location = { hostname: 'localhost', protocol: 'https:' };
    expect(await identity.current()).toBeNull();
  });
});

describe('the bench build configuration', () => {
  it('writes to its own directory, never dist or the fake-serial directory', () => {
    expect(BENCH_MODE).toBe('bench');
    expect(BENCH_OUT_DIR).toBe('dist-bench');
    expect([BENCH_OUT_DIR]).not.toContain('dist');
    expect(BENCH_OUT_DIR).not.toBe(FAKE_SERIAL_OUT_DIR);
    expect(CHANNEL_CHUNK_NAME).toBe('build-channel');
  });

  it('names the release seam and its bench replacement, and nothing else', () => {
    const seam = channelSeam(WEB);
    expect(seam.release).toBe(`${WEB}/src/channel/channel.ts`);
    expect(seam.bench).toBe(`${WEB}/src/channel/bench.ts`);
    expect(seam.isSeamModule(seam.release)).toBe(true);
    expect(seam.isSeamModule(seam.bench)).toBe(true);
    expect(seam.isSeamModule(`${WEB}/src/channel/benchMarker.ts`)).toBe(false);
    expect(seam.isSeamModule(`${WEB}/src/entries/workspace.ts`)).toBe(false);
  });

  it('swaps the release seam for the bench module and fails a build that swapped nothing', async () => {
    const seam = channelSeam(WEB);
    const plugin = benchPlugin(seam);
    const resolveId = plugin.resolveId as unknown as (this: unknown, s: string, i: string | undefined, o: object) => Promise<string | null>;
    const ctx = (id: string) => ({ resolve: () => Promise.resolve({ id }) });
    expect(await resolveId.call(ctx(`${WEB}/src/shell/Shell.ts`), './x', 'importer.ts', {})).toBeNull();
    expect(await resolveId.call(ctx(seam.release), '../channel/channel.ts', 'importer.ts', {})).toBe(seam.bench);

    const fresh = benchPlugin(seam);
    const errors: string[] = [];
    (fresh.buildEnd as unknown as (this: unknown, e?: Error) => void).call({ error: (m: string) => errors.push(m) }, undefined);
    expect(errors).toEqual([expect.stringContaining('the bench build would be the release build')]);
  });
});
