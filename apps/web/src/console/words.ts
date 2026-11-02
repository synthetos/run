/**
 * The Console command line in plain words: token completion with each
 * token's description from the settings schema, and replies read back as
 * words with the raw JSON kept for one click away. Pure; the schema and the
 * read allowlist are data.
 */
import { DIALECTS } from '@synthetos/protocol';
import { DEN, readAllowlistFor, readDecisionFor, type SettingValue } from '@synthetos/schema';
import { plainValue, settingMeta } from '../workspace/boardFacts.ts';

export interface Suggestion {
  readonly token: string;
  readonly label: string;
  readonly description: string;
}

/** The dialect whose allowlist and schema completion uses: the board's, or edge-next before one is read. */
function dialectFor(dialect: string | null): string {
  return dialect ?? 'tinyg-en';
}

const cache = new Map<string, readonly Suggestion[]>();

/** Every token the console can read on `dialect`, with its words, sorted. */
export function readableTokens(dialect: string | null): readonly Suggestion[] {
  const d = dialectFor(dialect);
  const hit = cache.get(d);
  if (hit !== undefined) return hit;
  let tokens: string[];
  try {
    tokens = [...readAllowlistFor(d).allow];
  } catch {
    tokens = [];
  }
  const list = tokens
    .map((token) => {
      const m = settingMeta(token, d);
      return { token, label: m.label === token ? '' : m.label, description: m.description };
    })
    .sort((a, b) => a.token.localeCompare(b.token));
  cache.set(d, list);
  return list;
}

/** The word being typed at the end of `input` (without a leading `$`), or null when completion does not apply. */
export function completionWord(input: string): string | null {
  const t = input.trimStart();
  if (t.startsWith('{') || t.includes('=') || /\s/.test(t)) return null;
  const word = t.startsWith('$') ? t.slice(1) : t;
  return /^[a-z0-9_]{1,16}$/i.test(word) ? word.toLowerCase() : null;
}

/**
 * Up to `max` tokens for the word being typed: prefix matches first (shortest first), then tokens whose
 * plain-words label contains the word. Nothing for an empty word.
 */
export function suggest(input: string, dialect: string | null, max = 8): readonly Suggestion[] {
  const word = completionWord(input);
  if (word === null) return [];
  const all = readableTokens(dialect);
  const prefix = all.filter((s) => s.token.startsWith(word)).sort((a, b) => a.token.length - b.token.length || a.token.localeCompare(b.token));
  if (prefix.length >= max || word.length < 3) return prefix.slice(0, max);
  const byLabel = all.filter((s) => !s.token.startsWith(word) && s.label.toLowerCase().includes(word));
  return [...prefix, ...byLabel].slice(0, max);
}

/** The input with the word being typed replaced by `token` (keeping a leading `$`). */
export function complete(input: string, token: string): string {
  const t = input.trimStart();
  return t.startsWith('$') ? `$${token}` : token;
}

export function allowedRead(dialect: string): (token: string) => { readonly allowed: true } | { readonly allowed: false; readonly reason: string } {
  return (token) => readDecisionFor(dialect, token);
}

/** A status code in words: "status 0 (OK)". From the edge-next table, which names every code. */
export function statusText(status: number): string {
  const names = DEN.status.find(([code]) => code === status)?.[1];
  return names === undefined ? `status ${status}` : `status ${status} (${names.map((n) => n.replace(/^STAT_/, '')).join(', ')})`;
}

export interface ReplyRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/**
 * Words for the machine-state keys a status report carries (TinyG `sr`), which the settings overlay does not
 * describe. Value words only where the meaning is fixed across the TinyG dialects; others show the number.
 */
const AXIS_WORD: Readonly<Record<string, string>> = { x: 'X', y: 'Y', z: 'Z', a: 'A', b: 'B', c: 'C' };
const STATE_WORDS: Readonly<Record<string, { readonly label: string; readonly values?: Readonly<Record<number, string>> }>> = {
  line: { label: 'Line number' },
  n: { label: 'N word' },
  stat: { label: 'Machine state' },
  vel: { label: 'Velocity' },
  feed: { label: 'Feed rate' },
  tool: { label: 'Tool' },
  qr: { label: 'Planner buffers free' },
  unit: { label: 'Units', values: { 0: 'inches (G20)', 1: 'millimetres (G21)' } },
  coor: { label: 'Coordinate system', values: { 0: 'machine (G53)', 1: 'G54', 2: 'G55', 3: 'G56', 4: 'G57', 5: 'G58', 6: 'G59' } },
  dist: { label: 'Distance mode', values: { 0: 'absolute (G90)', 1: 'incremental (G91)' } },
  momo: { label: 'Motion mode', values: { 0: 'traverse (G0)', 1: 'feed (G1)', 2: 'arc, clockwise (G2)', 3: 'arc, counter-clockwise (G3)', 4: 'cancelled (G80)' } },
  plan: { label: 'Plane', values: { 0: 'XY (G17)', 1: 'XZ (G18)', 2: 'YZ (G19)' } },
  frmo: { label: 'Feed rate mode' },
  path: { label: 'Path control' },
  admo: { label: 'Arc distance mode' },
  hold: { label: 'Feedhold state' },
  macs: { label: 'Machine state, raw' },
  cycs: { label: 'Cycle state' },
  mots: { label: 'Motion state' },
};

function stateWords(key: string): { readonly label: string; readonly values?: Readonly<Record<number, string>> } | null {
  const known = STATE_WORDS[key];
  if (known !== undefined) return known;
  const pos = /^(pos|mpo|ofs)([xyzabc])$/.exec(key);
  if (pos !== null) return { label: `${AXIS_WORD[pos[2] as string] ?? ''} ${pos[1] === 'pos' ? 'work position' : pos[1] === 'mpo' ? 'machine position' : 'offset'}` };
  return null;
}

function statWord(value: number, dialect: string | null): string | null {
  const d = DIALECTS.find((x) => x.id === (dialect ?? 'tinyg-en'));
  const name = d?.stat[value]?.name;
  return name === undefined ? null : name.toLowerCase().replace(/_/g, ' ');
}

function valueWords(key: string, value: unknown, dialect: string | null): string {
  if (value === null || value === undefined) return 'no value';
  if (key === 'stat' && typeof value === 'number') {
    const w = statWord(value, dialect);
    return w === null ? String(value) : `${value} (${w})`;
  }
  const state = stateWords(key);
  if (state !== null && typeof value === 'number') {
    const named = state.values?.[value];
    return named === undefined ? (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))) : named;
  }
  if (typeof value === 'number' || typeof value === 'string') return plainValue(key, value as SettingValue, dialect) ?? String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return JSON.stringify(value);
}

/**
 * The answer as rows: one row for a single value, one per member for a group or a status report.
 * Group members are named by their full token (`x` → `xvm`, `xfr`, …) so their words come from the schema.
 */
export function replyRows(token: string, value: unknown, dialect: string | null): readonly ReplyRow[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const group = token === 'sr' || token === 'sys' ? '' : token;
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => {
      const full = settingMeta(`${group}${k}`, dialect).label !== `${group}${k}` ? `${group}${k}` : k;
      const label = stateWords(full)?.label ?? settingMeta(full, dialect).label;
      return { key: full, label: label === full ? '' : label, value: valueWords(full, v, dialect) };
    });
  }
  const label = stateWords(token)?.label ?? settingMeta(token, dialect).label;
  return [{ key: token, label: label === token ? '' : label, value: valueWords(token, value, dialect) }];
}
