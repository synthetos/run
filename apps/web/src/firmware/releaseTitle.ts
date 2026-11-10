/**
 * A firmware release's title (owner polish, 2026-11-10): the product and its major build, then the full version,
 * "TinyG 440 · 440.21" or "TinyG edge-next 450 · 450.02". One format for the release list and the update offer.
 */
import type { FirmwareRelease } from '@synthetos/protocol';

/** The product name per dialect; anything else reads "Firmware". */
const PRODUCT: Readonly<Record<string, string>> = Object.freeze({
  'tinyg-en': 'TinyG edge-next',
  'tinyg-440': 'TinyG',
  'tinyg-449-stock': 'TinyG',
  'g2core-101.03': 'g2core',
  'g2core-edge': 'g2core edge',
});

export function releaseTitle(release: Pick<FirmwareRelease, 'dialect' | 'fb'>): string {
  const product = Object.hasOwn(PRODUCT, release.dialect) ? PRODUCT[release.dialect] : 'Firmware';
  return `${product} ${Math.trunc(release.fb)} · ${release.fb.toFixed(2)}`;
}
