/**
 * The settings definitions of the connected board (Board settings spec §4.3):
 * the classified dialect and the board's reported build pick the file. No
 * board, or a dialect without a file, gives null: everything is then shown
 * raw and nothing is described or writable.
 */
import { settingsDefsFor, type SettingDefinition, type SettingsFile } from '@synthetos/schema';
import type { LiveView } from '../model.ts';

/** The board's reported build (`fb`), or undefined before it is read. */
export function boardBuild(view: LiveView | null): number | undefined {
  const fb = view?.message?.snapshot.identity?.fb;
  return typeof fb === 'number' && Number.isFinite(fb) ? fb : undefined;
}

export function defsFor(view: LiveView | null): SettingsFile | null {
  const dialect = view?.readout.dialectId ?? null;
  return dialect === null ? null : settingsDefsFor(dialect, boardBuild(view));
}

export function definitionOf(key: string, view: LiveView | null): SettingDefinition | null {
  return defsFor(view)?.tokens.get(key) ?? null;
}
