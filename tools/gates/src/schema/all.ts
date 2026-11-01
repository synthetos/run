/**
 * Renders every vendored HIL table from the repository files (ROADMAP P0-09).
 * Used by `pnpm gen:schema` (gen.ts) and by the drift test.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TABLE_NAMES, renderTable } from './render.ts';
import type { SourceEntry, TableName } from './render.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
export const VENDOR_DIR = join(REPO_ROOT, 'vendor/tinyg-hil-tables');
export const GENERATED_DIR = join(REPO_ROOT, 'packages/schema/src/generated');

/** Renders every table from the files in the repository. */
export function renderAll(root: string = REPO_ROOT): Map<TableName, string> {
  const vendor = join(root, 'vendor/tinyg-hil-tables');
  const sources = (JSON.parse(readFileSync(join(vendor, 'SOURCES.json'), 'utf8')) as { tables: Record<string, SourceEntry> }).tables;
  const out = new Map<TableName, string>();
  for (const name of TABLE_NAMES) {
    const source = sources[name];
    if (source === undefined) throw new Error(`gen-schema: SOURCES.json has no entry for ${name}`);
    out.set(name, renderTable(name, readFileSync(join(vendor, source.file), 'utf8'), source));
  }
  return out;
}
