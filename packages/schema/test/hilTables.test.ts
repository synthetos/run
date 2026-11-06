/**
 * The generated firmware tables are the vendored HIL tables, pinned, and
 * agree with the protocol dialects (ROADMAP P0-09; RUN_PLAN §8.2).
 *
 * The byte-level drift test (committed modules == a fresh `pnpm gen:schema`)
 * is tools/gates/test/schema-tables.test.ts; this file checks the data the
 * schema package actually loads.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TINYG_440, TINYG_449_STOCK, TINYG_EN, dialectById } from '@synthetos/protocol';
import type { Dialect } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { D440, D449, DEN, GETTER_CLASS, SETTER_CLASS, SETTINGS_SCHEMAS, buildTable, getterClass, setterClass } from '../src/index.ts';
import type { GeneratedTable, HilTable } from '../src/index.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const VENDOR = join(REPO, 'vendor/tinyg-hil-tables');

interface VendoredToken {
  group: string;
  type: string;
  precision: number;
  persist: boolean;
  get: string;
  set: string;
}
interface Vendored {
  name: string;
  ref: string;
  commit: string;
  fb: number;
  status: Record<string, number>;
  tokens: Record<string, VendoredToken>;
}
interface SourceEntry {
  file: string;
  dialect: string;
  pin: string;
  sourceCommit: string;
  fb: number;
  sha256: string;
  use: 'full' | 'readOnly';
}

const sources = (JSON.parse(readFileSync(join(VENDOR, 'SOURCES.json'), 'utf8')) as { tables: Record<string, SourceEntry> }).tables;
const pins = (JSON.parse(readFileSync(join(REPO, 'vendor/firmware-pins.json'), 'utf8')) as { pins: Record<string, { commit: string; fb?: number }> }).pins;
const vendored = (file: string): Vendored => JSON.parse(readFileSync(join(VENDOR, file), 'utf8')) as Vendored;

const GENERATED: readonly GeneratedTable[] = [DEN, D440, D449];

describe('vendored tables and their sources (D32)', () => {
  it('vendors den.json, d440.json and d449.json, each with a SOURCES.json entry', () => {
    expect(Object.keys(sources).sort()).toEqual(['d440', 'd449', 'den']);
    expect(GENERATED.map((g) => g.name)).toEqual(['den', 'd440', 'd449']);
  });

  it.each(GENERATED)('$name records its source commit, which is the pinned firmware commit', (gen) => {
    const source = sources[gen.name] as SourceEntry;
    const pin = pins[source.pin];
    expect(pin, source.pin).toBeDefined();
    expect(source.sourceCommit).toBe(pin?.commit);
    expect(source.fb).toBe(pin?.fb);
    const json = vendored(source.file);
    expect(json.name).toBe(gen.name);
    expect(source.sourceCommit.startsWith(json.commit)).toBe(true);
    expect(json.fb).toBe(source.fb);
    expect(gen.commit).toBe(source.sourceCommit);
    expect(gen.dialectId).toBe(source.dialect);
    expect(gen.sha256).toBe(source.sha256);
  });

  it('den.json is generated from the edge-next pin, not the stock edge-0.97 d449.json', () => {
    expect(DEN.commit).toBe(pins['EN']?.commit);
    expect(DEN.fb).toBe(450.02);
    expect(D449.commit).toBe(pins['S449']?.commit);
    expect(sources['d449']?.use).toBe('readOnly');
    expect(sources['den']?.use).toBe('full');
    expect(DEN.commit).not.toBe(D449.commit);
  });

  it.each(GENERATED)('the generated $name module is exactly its vendored table', (gen) => {
    const json = vendored((sources[gen.name] as SourceEntry).file);
    expect(gen.tableCommit).toBe(json.commit);
    expect(gen.ref).toBe(json.ref);
    expect(gen.fb).toBe(json.fb);
    const tokens = Object.fromEntries(gen.tokens.map(([t, group, type, precision, persist, get, set]) => [t, { group, type, precision, persist, get, set }]));
    expect(tokens).toEqual(json.tokens);
    const status: Record<string, number> = {};
    for (const [code, names] of gen.status) for (const n of names) status[n] = code;
    expect(status).toEqual(json.status);
  });
});

const PAIRS: readonly [Dialect, HilTable][] = [
  [TINYG_EN, SETTINGS_SCHEMAS['tinyg-en'].table],
  [TINYG_440, SETTINGS_SCHEMAS['tinyg-440'].table],
  [TINYG_449_STOCK, SETTINGS_SCHEMAS['tinyg-449-stock'].table],
];

describe('agreement with the protocol dialects (RUN_PLAN §8.2)', () => {
  it('the schema dialect ids are protocol dialect ids, and the read-only one is read-only in both', () => {
    for (const id of ['tinyg-en', 'tinyg-440', 'tinyg-449-stock'] as const) {
      expect(dialectById(id)?.id).toBe(id);
      expect(SETTINGS_SCHEMAS[id].mode === 'readOnly').toBe(dialectById(id)?.mode === 'readOnly');
    }
  });

  it.each(PAIRS)('every status code the %s dialect classifies has that name in its vendored table', (dialect, table) => {
    expect(dialect.status.size).toBeGreaterThan(0);
    for (const [code, entry] of dialect.status) {
      expect(table.status.get(code), `${dialect.id} ${code} ${entry.name}`).toContain(entry.name);
    }
  });

  it('the tables differ where PN §11 says they do (T-S4): limit 203 on EN, 204 on TG', () => {
    expect(SETTINGS_SCHEMAS['tinyg-en'].table.status.get(203)).toContain('LIMIT_SWITCH_HIT');
    expect(SETTINGS_SCHEMAS['tinyg-en'].table.status.get(207)).toContain('KILL_JOB');
    expect(SETTINGS_SCHEMAS['tinyg-440'].table.status.get(204)).toContain('LIMIT_SWITCH_HIT');
  });
});

describe('every get and set function is classified (a new one fails until reviewed)', () => {
  it.each(GENERATED)('$name', (gen) => {
    for (const [token, , , , , getter, setter] of gen.tokens) {
      expect(getterClass(getter), `${gen.name} ${token} get ${getter}`).toBeDefined();
      expect(setterClass(setter), `${gen.name} ${token} set ${setter}`).toBeDefined();
    }
  });

  it('an unclassified name, or an inherited property name, is not a class', () => {
    expect(getterClass('get_new_thing')).toBeUndefined();
    expect(setterClass('toString')).toBeUndefined();
    expect(getterClass('constructor')).toBeUndefined();
  });

  it('the classification maps are frozen and classify the E138 side effects as side effects', () => {
    expect(Object.isFrozen(GETTER_CLASS)).toBe(true);
    expect(Object.isFrozen(SETTER_CLASS)).toBe(true);
    for (const g of ['cm_alrm', 'cm_pnic', 'cm_shutd', 'cm_clr', 'cm_clear', 'st_set_me', 'st_set_md', 'rpt_er', 'hw_get_adc3', 'qi_get', 'qo_get']) {
      expect(getterClass(g), g).toBe('sideEffect');
    }
    for (const s of ['hw_run_boot', 'set_defaults', 'run_test', 'cm_run_home', 'cm_run_jogx', 'gc_run_gc', 'st_set_me', 'st_set_md']) {
      expect(setterClass(s), s).toBe('command');
    }
  });
});

describe('buildTable', () => {
  const base: GeneratedTable = {
    name: 'den',
    dialectId: 'tinyg-en',
    commit: 'a'.repeat(40),
    tableCommit: 'aaaaaaaa',
    ref: 'x',
    fb: 1,
    sha256: 'b'.repeat(64),
    status: [[0, ['OK']]],
    tokens: [
      ['x', '', 'null', 0, false, 'get_grp', 'set_grp'],
      ['xvm', 'x', 'float', 0, true, 'get_flt', 'set_flu'],
    ],
  };

  it('indexes tokens, status and group members, and freezes them', () => {
    const t = buildTable(base);
    expect(t.tokens.get('xvm')).toMatchObject({ group: 'x', persist: true, setter: 'set_flu' });
    expect(t.members('x')).toEqual(['xvm']);
    expect(t.members('nope')).toEqual([]);
    expect(t.members('')).toEqual([]);
    expect(t.status.get(0)).toEqual(['OK']);
    expect(Object.isFrozen(t.tokens.get('xvm'))).toBe(true);
    expect(Object.isFrozen(t.members('x'))).toBe(true);
    expect(Object.isFrozen(t.source)).toBe(true);
    expect('set' in t.tokens).toBe(false);
  });

  it('refuses a duplicate token or status code', () => {
    expect(() => buildTable({ ...base, tokens: [...base.tokens, ['xvm', 'x', 'float', 0, true, 'get_flt', 'set_flu']] })).toThrow(/duplicate token xvm/);
    expect(() => buildTable({ ...base, status: [[0, ['OK']], [0, ['AGAIN']]] })).toThrow(/duplicate status code 0/);
  });
});
