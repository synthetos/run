/**
 * The allowlisted settings read, `deviceHash` and the drift check (ROADMAP
 * P1-07; RUN_PLAN §7.2 connect flow steps 4-6; SAFETY §3 READING, H33).
 *
 * - `settingsReadGroups` lists the groups the settings view reads, each
 *   with a plain-language explanation. A group is listed only when the
 *   dialect's read allowlist allows its group token and the vendored table
 *   has members for it, so the view can never ask for a token the session
 *   would refuse (and the session checks every GET again).
 * - `boardSettingsFrom` flattens the group answers (`{"x":{"am":1,...}}`)
 *   back into table tokens (`xam`), table-driven: a member the table does
 *   not list under that group is dropped, never guessed.
 * - `deviceHash` is SHA-256 over the canonical text of the persisted
 *   settings (sorted keys), so the same board settings always give the same
 *   hash and any change made by another program gives a different one.
 * - `settingsDrift` compares a read with what this browser expected: a
 *   different hash, or a key-level difference to the previous read or to a
 *   profile draft, is drift (NEEDS_REVIEW). Nothing here writes anything.
 */
import { isReadAllowed } from './allowlists/index.ts';
import { settingsSchemaFor } from './settingsSchema.ts';
import type { HilTable } from './tables/types.ts';

export interface SettingsGroup {
  /** The group token that is read (`x`, `1`, `sys`). */
  readonly token: string;
  readonly title: string;
  /** What the group holds, for people who did not write the firmware. */
  readonly explanation: string;
  /** Member tokens as the table spells them (`xam`), in table order. */
  readonly members: readonly string[];
  /** True when at least one member is persisted (it counts towards `deviceHash`). */
  readonly persisted: boolean;
}

interface GroupText {
  readonly title: string;
  readonly explanation: string;
}

const MOTOR_TEXT = (n: string): GroupText => ({
  title: `Motor ${n}`,
  explanation: `Which axis motor ${n} drives, its step angle, the travel per revolution, microsteps, direction polarity and power management.`,
});
const LINEAR_TEXT = (axis: string): GroupText => ({
  title: `${axis} axis`,
  explanation: `How the ${axis} axis moves: its mode, maximum speeds and jerk, travel limits, the homing switches and the homing speeds.`,
});
const ROTARY_TEXT = (axis: string): GroupText => ({
  title: `${axis} axis (rotary)`,
  explanation: `How the rotary ${axis} axis moves: its mode, maximum speeds and jerk, travel limits and the radius used to convert feed rates.`,
});
const OFFSET_TEXT = (code: string, n: number): GroupText => ({
  title: `${code.toUpperCase()} offsets`,
  explanation: `The origin of work coordinate system ${n} (${code.toUpperCase()}), as an offset per axis from machine zero.`,
});

/** Groups in the order the settings view shows them. */
const GROUP_TEXT: readonly (readonly [string, GroupText])[] = [
  ['sys', { title: 'System', explanation: 'Firmware identity, units, junction and chordal tolerances, switch type, communication and status-report settings.' }],
  ['1', MOTOR_TEXT('1')],
  ['2', MOTOR_TEXT('2')],
  ['3', MOTOR_TEXT('3')],
  ['4', MOTOR_TEXT('4')],
  ['x', LINEAR_TEXT('X')],
  ['y', LINEAR_TEXT('Y')],
  ['z', LINEAR_TEXT('Z')],
  ['a', ROTARY_TEXT('A')],
  ['b', ROTARY_TEXT('B')],
  ['c', ROTARY_TEXT('C')],
  ['p1', { title: 'Spindle PWM', explanation: 'The PWM output that sets spindle speed: its frequencies and how a speed maps to a duty cycle.' }],
  ['g54', OFFSET_TEXT('g54', 1)],
  ['g55', OFFSET_TEXT('g55', 2)],
  ['g56', OFFSET_TEXT('g56', 3)],
  ['g57', OFFSET_TEXT('g57', 4)],
  ['g58', OFFSET_TEXT('g58', 5)],
  ['g59', OFFSET_TEXT('g59', 6)],
  ['g28', { title: 'G28 position', explanation: 'The stored position that G28 moves to.' }],
  ['g30', { title: 'G30 position', explanation: 'The stored position that G30 moves to.' }],
];

/** The settings groups of a dialect that may be read, with their explanations. A dialect without a table or allowlist has none. */
export function settingsReadGroups(dialectId: string): readonly SettingsGroup[] {
  let table: HilTable;
  try {
    table = settingsSchemaFor(dialectId).table;
  } catch {
    return [];
  }
  return groupsOf(table, (token) => isReadAllowed(dialectId, token));
}

/** The groups of `table` that `allowed` lets the app read and that have members (exported for tests). */
export function groupsOf(table: HilTable, allowed: (token: string) => boolean): readonly SettingsGroup[] {
  const out: SettingsGroup[] = [];
  for (const [token, text] of GROUP_TEXT) {
    if (!allowed(token)) continue;
    const members = table.members(token);
    if (members.length === 0) continue;
    const persisted = members.some((m) => table.tokens.get(m)?.persist === true);
    out.push(Object.freeze({ token, title: text.title, explanation: text.explanation, members: Object.freeze([...members]), persisted }));
  }
  return Object.freeze(out);
}

export type SettingValue = number | string;
export type BoardSettings = Readonly<Record<string, SettingValue>>;

/** One read answer, as the session snapshot carries it (`values[token]`). */
export interface GroupAnswer {
  readonly value: unknown;
  readonly status: number;
}

export interface BoardSettingsRead {
  /** Member token → reported value, for every member of every group that answered with status 0. */
  readonly settings: BoardSettings;
  /** Groups not read yet, or answered with an error: the read is incomplete and no hash is taken. */
  readonly missing: readonly string[];
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The table token for member key `key` of `group`, or undefined when the table has no such member. */
function memberToken(table: HilTable, group: string, key: string): string | undefined {
  for (const candidate of [`${group}${key}`, key]) {
    if (table.tokens.get(candidate)?.group === group) return candidate;
  }
  return undefined;
}

/** Flattens the group answers in `values` into table tokens. */
export function boardSettingsFrom(dialectId: string, values: Readonly<Record<string, GroupAnswer | undefined>>): BoardSettingsRead {
  const groups = settingsReadGroups(dialectId);
  const settings: Record<string, SettingValue> = {};
  const missing: string[] = [];
  if (groups.length === 0) return Object.freeze({ settings: Object.freeze(settings), missing: Object.freeze(missing) });
  const table = settingsSchemaFor(dialectId).table;
  for (const g of groups) {
    const answer = values[g.token];
    if (answer === undefined || answer.status !== 0 || !isRecord(answer.value)) {
      missing.push(g.token);
      continue;
    }
    for (const [key, v] of Object.entries(answer.value)) {
      const token = memberToken(table, g.token, key);
      if (token === undefined) continue;
      if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string') settings[token] = v;
    }
  }
  return Object.freeze({ settings: Object.freeze(settings), missing: Object.freeze(missing) });
}

/** The canonical text `deviceHash` is taken over: the dialect, then the persisted settings with sorted keys. */
export function canonicalSettings(dialectId: string, settings: BoardSettings): string {
  const table = settingsSchemaFor(dialectId).table;
  const keys = Object.keys(settings)
    .filter((k) => table.tokens.get(k)?.persist === true)
    .sort();
  return JSON.stringify([dialectId, keys.map((k) => [k, settings[k]])]);
}

/** SHA-256 (lower-case hex) of `canonicalSettings` (RUN_PLAN §7.2 step 4). WebCrypto only. */
export async function deviceHash(dialectId: string, settings: BoardSettings): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSettings(dialectId, settings));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** What this browser expected the board to hold. */
export interface ExpectedSettings {
  /** The hash of the last accepted read (or the profile's `settings.deviceHash`); null when there is none. */
  readonly deviceHash: string | null;
  /** The last accepted read, for a key-level diff. */
  readonly settings?: BoardSettings;
  /** A profile draft (`settings.draft`), compared key by key at the table's precision. */
  readonly draft?: Readonly<Record<string, number>>;
}

export interface SettingDiff {
  readonly key: string;
  readonly expected: SettingValue | null;
  readonly board: SettingValue | null;
  readonly source: 'previous' | 'draft';
}

export interface DriftResult {
  readonly drift: boolean;
  /** `hash`: the hash differs; `previous`/`draft`: a key differs. */
  readonly reasons: readonly ('hash' | 'previous' | 'draft')[];
  readonly diffs: readonly SettingDiff[];
}

function sameAtPrecision(a: SettingValue | null, b: SettingValue | null, precision: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    const scale = 10 ** Math.max(0, Math.min(precision, 10));
    return Math.round(a * scale) === Math.round(b * scale);
  }
  return a === b;
}

/**
 * Compares a board read with what was expected (RUN_PLAN §7.2 steps 5-6).
 * Only persisted keys count: live values such as `stat` never drift.
 */
export function settingsDrift(dialectId: string, expected: ExpectedSettings, board: BoardSettings, hash: string): DriftResult {
  const table = settingsSchemaFor(dialectId).table;
  const reasons: DriftResult['reasons'][number][] = [];
  const diffs: SettingDiff[] = [];
  if (expected.deviceHash !== null && expected.deviceHash !== hash) reasons.push('hash');
  const persisted = (k: string): boolean => table.tokens.get(k)?.persist === true;
  if (expected.settings !== undefined) {
    const prev = expected.settings;
    const keys = [...new Set([...Object.keys(prev), ...Object.keys(board)])].filter(persisted).sort();
    for (const key of keys) {
      const was = prev[key] ?? null;
      const now = board[key] ?? null;
      if (was !== now) diffs.push(Object.freeze({ key, expected: was, board: now, source: 'previous' }));
    }
    if (diffs.length > 0) reasons.push('previous');
  }
  if (expected.draft !== undefined) {
    let any = false;
    for (const key of Object.keys(expected.draft).filter(persisted).sort()) {
      const want = expected.draft[key] as number;
      const now = board[key] ?? null;
      if (!sameAtPrecision(want, now, (table.tokens.get(key) as { readonly precision: number }).precision)) {
        diffs.push(Object.freeze({ key, expected: want, board: now, source: 'draft' }));
        any = true;
      }
    }
    if (any) reasons.push('draft');
  }
  return Object.freeze({ drift: reasons.length > 0, reasons: Object.freeze(reasons), diffs: Object.freeze(diffs) });
}
