import { expect, it } from 'vitest';
import { belowMinimum, FIRMWARE_RELEASES_FORMAT, releasePath, releasesForHardware, verifyFirmwareReleases } from '../src/firmwareReleases.ts';
const row = { repo: 'synthetos/TinyG', tag: '450.06', file: 'tinyg-450.06.hex', date: '2026-11-15T00:00:00Z', notes: '<b>plain text</b>', prerelease: true, sha256: 'a'.repeat(64), size: 100, unavailable: null };
const file = (rows: unknown[] = [row]) => ({ format: FIRMWARE_RELEASES_FORMAT, releases: rows });
const options = { environment: 'production' as const, now: new Date() };
it('validates fixed-repo metadata and retains plain notes, dates and prerelease labels', async () => {
  const result = await verifyFirmwareReleases(file(), options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error('rejected');
  const board = releasesForHardware(result.releases, 8)!;
  expect(board.releases[0]).toMatchObject({ fb: 450.06, prerelease: true, changelog: '<b>plain text</b>', date: '2026-11-15', sha256: row.sha256 });
  expect(releasePath(board.releases[0]!)).toBe('/firmware/synthetos/TinyG/450.06/tinyg-450.06.hex');
  expect(releasesForHardware(result.releases, 99)).toBeNull();
  expect(belowMinimum(result.releases, 8, 440.21)).toEqual({ below: true, minimumFb: 450.01 });
});
it.each([{ repo: 'other/TinyG' }, { tag: '../escape' }, { file: '../bad.hex' }, { date: 'no' }, { notes: 4 }, { prerelease: 1 }, { sha256: 'bad' }, { size: 0 }, { size: 2 * 1024 * 1024 + 1 }])('rejects malformed metadata %j', async change => {
  expect((await verifyFirmwareReleases(file([{ ...row, ...change }]), options)).ok).toBe(false);
});
it('lists missing-digest releases as unavailable, never with a usable hash', async () => {
  const result = await verifyFirmwareReleases(file([{ ...row, sha256: null, unavailable: 'GitHub did not provide a SHA-256 digest.' }]), options);
  expect(result.ok && result.releases.boards[0]?.releases[0]).toMatchObject({ sha256: '', unavailable: expect.stringContaining('digest') });
});
it('rejects duplicate/oversized lists, invalid clocks, unknown environments and old signed envelopes', async () => {
  for (const input of [null, { format: 'signed', manifests: [] }, file([row, row]), file(Array(6).fill(row))]) expect((await verifyFirmwareReleases(input, options)).ok).toBe(false);
  expect((await verifyFirmwareReleases(file(), { ...options, now: new Date(NaN) })).ok).toBe(false);
  expect((await verifyFirmwareReleases(file(), { ...options, environment: null })).ok).toBe(false);
});
it('keeps local non-firmware fixtures separate and simulator-only, never in production', async () => {
  const result = await verifyFirmwareReleases(file(), { ...options, environment: 'staging' });
  if (!result.ok) throw Error('rejected');
  const sim = releasesForHardware(result.releases, 99)!;
  expect(sim.releases).toHaveLength(3);
  expect(sim.releases.every(r => r.simulatorOnly && r.repo === null && r.tag === null && releasePath(r).startsWith('/firmware/sim/'))).toBe(true);
});
