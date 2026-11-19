/**
 * The bundled settings files, by dialect (Board settings spec §4.3). The
 * classified dialect and the board's `fb` select one; a dialect without a
 * file (unclassified, g2core today) has none, and nothing of it is described
 * or writable.
 */
import tinyg440 from '../../settings/tinyg-440.json' with { type: 'json' };
import tinyg449 from '../../settings/tinyg-449.json' with { type: 'json' };
import tinyg450 from '../../settings/tinyg-450.json' with { type: 'json' };
import { expandSettingsFile } from './expand.ts';
import type { SettingsFile } from './types.ts';

/** Dialect id → raw file. 449 and 440 are describe-only (readOnly, no write objects). */
const FILES: Readonly<Record<string, unknown>> = Object.freeze({
  'tinyg-en': tinyg450,
  'tinyg-449-stock': tinyg449,
  'tinyg-440': tinyg440,
});

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

/** The definitions of a dialect that must have a file; throws when it has none. */
export function requireSettingsDefs(dialectId: string, fb?: number): SettingsFile {
  const file = settingsDefsFor(dialectId, fb);
  if (file === null) throw new Error(`no settings file for dialect ${JSON.stringify(dialectId)}`);
  return file;
}
