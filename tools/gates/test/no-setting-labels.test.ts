/**
 * No label tables in UI code (Board settings spec §4.4 item 5): setting names
 * and value words live in packages/schema/settings/*.json, never in a record
 * keyed by setting tokens in the Board view or boardFacts.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { settingLabelTables, tableTokens } from '../src/settingsLabels/check.ts';
import { REPO_ROOT } from './scratch.ts';

const TOKENS = tableTokens(join(REPO_ROOT, 'vendor/tinyg-hil-tables'));

function sources(): string[] {
  const board = join(REPO_ROOT, 'apps/web/src/workspace/views/board');
  return [join(REPO_ROOT, 'apps/web/src/workspace/boardFacts.ts'), ...readdirSync(board).filter((f) => f.endsWith('.ts')).map((f) => join(board, f))];
}

describe('setting label tables', () => {
  it('reads the token names from the vendored tables', () => {
    expect(TOKENS.has('xsn')).toBe(true);
    expect(TOKENS.has('1mi')).toBe(true);
    expect(TOKENS.has('label')).toBe(false);
  });

  it('flags a record keyed by setting tokens with string values', () => {
    const src = "const PLAIN_LABEL = {\n  baud: 'Serial baud setting',\n  ex: 'Flow control',\n  'p1frq': 'PWM frequency',\n};";
    expect(settingLabelTables(src, TOKENS)).toEqual([{ line: 1, keys: ['baud', 'ex', 'p1frq'] }]);
  });

  it('ignores ordinary objects with one token-like key, and token keys with non-string values', () => {
    expect(settingLabelTables("h('div', { id: 'x', class: 'y' })", TOKENS)).toEqual([]);
    expect(settingLabelTables('const rows = { xsn: 1, xsx: 2 };', TOKENS)).toEqual([]);
  });

  it('boardFacts.ts and the Board view tabs hold no setting label table', () => {
    const found: { file: string; line: number; keys: readonly string[] }[] = [];
    for (const file of sources()) {
      for (const t of settingLabelTables(readFileSync(file, 'utf8'), TOKENS)) found.push({ file: file.slice(REPO_ROOT.length + 1), ...t });
    }
    expect(found).toEqual([]);
  });
});
