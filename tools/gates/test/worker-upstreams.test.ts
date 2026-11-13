/**
 * The run Worker's upstream origins (OD-10; tools/gates/src/source/
 * workerUpstreams.ts): every `scheme://` literal in workers/run/src is one of
 * the reviewed entries, in the file the entry names, and the firmware proxy's
 * GitHub origin is the one reviewed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { NETWORK_IDENTIFIERS } from '../src/shared/networkIdentifiers.ts';
import { originLiterals, WORKER_UPSTREAMS, WORKER_LINK_DATA } from '../src/source/workerUpstreams.ts';
import { GITHUB_RELEASES_ORIGIN } from '../../../workers/run/src/firmwareProxy.ts';

const NETWORK_NAMES = new Set([...NETWORK_IDENTIFIERS, 'Request', 'connect', 'Socket', 'WebTransport', 'RTCPeerConnection']);
function networkNames(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    // Include quoted property names too, so globalThis['fetch'] cannot bypass this rule.
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && NETWORK_NAMES.has(node.text)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf); return found;
}
const reviewedLink = (file: string, text: string): boolean => WORKER_LINK_DATA.some(entry => entry.file === file && entry.prefixes.some(prefix => text.startsWith(prefix)));

const WORKER_SRC = resolve(import.meta.dirname, '../../../workers/run/src');

describe('workers/run upstream origins', () => {
  it('every scheme:// literal is an exact reviewed upstream or file-scoped link data, and every upstream is present', () => {
    const found = readdirSync(WORKER_SRC)
      .filter((f) => f.endsWith('.ts'))
      .sort()
      .flatMap((f) => originLiterals(f, readFileSync(join(WORKER_SRC, f), 'utf8')));
    const seen = found.map(({ file, text }) => ({ file, text }));
    const allowed = WORKER_UPSTREAMS.map(({ file, text }) => ({ file, text }));
    for (const literal of found.filter(literal => !reviewedLink(literal.file, literal.text))) expect(allowed, `${literal.file}:${literal.line} ${literal.text}`).toContainEqual({ file: literal.file, text: literal.text });
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

it('pins the catalog link prefixes and rejects other schemes, hosts and files', () => {
  expect(WORKER_LINK_DATA).toEqual([{ file: 'catalogData.ts', prefixes: ['https://onsrud.com/'], servedBy: 'catalogRoute.ts' }]);
  expect(reviewedLink('catalogData.ts', 'https://onsrud.com/Products/52280.asp')).toBe(true);
  for (const url of ['http://onsrud.com/a', 'https://onsrud.com.evil/a', 'https://onsrud.com@evil/a', 'https://www.onsrud.com/a', 'https://onsrud.com:443/a', 'https://evil/a']) expect(reviewedLink('catalogData.ts', url)).toBe(false);
  expect(reviewedLink('catalogRoute.ts', 'https://onsrud.com/a')).toBe(false);
  expect(reviewedLink('firmwareProxy.ts', 'https://onsrud.com/a')).toBe(false);
});
it('every catalog literal is reviewed link data and neither data nor its route has network identifiers', () => {
  for (const entry of WORKER_LINK_DATA) {
    const source = readFileSync(join(WORKER_SRC, entry.file), 'utf8');
    const links = originLiterals(entry.file, source);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(reviewedLink(link.file, link.text), `${link.file}:${link.line} ${link.text}`).toBe(true);
    for (const file of [entry.file, entry.servedBy]) expect(networkNames(file, readFileSync(join(WORKER_SRC, file), 'utf8')), file).toEqual([]);
  }
});
it('the network guard detects constructors, calls, aliases and quoted member access', () => {
  for (const name of NETWORK_NAMES) {
    expect(networkNames('fixture.ts', `const x = ${name};`)).toContain(name);
    expect(networkNames('fixture.ts', `globalThis['${name}']();`)).toContain(name);
    expect(networkNames('fixture.ts', `globalThis[\`${name}\`]();`)).toContain(name);
  }
  expect(networkNames('fixture.ts', '// fetch Request connect\nconst data = "product description";')).toEqual([]);
});
