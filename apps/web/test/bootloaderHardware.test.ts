import { expect, it } from 'vitest';
import type { FirmwareReleases, HardwareReleases } from '@synthetos/protocol';
import { bootloaderHardwareVersions } from '../src/firmware/bootloaderHardware.ts';

function board(hv: number, simulatorOnly: boolean): HardwareReleases {
  return { hv, minimumFb: null, releases: [{ hv, fb: 450.01, fv: 0.97, dialect: 'tinyg-en', part: 'x192a3', file: 'test.hex', sha256: 'a'.repeat(64), size: 1, date: '2026-11-12', changelog: 'test', recommended: true, simulatorOnly, repo: null, tag: null }] };
}
const list = (boards: readonly HardwareReleases[]): FirmwareReleases => ({ env: 'staging', issuedMs: 0, expiresMs: 1, boards });

it('offers no default or choices without verified release metadata', () => {
  expect(bootloaderHardwareVersions(null)).toEqual([]);
  expect(bootloaderHardwareVersions(list([]))).toEqual([]);
});

it('offers only real hardware with a non-simulator image, never hv 99 even if mislabeled', () => {
  expect(bootloaderHardwareVersions(list([board(8, false), board(7, true), board(99, true), board(99, false), { hv: 6, minimumFb: null, releases: [] }]))).toEqual([8]);
});
