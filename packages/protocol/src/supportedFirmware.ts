/** Owner decision 2026-11-15: reviewed host support is code, independent of the download list. */
import type { DialectId } from './dialects/types.ts';
export const SUPPORTED_TINYG_BUILDS: readonly number[] = Object.freeze([450.01, 450.02, 450.03, 450.04, 450.05, 450.06]);
/** A GitHub release being downloadable never adds it to this list. */
export function supportsFirmware(dialect: DialectId, fb: unknown): boolean {
  return dialect === 'tinyg-en' && typeof fb === 'number' && SUPPORTED_TINYG_BUILDS.includes(fb);
}
