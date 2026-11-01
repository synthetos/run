/**
 * Renders a vendored HIL table as a `GeneratedTable` module for
 * packages/schema (ROADMAP P0-09; RUN_PLAN §8.2).
 *
 *   pnpm gen:schema
 *
 * The input is checked strictly: an unexpected field, type or name shape
 * fails generation, so a change in the harness's output format can never
 * slip into the schema unnoticed. The output is deterministic (status codes
 * ascending, names and tokens sorted), so `tools/gates/test/schema-tables.test.ts`
 * can require the committed modules to be byte-identical to a fresh render.
 */
import { createHash } from 'node:crypto';

export const TABLE_NAMES = ['den', 'd440', 'd449'] as const;
export type TableName = (typeof TABLE_NAMES)[number];

const TOKEN_TYPES = new Set(['boolean', 'data', 'float', 'integer', 'null', 'signed', 'string', 'txtcon', 'other']);
const TOKEN_RE = /^[A-Za-z0-9_$]{1,8}$/;
const GROUP_RE = /^[A-Za-z0-9_]{0,4}$/;
const FUNCTION_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STATUS_NAME_RE = /^[A-Z0-9_]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const SHORT_SHA_RE = /^[0-9a-f]{7,40}$/;
const REF_RE = /^[A-Za-z0-9/._-]{1,100}$/;

export interface SourceEntry {
  readonly file: string;
  readonly dialect: 'tinyg-en' | 'tinyg-440' | 'tinyg-449-stock';
  readonly sourceCommit: string;
  readonly fb: number;
  readonly sha256: string;
}

interface VendoredToken {
  readonly group: string;
  readonly type: string;
  readonly precision: number;
  readonly persist: boolean;
  readonly get: string;
  readonly set: string;
}

interface VendoredTable {
  readonly name: string;
  readonly ref: string;
  readonly commit: string;
  readonly fb: number;
  readonly status: Readonly<Record<string, number>>;
  readonly tokens: Readonly<Record<string, VendoredToken>>;
}

function fail(name: string, message: string): never {
  throw new Error(`gen-schema: ${name}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(name: string, where: string, value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join(',') !== expected.join(',')) fail(name, `${where} has fields [${actual.join(', ')}], expected [${expected.join(', ')}]`);
}

/** Parses and checks a vendored table. Throws on anything unexpected. */
export function parseVendoredTable(name: TableName, text: string): VendoredTable {
  const json: unknown = JSON.parse(text);
  if (!isRecord(json)) fail(name, 'not a JSON object');
  exactKeys(name, 'the table', json, ['commit', 'fb', 'name', 'ref', 'status', 'tokens']);
  const { commit, fb, ref, status, tokens } = json;
  if (json['name'] !== name) fail(name, `name is ${JSON.stringify(json['name'])}`);
  if (typeof commit !== 'string' || !SHORT_SHA_RE.test(commit)) fail(name, 'commit is not a hex SHA');
  if (typeof ref !== 'string' || !REF_RE.test(ref)) fail(name, `ref ${JSON.stringify(ref)}`);
  if (typeof fb !== 'number' || !Number.isFinite(fb)) fail(name, 'fb is not a number');
  if (!isRecord(status) || Object.keys(status).length === 0) fail(name, 'status is not a non-empty object');
  for (const [sym, code] of Object.entries(status)) {
    if (!STATUS_NAME_RE.test(sym)) fail(name, `status name ${JSON.stringify(sym)}`);
    if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > 255) fail(name, `status ${sym} = ${String(code)}`);
  }
  if (!isRecord(tokens) || Object.keys(tokens).length === 0) fail(name, 'tokens is not a non-empty object');
  for (const [token, def] of Object.entries(tokens)) {
    if (!TOKEN_RE.test(token)) fail(name, `token ${JSON.stringify(token)}`);
    if (!isRecord(def)) fail(name, `token ${token} is not an object`);
    exactKeys(name, `token ${token}`, def, ['get', 'group', 'persist', 'precision', 'set', 'type']);
    if (typeof def['group'] !== 'string' || !GROUP_RE.test(def['group'])) fail(name, `token ${token}: group`);
    if (typeof def['type'] !== 'string' || !TOKEN_TYPES.has(def['type'])) fail(name, `token ${token}: type ${String(def['type'])}`);
    const precision = def['precision'];
    if (typeof precision !== 'number' || !Number.isInteger(precision) || precision < 0 || precision > 9) fail(name, `token ${token}: precision`);
    if (typeof def['persist'] !== 'boolean') fail(name, `token ${token}: persist`);
    if (typeof def['get'] !== 'string' || !FUNCTION_RE.test(def['get'])) fail(name, `token ${token}: get`);
    if (typeof def['set'] !== 'string' || !FUNCTION_RE.test(def['set'])) fail(name, `token ${token}: set`);
  }
  return json as unknown as VendoredTable;
}

/** Checks that the table and its SOURCES.json entry agree. */
export function checkSource(name: TableName, table: VendoredTable, source: SourceEntry, text: string): void {
  if (!SHA_RE.test(source.sourceCommit)) fail(name, 'SOURCES.json sourceCommit is not a full SHA');
  if (!source.sourceCommit.startsWith(table.commit)) fail(name, `table commit ${table.commit} is not SOURCES.json ${source.sourceCommit}`);
  if (source.fb !== table.fb) fail(name, `table fb ${table.fb} is not SOURCES.json ${source.fb}`);
  const sha256 = sha256Hex(text);
  if (sha256 !== source.sha256) fail(name, `sha256 ${sha256} is not SOURCES.json ${source.sha256}`);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const CODE_POINT_ORDER = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The module text for one table. */
export function renderTable(name: TableName, text: string, source: SourceEntry): string {
  const table = parseVendoredTable(name, text);
  checkSource(name, table, source, text);

  const byCode = new Map<number, string[]>();
  for (const [sym, code] of Object.entries(table.status)) byCode.set(code, [...(byCode.get(code) ?? []), sym]);
  const statusLines = [...byCode]
    .sort(([a], [b]) => a - b)
    .map(([code, names]) => `    [${code}, [${names.sort(CODE_POINT_ORDER).map((n) => `'${n}'`).join(', ')}]],`);

  const tokenLines = Object.keys(table.tokens)
    .sort(CODE_POINT_ORDER)
    .map((token) => {
      const t = table.tokens[token] as VendoredToken;
      return `    ['${token}', '${t.group}', '${t.type}', ${t.precision}, ${String(t.persist)}, '${t.get}', '${t.set}'],`;
    });

  return [
    `// GENERATED by \`pnpm gen:schema\` from vendor/tinyg-hil-tables/${source.file}. Do not edit.`,
    `// Source: TinyG @ ${source.sourceCommit} (fb ${table.fb}), table sha256 ${source.sha256}.`,
    `// Provenance: vendor/tinyg-hil-tables/SOURCES.json. Regenerate after re-vendoring, then review the diff.`,
    `import type { GeneratedTable } from '../tables/types.ts';`,
    ``,
    `export const ${name.toUpperCase()}: GeneratedTable = {`,
    `  name: '${name}',`,
    `  dialectId: '${source.dialect}',`,
    `  commit: '${source.sourceCommit}',`,
    `  tableCommit: '${table.commit}',`,
    `  ref: '${table.ref}',`,
    `  fb: ${table.fb},`,
    `  sha256: '${source.sha256}',`,
    `  status: [`,
    ...statusLines,
    `  ],`,
    `  // [token, group, type, precision, persist, getter, setter]`,
    `  tokens: [`,
    ...tokenLines,
    `  ],`,
    `};`,
    ``,
  ].join('\n');
}
