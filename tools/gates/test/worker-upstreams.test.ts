/**
 * The run Worker's upstream origins (OD-10; tools/gates/src/source/
 * workerUpstreams.ts): every `scheme://` literal in workers/run/src is one of
 * the reviewed entries, in the file the entry names, and the firmware proxy's
 * GitHub origin is the one reviewed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { originLiterals, WORKER_UPSTREAMS } from '../src/source/workerUpstreams.ts';
import { GITHUB_RELEASES_ORIGIN } from '../../../workers/run/src/firmwareProxy.ts';

const WORKER_SRC = resolve(import.meta.dirname, '../../../workers/run/src');

describe('workers/run upstream origins', () => {
  it('every scheme:// literal in the Worker source is a reviewed upstream, and every reviewed upstream is present', () => {
    const found = readdirSync(WORKER_SRC)
      .filter((f) => f.endsWith('.ts'))
      .sort()
      .flatMap((f) => originLiterals(f, readFileSync(join(WORKER_SRC, f), 'utf8')));
    const seen = found.map(({ file, text }) => ({ file, text }));
    const allowed = WORKER_UPSTREAMS.map(({ file, text }) => ({ file, text }));
    for (const literal of found) expect(allowed, `${literal.file}:${literal.line} ${literal.text}`).toContainEqual({ file: literal.file, text: literal.text });
    for (const entry of allowed) expect(seen, `${entry.file} ${entry.text}`).toContainEqual(entry);
  });

  it('the firmware proxy fetches from github.com only', () => {
    expect(GITHUB_RELEASES_ORIGIN).toBe('https://github.com');
    expect(WORKER_UPSTREAMS.filter((u) => u.file === 'firmwareProxy.ts').map((u) => u.text)).toEqual(['https://github.com']);
  });

  it('the literal scan sees strings and templates, not comments, and a URL built from pieces is not a literal', () => {
    const src = ['// https://comment.example', '/* http://block.example */', "const a = 'https://a.example';", 'const b = `https://${host}/x`;', "const c = 'https' + '://' + 'c.example';", 'const d = "ftp://d.example";'].join('\n');
    expect(originLiterals('x.ts', src)).toEqual([
      { file: 'x.ts', text: 'https://a.example', line: 3 },
      { file: 'x.ts', text: 'https://${host}/x', line: 4 },
      { file: 'x.ts', text: 'ftp://d.example', line: 6 },
    ]);
  });
});
