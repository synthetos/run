/**
 * Finds setting label tables in UI source (Board settings spec §4.4 item 5):
 * an object literal with two or more keys that are setting tokens of a
 * vendored firmware table, each with a string value. Such a record is a label
 * or value table that belongs in packages/schema/settings/*.json.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface LabelTable {
  /** 1-based line of the object literal's opening brace. */
  readonly line: number;
  readonly keys: readonly string[];
}

/** Every token of every vendored table (`vendor/tinyg-hil-tables/*.json`). */
export function tableTokens(dir: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => /^d.*\.json$/.test(n))) {
    const table = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { tokens?: Record<string, unknown> };
    for (const t of Object.keys(table.tokens ?? {})) out.add(t);
  }
  return out;
}

const ENTRY = /(?:^|[{,\s])['"]?([a-z0-9]+)['"]?\s*:\s*['"`]/g;

/** Object literals (innermost braces) whose string-valued keys include two or more table tokens. */
export function settingLabelTables(source: string, tokens: ReadonlySet<string>): LabelTable[] {
  const found: LabelTable[] = [];
  for (const m of source.matchAll(/\{[^{}]*\}/g)) {
    const keys = [...m[0].matchAll(ENTRY)].map((e) => e[1] as string).filter((k) => tokens.has(k));
    if (keys.length >= 2) found.push({ line: source.slice(0, m.index).split('\n').length, keys });
  }
  return found;
}
