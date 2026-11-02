/**
 * The machine session's side of a settings write (SAFETY §4.6, H57-H63,
 * amendment 2026-11-02). Pure helpers the reducer and the write gate share.
 *
 * One write is, in order and one line at a time:
 * 1. the idle gate: polled GETs of `stat`, `hold` (where the dialect trusts
 *    it), `vel`, `qr` and `unit`, answered right before the write. The board
 *    must be at rest (stat idle or end, hold 0, vel 0, the planner empty:
 *    `qr` = plannerBlocks) and in millimetres (`unit` = 1, G21), or nothing
 *    is written;
 * 2. the write, `{"<key>":<value>}` and LF. Its answer is awaited before
 *    anything else is sent: a persisted write stalls the board while EEPROM
 *    is written, and bytes sent meanwhile are lost (firmware maintainer,
 *    2026-11-02). The session never has more than one line unanswered;
 * 3. a read-back GET of the key, compared at the table's precision.
 *
 * Writes are screened per key against the dialect's settings schema
 * (forbidden keys, reviewed overlay, range, enum, cross-key rules over the
 * values this session has read).
 */
import { mapStat, type Dialect, type JsonObject, type JsonValue } from '@synthetos/protocol';
import { boardSettingsFrom, isReadAllowed, readBackMatches, screenWritePlan, settingsSchemaFor, type GroupAnswer, type SettingValue } from '@synthetos/schema';
import type { ReadValue, SettingWriteState } from './types.ts';

/** The gate's polled reads, in the order they are sent. `hold` only where the dialect trusts it. */
export function gateTokens(dialect: Dialect, holdTrusted: boolean): readonly ('stat' | 'hold' | 'vel' | 'qr' | 'unit')[] {
  const all = holdTrusted ? (['stat', 'hold', 'vel', 'qr', 'unit'] as const) : (['stat', 'vel', 'qr', 'unit'] as const);
  return all.filter((t) => isReadAllowed(dialect.id, t));
}

/** A setting value as the JSON number on the wire: plain decimal, no exponent. Null when it cannot be written as one. */
export function wireNumber(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = String(value);
  return /^-?\d{1,12}(\.\d{1,8})?$/.test(text) ? text : null;
}

/** The exact line (without LF) that writes `key` = `value`, or null. */
export function settingLine(key: string, value: number): string | null {
  if (!/^[a-z0-9_]{1,8}$/.test(key)) return null;
  const n = wireNumber(value);
  return n === null ? null : `{"${key}":${n}}`;
}

/** The setting line shape the write gate accepts: one lower-case key, one plain decimal number. */
export const SETTING_LINE = /^\{"([a-z0-9_]{1,8})":(-?\d{1,12}(?:\.\d{1,8})?)\}\n$/;

/**
 * The board's settings as this session has read them: every group read
 * (`values['x']`), with later single-token reads (read-backs) on top.
 */
export function sessionSettings(dialectId: string, values: Readonly<Record<string, ReadValue>>): Readonly<Record<string, SettingValue>> {
  // Called only for a dialect with a settings schema (settingRefusal checks that first).
  const settings: Record<string, SettingValue> = { ...boardSettingsFrom(dialectId, values as Readonly<Record<string, GroupAnswer | undefined>>).settings };
  for (const [key, v] of Object.entries(values)) {
    if (v.status === 0 && (typeof v.value === 'number' || typeof v.value === 'string') && settings[key] !== undefined) settings[key] = v.value;
  }
  return settings;
}

/** Why `key` = `value` may not be written on this dialect, or null. Cross-key rules use what this session read. */
export function settingRefusal(dialectId: string, key: string, value: unknown, values: Readonly<Record<string, ReadValue>>): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'The value is not a number.';
  if (settingLine(key, value) === null) return 'The value cannot be written as a plain decimal number.';
  let schema;
  try {
    schema = settingsSchemaFor(dialectId);
  } catch {
    return `This firmware (${dialectId}) has no settings schema, so nothing is written to it.`;
  }
  const screened = screenWritePlan([{ key, value }], schema, { base: sessionSettings(dialectId, values) });
  if (screened.ok) return null;
  return screened.refused.map((i) => i.message).join('; ');
}

export interface GateVerdict {
  readonly ok: boolean;
  /** Plain words for the window when the gate fails. */
  readonly detail: string;
}

/** Decides the idle gate from its polled answers. */
export function judgeGate(dialect: Dialect, gate: SettingWriteState['gate'], holdTrusted: boolean): GateVerdict {
  const problems: string[] = [];
  const stat = gate.stat;
  if (stat === undefined) problems.push('its state (stat) could not be read');
  else {
    const cls = mapStat(dialect, stat);
    if (cls !== 'idle' && cls !== 'end') problems.push(`it is ${cls} (stat ${stat}), not idle`);
  }
  if (holdTrusted && gate.hold !== 0) problems.push(gate.hold === undefined ? 'its hold state could not be read' : `it is holding (hold ${gate.hold})`);
  if (gate.vel !== 0) problems.push(gate.vel === undefined ? 'its velocity could not be read' : `it is moving (velocity ${gate.vel})`);
  if (gate.qr !== dialect.limits.plannerBlocks) problems.push(gate.qr === undefined ? 'its planner queue could not be read' : `it has moves queued (${gate.qr} of ${dialect.limits.plannerBlocks} planner buffers free)`);
  if (gate.unit !== 1) problems.push(gate.unit === undefined ? 'its units could not be read' : 'it is working in inches (G20); settings are written only in millimetres (G21)');
  if (problems.length === 0) return { ok: true, detail: '' };
  return { ok: false, detail: `Not written: the board must be idle, with nothing queued and in millimetres, but ${problems.join(', ')}.` };
}

/** The read-back value of `key` from a GET answer `r`. */
export function readBackValue(r: JsonObject, key: string): JsonValue | null {
  const v = r[key];
  return v === undefined ? null : v;
}

export { readBackMatches };
