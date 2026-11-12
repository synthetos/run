/**
 * The firmware hub's download path (OD-10; live/firmwareHub.ts): a listed
 * release image is fetched from the page's own origin at the path the signed
 * entry derives (the Worker's proxy for a GitHub release), with progress, and
 * checked against the entry's SHA-256 and size before C6 is ever asked; a
 * local copy is checked the same way; the flash starts only with a checked
 * image. The committed staging list and the repository's copy of the 440.21
 * image are used; nothing touches the network (fetch is stubbed).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { releasesForHardware, type FirmwareRelease } from '@synthetos/protocol';
import { mountFirmware, type FirmwareHub } from '../src/live/firmwareHub.ts';
import { memoryDeviceSafety } from '../src/live/deviceSafety.ts';
import type { SnapshotMessage } from '../src/machine-worker/rpc.ts';
import type { FirmwareDownload } from '../src/workspace/model.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const IMAGE = readFileSync(join(REPO, 'firmware/tinyg-440.21.hex'));
const PATH = '/firmware/synthetos/TinyG/440.21/tinyg-440.21.hex';

interface Served {
  readonly calls: string[];
  readonly fetch: typeof fetch;
}

/** A same-origin server for the image: the body in 64 KB chunks, or whatever `bodies` says for a path. */
function served(bodies: Record<string, Uint8Array | number> = { [PATH]: new Uint8Array(IMAGE) }): Served {
  const calls: string[] = [];
  const fetchFn = ((input: string | URL | Request) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    calls.push(path);
    const body = bodies[path];
    if (body === undefined) return Promise.resolve(new Response('not found', { status: 404 }));
    if (typeof body === 'number') return Promise.resolve(new Response('error', { status: body }));
    let at = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (at >= body.byteLength) {
          c.close();
          return;
        }
        c.enqueue(body.subarray(at, at + 65536));
        at += 65536;
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-length': String(body.byteLength), 'content-type': 'text/plain; charset=utf-8' } }));
  }) as typeof fetch;
  return { calls, fetch: fetchFn };
}

async function hub(server: Served): Promise<{ hub: FirmwareHub; flashes: unknown[]; phases: string[]; release: FirmwareRelease }> {
  vi.stubGlobal('fetch', server.fetch);
  const flashes: unknown[] = [];
  const phases: string[] = [];
  let downloads: FirmwareDownload | null = null;
  const h = await mountFirmware({
    store: memoryDeviceSafety(),
    flash: (command) => {
      flashes.push(command);
      return Promise.resolve(null);
    },
    read: () => Promise.resolve(null),
    runBackup: () => Promise.reject(new Error('not read in this test')),
    boardSettings: () => ({}),
    stageRestore: () => undefined,
    reread: () => undefined,
    onChange: () => {
      const d = h.view().download;
      if (d !== downloads) {
        downloads = d;
        if (d !== null) phases.push(`${d.phase}:${d.received}`);
      }
    },
  });
  const view = h.view();
  expect(view.releases.ok).toBe(true);
  if (!view.releases.ok) throw new Error('no list');
  // 450.01 (edge-next pre-release) is listed beside it since 2026-11-03: pick 440.21 by name, the image the repository holds a copy of.
  const release = releasesForHardware(view.releases.list, 8)?.releases.find((r) => r.file === 'tinyg-440.21.hex');
  if (release === undefined) throw new Error('440.21 is not listed');
  return { hub: h, flashes, phases, release };
}

describe('firmware hub: downloading a listed release (OD-10)', () => {
  beforeEach(() => {
    // The bench origin: the hub verifies the committed list for staging (approvalEnvironment).
    vi.stubGlobal('location', { origin: 'http://localhost:8793' });
    vi.stubGlobal('indexedDB', undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the committed staging list offers 440.21 for hardware version 8 from GitHub Releases, not recommended, not below the minimum', async () => {
    const { hub: h, release } = await hub(served());
    expect(release).toMatchObject({ fb: 440.21, hv: 8, file: 'tinyg-440.21.hex', repo: 'synthetos/TinyG', tag: '440.21', recommended: false, simulatorOnly: false, size: IMAGE.length });
    const view = h.view();
    expect(view.releases.ok && releasesForHardware(view.releases.list, 8)?.minimumFb).toBe(440.21);
    // The edge-next pre-release sits beside it, from GitHub Releases, not recommended until the maintainer calls a 450.xx build current.
    expect(view.releases.ok && releasesForHardware(view.releases.list, 8)?.releases.find((r) => r.file === 'tinyg-450.01.hex')).toMatchObject({ fb: 450.01, hv: 8, repo: 'synthetos/TinyG', tag: '450.01', recommended: false, simulatorOnly: false, size: 434318 });
    expect(view.download).toBeNull();
  });

  it('updates a confirmed bootloader through recovery without asking firmware for a settings backup', async () => {
    const { hub: h, flashes, release } = await hub(served());
    const got = await h.actions.downloadRelease(release); if (!got.ok) throw new Error(got.message);
    h.onSnapshot({ snapshot: { base: 'NOT_CONNECTED', identity: null, epoch: 1 }, flash: { id: 1, phase: 'failed', boardId: null, board: { id: null, hv: 8, fb: null, fv: null }, bootloader: { startAllowed: true } } } as unknown as SnapshotMessage, false, 0);
    expect(await h.actions.startFirmware()).toBeNull();
    expect(await h.actions.bootloaderHardware(8)).toBeNull();
    expect(await h.actions.updateRelease(got.image)).toBeNull();
    expect(flashes).toContainEqual({ op: 'startFirmware' });
    expect(flashes).toContainEqual({ op: 'bootloaderHardware', hv: 8 });
    expect(flashes.at(-1)).toMatchObject({ op: 'begin', settingsBackup: 'unreadable', baseline: null, recovery: true });
  });

  it('fetches the image from its own origin through the Worker’s path, shows progress, checks the hash and size, and hands back the exact text', async () => {
    const server = served();
    const { hub: h, phases, release } = await hub(server);
    const got = await h.actions.downloadRelease(release);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.image.from).toBe('site');
    expect(got.image.release).toBe(release);
    expect(new TextEncoder().encode(got.image.hex)).toEqual(new Uint8Array(IMAGE));
    expect(server.calls).toEqual([PATH]);
    expect(phases[0]).toBe('fetching:0');
    expect(phases).toContain(`checking:${IMAGE.length}`);
    expect(phases.at(-1)).toBe(`ready:${IMAGE.length}`);
    // Progress climbed through the chunks.
    const received = phases.filter((p) => p.startsWith('fetching:')).map((p) => Number(p.slice('fetching:'.length)));
    expect(received.length).toBeGreaterThan(3);
    expect([...received].sort((a, b) => a - b)).toEqual(received);
    expect(h.view().download).toMatchObject({ file: 'tinyg-440.21.hex', phase: 'ready', received: IMAGE.length, total: IMAGE.length, message: null });
  });

  it('a body with another hash (same size) is refused with the local-copy hint; nothing is handed back', async () => {
    const tampered = new Uint8Array(IMAGE);
    tampered[100] = tampered[100] === 0x30 ? 0x31 : 0x30;
    const { hub: h, release } = await hub(served({ [PATH]: tampered }));
    const got = await h.actions.downloadRelease(release);
    expect(got).toEqual({ ok: false, message: expect.stringMatching(/SHA-256 is not the one the signed release list names.*Use a local copy/s) });
    expect(h.view().download).toMatchObject({ phase: 'failed', message: expect.stringContaining('SHA-256') });
  });

  it('not served (404), too long, and a failed fetch each say so and offer the local copy', async () => {
    const missing = await hub(served({}));
    expect(await missing.hub.actions.downloadRelease(missing.release)).toEqual({ ok: false, message: expect.stringMatching(/not served by this site \(GitHub Releases did not answer.*Use a local copy/s) });
    vi.unstubAllGlobals();
    vi.stubGlobal('location', { origin: 'http://localhost:8793' });
    vi.stubGlobal('indexedDB', undefined);
    const longer = new Uint8Array(IMAGE.length + 1);
    longer.set(IMAGE);
    const tooLong = await hub(served({ [PATH]: longer }));
    expect(await tooLong.hub.actions.downloadRelease(tooLong.release)).toEqual({ ok: false, message: expect.stringMatching(/longer than the 334978 bytes/) });
    vi.unstubAllGlobals();
    vi.stubGlobal('location', { origin: 'http://localhost:8793' });
    vi.stubGlobal('indexedDB', undefined);
    const down = await hub(served({ [PATH]: 502 }));
    expect(await down.hub.actions.downloadRelease(down.release)).toEqual({ ok: false, message: expect.stringContaining('not served by this site') });
  });

  it('a local copy is checked the same way; the flash starts only with a checked image, and a tampered one is refused before the worker', async () => {
    const { hub: h, flashes, release } = await hub(served({}));
    const text = IMAGE.toString('latin1');
    const local = await h.actions.checkLocalCopy(release, text);
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    expect(local.image.from).toBe('local');
    const wrong = await h.actions.checkLocalCopy(release, `${text}\n`);
    expect(wrong).toEqual({ ok: false, message: expect.stringContaining('334979 bytes, not the 334978') });
    // Flashing a checked image whose text was altered since: refused by the hub's own re-check, never sent to the worker.
    expect(await h.actions.updateRelease({ ...local.image, hex: text.replace(':10', ':11') })).toMatch(/SHA-256/);
    expect(flashes).toEqual([]);
  });
});
