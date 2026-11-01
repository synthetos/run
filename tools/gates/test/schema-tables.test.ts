/**
 * The generated schema tables are exactly what `pnpm gen:schema` renders from
 * vendor/tinyg-hil-tables/ (ROADMAP P0-09 acceptance: "Snapshot tests fail if
 * regeneration changes the output"), and the generator refuses input it does
 * not understand.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERATED_DIR, VENDOR_DIR, renderAll } from '../src/schema/all.ts';
import { TABLE_NAMES, checkSource, parseVendoredTable, renderTable, sha256Hex } from '../src/schema/render.ts';
import type { SourceEntry } from '../src/schema/render.ts';

const sources = (JSON.parse(readFileSync(join(VENDOR_DIR, 'SOURCES.json'), 'utf8')) as { tables: Record<string, SourceEntry> }).tables;
const text = (name: string): string => readFileSync(join(VENDOR_DIR, `${name}.json`), 'utf8');

describe('packages/schema/src/generated', () => {
  const rendered = renderAll();

  it.each(TABLE_NAMES)('%s.ts is byte-identical to a fresh render (regenerate with `pnpm gen:schema`)', (name) => {
    expect(readFileSync(join(GENERATED_DIR, `${name}.ts`), 'utf8')).toBe(rendered.get(name));
  });

  it.each(TABLE_NAMES)('vendor/tinyg-hil-tables/%s.json matches the sha256 in SOURCES.json', (name) => {
    expect(sha256Hex(text(name))).toBe(sources[name]?.sha256);
  });

  it('a change to a vendored table changes the render (the snapshot would fail)', () => {
    const json = JSON.parse(text('den')) as { tokens: Record<string, { precision: number }> };
    (json.tokens['xvm'] as { precision: number }).precision = 3;
    const changed = `${JSON.stringify(json, null, 1)}\n`;
    const source = { ...(sources['den'] as SourceEntry), sha256: sha256Hex(changed) };
    expect(renderTable('den', changed, source)).not.toBe(rendered.get('den'));
  });
});

describe('the generator refuses what it does not understand', () => {
  const base = (): Record<string, unknown> => JSON.parse(text('d440')) as Record<string, unknown>;
  const parse = (value: unknown): unknown => parseVendoredTable('d440', JSON.stringify(value));

  it('accepts the real table', () => {
    expect(() => parse(base())).not.toThrow();
  });

  it('not an object, or an unexpected or missing field', () => {
    expect(() => parse([])).toThrow(/not a JSON object/);
    expect(() => parse({ ...base(), extra: 1 })).toThrow(/has fields/);
    const missing = base();
    delete missing['ref'];
    expect(() => parse(missing)).toThrow(/has fields/);
  });

  it('wrong name, commit, ref or fb', () => {
    expect(() => parse({ ...base(), name: 'den' })).toThrow(/name is "den"/);
    expect(() => parse({ ...base(), commit: 'xyz' })).toThrow(/commit is not a hex SHA/);
    expect(() => parse({ ...base(), ref: "o'brien" })).toThrow(/ref/);
    expect(() => parse({ ...base(), fb: '440.21' })).toThrow(/fb is not a number/);
  });

  it('bad status entries', () => {
    expect(() => parse({ ...base(), status: {} })).toThrow(/status is not a non-empty object/);
    expect(() => parse({ ...base(), status: { 'bad name': 1 } })).toThrow(/status name/);
    expect(() => parse({ ...base(), status: { OK: 256 } })).toThrow(/status OK = 256/);
    expect(() => parse({ ...base(), status: { OK: 1.5 } })).toThrow(/status OK = 1.5/);
  });

  it('bad token entries', () => {
    const withToken = (token: string, def: unknown): unknown => ({ ...base(), tokens: { [token]: def } });
    const good = { group: '', type: 'integer', precision: 0, persist: false, get: 'get_ui8', set: 'set_nul' };
    expect(() => parse({ ...base(), tokens: {} })).toThrow(/tokens is not a non-empty object/);
    expect(() => parse(withToken("x'", good))).toThrow(/token "x'"/);
    expect(() => parse(withToken('x', 1))).toThrow(/token x is not an object/);
    expect(() => parse(withToken('x', { ...good, extra: 1 }))).toThrow(/token x has fields/);
    expect(() => parse(withToken('x', { ...good, group: 'toolong' }))).toThrow(/token x: group/);
    expect(() => parse(withToken('x', { ...good, type: 'complex' }))).toThrow(/token x: type complex/);
    expect(() => parse(withToken('x', { ...good, precision: -1 }))).toThrow(/token x: precision/);
    expect(() => parse(withToken('x', { ...good, persist: 1 }))).toThrow(/token x: persist/);
    expect(() => parse(withToken('x', { ...good, get: 'get ui8' }))).toThrow(/token x: get/);
    expect(() => parse(withToken('x', { ...good, set: "set'" }))).toThrow(/token x: set/);
  });

  it('a table that disagrees with its SOURCES.json entry', () => {
    const t = text('d440');
    const table = parseVendoredTable('d440', t);
    const source = sources['d440'] as SourceEntry;
    expect(() => checkSource('d440', table, source, t)).not.toThrow();
    expect(() => checkSource('d440', table, { ...source, sourceCommit: 'd0418390' }, t)).toThrow(/not a full SHA/);
    expect(() => checkSource('d440', table, { ...source, sourceCommit: 'c'.repeat(40) }, t)).toThrow(/table commit d0418390 is not/);
    expect(() => checkSource('d440', table, { ...source, fb: 440.2 }, t)).toThrow(/table fb 440.21 is not/);
    expect(() => checkSource('d440', table, source, `${t} `)).toThrow(/sha256/);
  });

  it('a missing SOURCES.json entry', () => {
    expect(() => renderAll(join(import.meta.dirname, 'fixtures/schema-no-sources'))).toThrow(/SOURCES.json has no entry for den/);
  });
});
