/**
 * GENERATED from firmware/releases.json by `pnpm sign:releases`. Do not edit:
 * tools/gates/test/firmware-releases.test.ts fails unless this file matches
 * the generator byte for byte (tools/gates/src/release/firmwareReleases.ts).
 *
 * The GitHub-released images the signed release list names, per
 * environment: what the firmware proxy (firmwareProxy.ts) may fetch, and
 * the SHA-256 and size each body must have to be served (OD-10).
 */

export interface FirmwareAsset {
  readonly env: 'staging' | 'production';
  /** `owner/name` on GitHub. */
  readonly repo: string;
  readonly tag: string;
  /** The release asset name (the listed `.hex`). */
  readonly asset: string;
  readonly sha256: string;
  readonly size: number;
}

export const FIRMWARE_ASSETS: readonly FirmwareAsset[] = Object.freeze([
  { env: 'staging', repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex', sha256: 'c2c1693e82f0ed88ec8dec4338a0bc799059c10b3323acb1189564f6a2265e92', size: 334978 },
  { env: 'staging', repo: 'synthetos/TinyG', tag: '450.01', asset: 'tinyg-450.01.hex', sha256: 'b83763af4ecfe283d0c009fce3e6aa8df491b7f5b2a101693bccf534bb893811', size: 434318 },
]);
