/**
 * Settings-write planning (SAFETY §4.6, H57-H63, amendment 2026-11-02;
 * WORKSPACE_FEATURES "Restore (PW)").
 *
 * Pure functions the window's apply sequencer and the machine session share:
 *
 * - `planSettingsWrite`: a set of proposed values becomes an ordered,
 *   screened plan. Values equal to the board at the table's precision are
 *   dropped (nothing to write). The rest go through `screenWritePlan`
 *   (forbidden keys, reviewed overlay, ranges, enums, cross-key travel and
 *   switch rules), and a refusal refuses the whole plan.
 * - `orderWrites`: communication settings change how the board answers, so
 *   they go last (`js ee ec ej ex rxm`), and `jv` very last (firmware
 *   maintainer, 2026-11-02). Today none of them is writable (no overlay
 *   entry, and `ej ex rxm jv` are forbidden writes), so the rule is
 *   defence in depth for when one becomes writable.
 * - `changeRisk`: which changes are high-risk, and the consequence the
 *   confirmation names in plain words.
 * - `readBackMatches`: a read-back equals the written value at the table's
 *   precision.
 * - `restoreChanges`: a backup becomes proposed values by token name,
 *   skipping identity, read-only, forbidden and unreviewed keys, each with
 *   its reason.
 *
 * Values are millimetre units: the session refuses to write unless the board
 * reports `unit` = 1 (G21) right before each write (SAFETY §4.6 step 5 as
 * amended).
 */
import { forbiddenWriteReason, isForbiddenKey } from './forbiddenWrites.ts';
import type { SettingValue } from './settingsRead.ts';
import { settingsSchemaFor, type SettingDef } from './settingsSchema.ts';
import { setterClass } from './tables/accessors.ts';
import type { Issue } from './validate.ts';
import { screenWritePlan } from './writePlan.ts';

/** Communication settings, written after everything else, in this order (they change how the board answers). */
export const COMMS_KEYS: readonly string[] = Object.freeze(['js', 'ee', 'ec', 'ej', 'ex', 'rxm']);
/** Written very last of all. */
export const COMMS_LAST = 'jv';

/** Never written by a restore or an edit, whatever a backup holds (firmware maintainer, 2026-11-02; PN §12.4). */
export const IDENTITY_KEYS: readonly string[] = Object.freeze(['fb', 'fbs', 'fv', 'hp', 'hv', 'id', 'baud']);

/** Read-only readouts that are never written (they report outputs, they are not settings). */
export const READOUT_KEYS: readonly string[] = Object.freeze(['spe', 'spc', 'spd', 'sps', 'cof', 'com']);

export function isCommsKey(key: string): boolean {
  return key === COMMS_LAST || COMMS_KEYS.includes(key);
}

/** Stable order: every other key first (as given), then `js ee ec ej ex rxm` in that order, then `jv`. */
export function orderWrites<T extends { readonly key: string }>(items: readonly T[]): T[] {
  const rank = (key: string): number => (key === COMMS_LAST ? COMMS_KEYS.length + 1 : COMMS_KEYS.includes(key) ? 1 + COMMS_KEYS.indexOf(key) : 0);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.key) - rank(b.item.key) || a.index - b.index)
    .map((x) => x.item);
}

export type RiskCategory = 'switch' | 'homing' | 'motor' | 'motorMap' | 'scale' | 'axisMode' | 'travel' | 'comms' | 'polarity' | 'motion' | 'other';

const AXIS = /^([xyzabc])(.+)$/;
const MOTOR = /^([1-6])(.+)$/;

/** Which kind of change this key is. */
export function categoryOf(key: string): RiskCategory {
  if (isCommsKey(key)) return 'comms';
  if (key === 'st') return 'switch';
  if (key === 'sl') return 'travel';
  if (key === 'spep' || key === 'spdp' || key === 'prbp') return 'polarity';
  const m = MOTOR.exec(key);
  if (m !== null) {
    const f = m[2] as string;
    if (f === 'po' || f === 'pm' || f === 'pl') return 'motor';
    if (f === 'ma') return 'motorMap';
    if (f === 'sa' || f === 'tr' || f === 'mi') return 'scale';
    return 'other';
  }
  const a = AXIS.exec(key);
  if (a !== null) {
    const f = a[2] as string;
    if (f === 'sn' || f === 'sx') return 'switch';
    if (f === 'sv' || f === 'lv' || f === 'lb' || f === 'zb' || f === 'jh') return 'homing';
    if (f === 'am') return 'axisMode';
    if (f === 'tn' || f === 'tm') return 'travel';
    if (f === 'vm' || f === 'fr' || f === 'jm' || f === 'jd' || f === 'ra') return 'motion';
  }
  return 'other';
}

/** The categories that always need the high-risk confirmation (SAFETY §4.6 typed C5, H57-H63). */
export const HIGH_RISK_CATEGORIES: ReadonlySet<RiskCategory> = new Set(['switch', 'homing', 'motor', 'motorMap', 'axisMode', 'travel', 'comms', 'polarity']);

export interface ChangeRisk {
  readonly category: RiskCategory;
  readonly highRisk: boolean;
  /** What can go wrong, in plain words, named in the confirmation. Null when not high-risk. */
  readonly consequence: string | null;
  /** W20 after the write, until commissioning (SAFETY §4.6 step 9). */
  readonly afterWrite: 'W20' | null;
}

function label(def: SettingDef | undefined, key: string): string {
  return def?.overlay?.label ?? key;
}

/** A value in plain words: the enum label when there is one, else the number and unit. */
export function valueWords(def: SettingDef | undefined, value: SettingValue | null | undefined): string {
  if (value === undefined || value === null) return 'not read';
  if (typeof value !== 'number') return String(value);
  const named = def?.overlay?.values?.find((v) => v.value === value)?.label;
  if (named !== undefined) return named;
  const unit = def?.overlay?.unit;
  const shown = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  return unit === undefined || unit === 'enum' || unit === 'microsteps' ? shown : `${shown} ${unit}`;
}

function switchName(key: string): string {
  const axis = key[0]?.toUpperCase() ?? '?';
  return `${axis}-${key.endsWith('sn') ? 'min' : 'max'}`;
}

/** The consequence text for a high-risk change (SAFETY H57-H63). */
function consequenceFor(category: RiskCategory, key: string, def: SettingDef | undefined, from: SettingValue | undefined, to: number): string {
  const was = valueWords(def, from);
  const now = valueWords(def, to);
  switch (category) {
    case 'switch':
      if (key === 'st') {
        return `Changing the switch type from ${was} to ${now} when the switches are wired the other way means every switch reads as always pressed or never pressed: limits may not stop the machine and homing may not find its switch. Test each switch after applying.`;
      }
      return `Changing the ${switchName(key)} switch from ${was} to ${now} changes whether it stops the machine at the end of travel or is used for homing. A limit that is turned off no longer stops the machine there. Test this switch after applying.`;
    case 'homing':
      return `${label(def, key)} changes from ${was} to ${now}. Homing uses it: a wrong value can drive the axis hard into its switch or end stop, or back off too far. Home with your hand on the E-stop after applying.`;
    case 'motor': {
      const n = key[0];
      if (key.endsWith('po')) return `Motor ${n} will turn the other way, so the axis it drives moves in the opposite direction, including during homing. Check the direction with a 1 mm move, hand on the E-stop, after applying.`;
      return `${label(def, key)} changes from ${was} to ${now}. It decides when motor ${n} holds its position: an axis that can fall (Z) may drop when its motor is not powered, and a motor left powered can run hot.`;
    }
    case 'motorMap':
      return `Motor ${key[0]} will drive ${now} instead of ${was}. Commands for one axis will move another. Check every axis with a 1 mm move after applying.`;
    case 'axisMode':
      return `${label(def, key)} changes from ${was} to ${now}. A disabled or inhibited axis does not move when commanded, and a rotary axis in radius mode reads its moves in linear units: G-code that worked before can move differently.`;
    case 'travel':
      if (key === 'sl') return `Soft limits change from ${was} to ${now}. With soft limits off, the machine can be commanded past its travel.`;
      return `${label(def, key)} changes from ${was} to ${now}. It sets the soft limit and the homing search distance: a wrong value lets the machine run past its end, or stop short. Home and check the travel after applying.`;
    case 'comms':
      return `${label(def, key)} changes how the board answers Run. A wrong value can stop Run from understanding the board, and other senders may stop working. It is written last.`;
    case 'polarity':
      return `${label(def, key)} changes from ${was} to ${now}. If it does not match the wiring, the output (spindle, VFD enable or probe) is ON when Run believes it is OFF. Keep spindle and VFD mains off and check the output LED after applying.`;
    default:
      return `${label(def, key)} changes from ${was} to ${now}.`;
  }
}

/** The risk of changing `key` from `from` to `to` on this dialect. */
export function changeRisk(dialectId: string, key: string, from: SettingValue | undefined, to: number): ChangeRisk {
  const def = safeSchema(dialectId)?.settings.get(key);
  const category = categoryOf(key);
  const o = def?.overlay;
  const typed = o?.typedConfirm;
  const typedNow =
    typed === undefined
      ? false
      : typed.kind === 'always' ||
        (typed.kind === 'whenValue' && typed.value === to) ||
        (typed.kind === 'increaseFactor' && typeof from === 'number' && from > 0 && to >= from * typed.factor);
  const highRisk = HIGH_RISK_CATEGORIES.has(category) || o?.risk === 'polarity' || typedNow;
  return Object.freeze({
    category,
    highRisk,
    consequence: highRisk ? consequenceFor(category, key, def, from, to) : null,
    afterWrite: o?.afterWrite ?? null,
  });
}

function safeSchema(dialectId: string): ReturnType<typeof settingsSchemaFor> | null {
  try {
    return settingsSchemaFor(dialectId);
  } catch {
    return null;
  }
}

/** Two values equal at the table precision of `key` (strings compare exactly). */
export function sameSetting(dialectId: string, key: string, a: SettingValue | null | undefined, b: SettingValue | null | undefined): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') {
    const precision = safeSchema(dialectId)?.table.tokens.get(key)?.precision ?? 3;
    const scale = 10 ** Math.max(0, Math.min(precision, 10));
    return Math.round(a * scale) === Math.round(b * scale);
  }
  return a === b;
}

/** The read-back equals what was written, at the table's precision. */
export function readBackMatches(dialectId: string, key: string, written: number, readBack: unknown): boolean {
  return typeof readBack === 'number' && Number.isFinite(readBack) && sameSetting(dialectId, key, written, readBack);
}

export interface PlannedChange {
  readonly key: string;
  readonly label: string;
  readonly from: SettingValue | null;
  readonly to: number;
  /** "1.8 deg/step → 0.9 deg/step" */
  readonly words: string;
  readonly risk: ChangeRisk;
}

export type SettingsPlan = { readonly ok: true; readonly changes: readonly PlannedChange[] } | { readonly ok: false; readonly refused: readonly Issue[] };

export interface ProposedValue {
  readonly key: string;
  readonly value: number;
}

/**
 * Screens and orders proposed values against the board. Values equal to the
 * board are dropped; any refusal refuses the whole plan (writePlan.ts).
 */
export function planSettingsWrite(dialectId: string, proposed: readonly ProposedValue[], board: Readonly<Record<string, SettingValue>>): SettingsPlan {
  const schema = safeSchema(dialectId);
  if (schema === null) return { ok: false, refused: [{ key: '*', code: 'readOnlyDialect', message: `No settings schema for ${dialectId}: nothing is written.` }] };
  const changed = proposed.filter((p) => !sameSetting(dialectId, p.key, p.value, board[p.key]));
  const screened = screenWritePlan(changed, schema, { base: board });
  if (!screened.ok) return { ok: false, refused: screened.refused };
  const changes = orderWrites(screened.writes).map((w): PlannedChange => {
    const def = schema.settings.get(w.key);
    const from = board[w.key] ?? null;
    return Object.freeze({
      key: w.key,
      label: label(def, w.key),
      from,
      to: w.value,
      words: `${valueWords(def, from)} → ${valueWords(def, w.value)}`,
      risk: changeRisk(dialectId, w.key, from ?? undefined, w.value),
    });
  });
  return { ok: true, changes: Object.freeze(changes) };
}

export interface RestoreSkip {
  readonly key: string;
  readonly reason: string;
}

export interface RestoreChanges {
  /** Proposed values that differ from the board, by token name. */
  readonly changes: readonly ProposedValue[];
  /** Keys in the backup that equal the board. */
  readonly same: number;
  readonly skipped: readonly RestoreSkip[];
}

/**
 * A backup's tokens as proposed values, by token name (so an older backup
 * maps onto newer firmware), skipping what is never written.
 */
export function restoreChanges(dialectId: string, tokens: Readonly<Record<string, unknown>>, board: Readonly<Record<string, SettingValue>>): RestoreChanges {
  const schema = safeSchema(dialectId);
  const changes: ProposedValue[] = [];
  const skipped: RestoreSkip[] = [];
  let same = 0;
  for (const key of Object.keys(tokens).sort()) {
    const value = tokens[key];
    if (IDENTITY_KEYS.includes(key)) {
      skipped.push({ key, reason: 'identity: never written' });
      continue;
    }
    if (READOUT_KEYS.includes(key) || key === 'rt' || key.startsWith('rt')) {
      skipped.push({ key, reason: 'read-only readout: never written' });
      continue;
    }
    if (schema === null) {
      skipped.push({ key, reason: `no settings schema for ${dialectId}` });
      continue;
    }
    if (isForbiddenKey(schema.forbidden, key) && forbiddenWriteReason(schema.forbidden, key, value) !== null) {
      skipped.push({ key, reason: 'never written by Run (forbidden write)' });
      continue;
    }
    const def = schema.settings.get(key);
    if (def === undefined) {
      skipped.push({ key, reason: 'not a setting on this firmware' });
      continue;
    }
    if (setterClass(def.setter) !== 'value' || def.persist !== true) {
      skipped.push({ key, reason: 'read-only: not a stored setting' });
      continue;
    }
    if (def.overlay === undefined) {
      skipped.push({ key, reason: 'not reviewed for writing yet' });
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      skipped.push({ key, reason: 'the backup value is not a number' });
      continue;
    }
    if (sameSetting(dialectId, key, value, board[key])) {
      same += 1;
      continue;
    }
    changes.push({ key, value });
  }
  return { changes: Object.freeze(changes), same, skipped: Object.freeze(skipped) };
}
