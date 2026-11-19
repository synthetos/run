/**
 * The bundled settings files, by dialect (Board settings spec §4.3). The
 * classified dialect and the board's `fb` select one; a dialect without a
 * file (unclassified, g2core today) has none, and nothing of it is described
 * or writable.
 */
import { expandSettingsFile } from './expand.ts';
import type { SettingsFile } from './types.ts';

/** Dialect id → raw file. */
const FILES: Readonly<Record<string, unknown>> = Object.freeze({});

const cache = new Map<string, SettingsFile>();

/** The expanded definitions of a dialect at build `fb`, or null when the dialect has no file. */
export function settingsDefsFor(dialectId: string, fb?: number): SettingsFile | null {
  if (!Object.hasOwn(FILES, dialectId)) return null;
  const id = `${dialectId}@${fb ?? ''}`;
  let file = cache.get(id);
  if (file === undefined) {
    file = expandSettingsFile(FILES[dialectId], fb);
    cache.set(id, file);
  }
  return file;
}
