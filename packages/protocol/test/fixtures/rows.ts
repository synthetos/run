/**
 * Reads the `<kind><TAB><line>` fixture files under test-fixtures/ (test code only).
 * `#` lines are comments. `\0` in a line stands for a NUL byte.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
export const FIXTURES = join(REPO_ROOT, 'test-fixtures');

export interface Row {
  readonly file: string;
  readonly lineNo: number;
  readonly kind: string;
  readonly line: string;
}

export interface FixtureFile {
  readonly file: string;
  readonly comments: readonly string[];
  readonly rows: readonly Row[];
}

const KINDS = new Set(['Response', 'StatusReport', 'QueueReport', 'RxReport', 'Exception', 'Banner', 'Ack', 'ProbeReport', 'Text', 'Garbled']);

export function readFixture(path: string): FixtureFile {
  const comments: string[] = [];
  const rows: Row[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((text, i) => {
      if (text === '') return;
      if (text.startsWith('#')) {
        comments.push(text);
        return;
      }
      const tab = text.indexOf('\t');
      const kind = text.slice(0, tab);
      if (tab < 0 || !KINDS.has(kind)) throw new Error(`${path}:${i + 1}: not "<kind>\\t<line>"`);
      rows.push({ file: path, lineNo: i + 1, kind, line: text.slice(tab + 1).replaceAll('\\0', '\0') });
    });
  return { file: path, comments, rows };
}

export function readFixtureDir(dir: string): FixtureFile[] {
  return readdirSync(join(FIXTURES, dir))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => readFixture(join(FIXTURES, dir, f)));
}
