import { expect, it } from 'vitest';
import { verifyFirmwareReleases } from '@synthetos/protocol';
import { flashSourceLabel, resolveFlashSource } from '../src/machine-worker/flashSource.ts';
it('resolves only listed, available hardware/file/version tuples; metadata never comes from the request', async () => {
  const verdict = await verifyFirmwareReleases({ format: 'synthetos-run/github-releases@1', releases: [{ repo: 'synthetos/TinyG', tag: '450.06', file: 'tinyg-450.06.hex', date: '2026-11-15', notes: '', prerelease: true, sha256: 'a'.repeat(64), size: 100, unavailable: null }] }, { environment: 'staging', now: new Date() });
  if (!verdict.ok) throw Error('bad fixture');
  const request = { kind: 'release' as const, hv: 8, fb: 450.06, file: 'tinyg-450.06.hex' };
  const load = async () => verdict.releases;
  const source = await resolveFlashSource(request, load);
  expect(source?.kind).toBe('release');
  expect(flashSourceLabel(source!)).toBe('450.06 (GitHub release)');
  for (const patch of [{ hv: 9 }, { fb: 450.07 }, { file: 'other.hex' }]) expect(await resolveFlashSource({ ...request, ...patch }, load)).toBeNull();
  expect(await resolveFlashSource(request, async () => null)).toBeNull();
  const release = verdict.releases.boards[0]!.releases[0]!;
  expect(await resolveFlashSource(request, async () => ({ ...verdict.releases, boards: [{ hv: 8, minimumFb: null, releases: [{ ...release, unavailable: 'No digest' }] }] }))).toBeNull();
  expect(flashSourceLabel({ kind: 'release', release: { ...release, simulatorOnly: true } })).toBe('450.06 (simulated image)');
});
it('retains same-board backup identity and explicit custom confirmation for the flash gate', async () => {
  const load = async () => { throw Error('must not load releases'); };
  for (const fb of [null, 450.01]) {
    const req = { kind: 'backup' as const, boardId: 'board', fb };
    const source = await resolveFlashSource(req, load);
    expect(source).toEqual(req);
    expect(flashSourceLabel(source!)).toBe(fb === null ? 'the firmware backup' : 'the firmware backup (450.01)');
  }
  for (const confirmed of [false, true]) {
    const req = { kind: 'custom' as const, name: 'Mine', confirmed };
    const source = await resolveFlashSource(req, load);
    expect(source).toEqual(req);
    expect(flashSourceLabel(source!)).toBe('Mine (unsigned custom firmware)');
  }
});
