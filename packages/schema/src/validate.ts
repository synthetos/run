/**
 * `validate(draft, schema)`: checks a settings draft before any write plan is
 * built (ROADMAP P0-09; old P0-10; SAFETY §4.6).
 *
 * Per key: the dialect is writable, the key is not a forbidden write, it is
 * a canonical token of the table, its setter stores a value, it has a
 * reviewed overlay entry, and its value has the right type, is finite, is
 * above the E158 minimum, is in range, is one of the enumerated values and is
 * one the hardware supports (`mi` ∈ {1, 2, 4, 8}).
 *
 * Across keys (TinyG): `tn < tm` on every axis whose travel the draft
 * changes; when the draft changes any switch mode, all 8 switch modes must be
 * known, no axis may have a homing switch on both ends, at most one probe
 * input on X/Y/Z and none on A; and `st` must match the switch type the
 * machine declares, when it declares one.
 *
 * Cross-key rules read the draft over `ctx.base` (the values read from the
 * board). A value the rule needs that is in neither is an error, never a
 * guess. Values are in millimetre units: every write happens under G21
 * (SAFETY §4.6 step 5).
 */
import { forbiddenWriteReason } from './forbiddenWrites.ts';
import type { SettingsSchema } from './settingsSchema.ts';
import { setterClass } from './tables/accessors.ts';

export type IssueCode =
  | 'readOnlyDialect'
  | 'forbidden'
  | 'unknownKey'
  | 'nonCanonicalKey'
  | 'notWritable'
  | 'notReviewed'
  | 'type'
  | 'notFinite'
  | 'notInteger'
  | 'belowMinimum'
  | 'range'
  | 'enum'
  | 'hwAllowed'
  | 'travelOrder'
  | 'switchesIncomplete'
  | 'multipleHomingSwitches'
  | 'multipleProbeInputs'
  | 'probeOnRotary'
  | 'switchTypeMismatch'
  | 'crossFieldUnknown'
  | 'duplicateKey';

export interface Issue {
  readonly key: string;
  readonly code: IssueCode;
  readonly message: string;
}

export interface ValidateContext {
  /** Values read from the board (allowlisted reads), for cross-key rules. */
  readonly base?: Readonly<Record<string, unknown>>;
  /** The switch type the machine profile declares (RUN_PLAN §7.2). */
  readonly declaredSwitchType?: 'NO' | 'NC';
}

/** The 8 TinyG switch inputs: min and max on X, Y, Z and A (EN switch.h; config_app.c:284-331). */
export const SWITCH_KEYS = Object.freeze(['xsn', 'xsx', 'ysn', 'ysx', 'zsn', 'zsx', 'asn', 'asx'] as const);
/** Bit 0 of a switch mode is "homing" (EN switch.h:40-45): modes 1 and 3 (the probe mode 4 does not have it). */
const SW_HOMING_BIT = 0x01;
/** Switch mode 4 is "probe" on edge-next (EN switch.h:46). */
const SW_MODE_PROBE = 4;
const TRAVEL_AXES = Object.freeze(['x', 'y', 'z', 'a', 'b', 'c'] as const);

function issue(key: string, code: IssueCode, message: string): Issue {
  return Object.freeze({ key, code, message });
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function ownEntries(record: Readonly<Record<string, unknown>>): [string, unknown][] {
  return Object.keys(record).map((k) => [k, record[k]]);
}

/** Per-key checks. Returns the issues for this key (empty when the value is valid). */
function checkKey(schema: SettingsSchema, key: string, value: unknown): Issue[] {
  if (schema.mode === 'readOnly') return [issue(key, 'readOnlyDialect', `${schema.dialectId} is read-only: nothing is written to this firmware`)];
  const forbidden = forbiddenWriteReason(schema.forbidden, key, value);
  if (forbidden !== null) return [issue(key, 'forbidden', `"${key}" is never written: ${forbidden}`)];
  const def = schema.settings.get(key);
  if (def === undefined) {
    const canonical = key.trim().toLowerCase();
    if (canonical !== key && schema.settings.has(canonical)) {
      return [issue(key, 'nonCanonicalKey', `"${key}" is not how the firmware spells "${canonical}"; keys are written exactly as the table names them`)];
    }
    return [issue(key, 'unknownKey', `"${key}" is not a ${schema.dialectId} setting (table ${schema.table.source.name} @ ${schema.table.source.tableCommit})`)];
  }
  if (setterClass(def.setter) !== 'value') return [issue(key, 'notWritable', `"${key}" is not a stored setting (${def.setter})`)];
  const o = def.overlay;
  if (o === undefined) return [issue(key, 'notReviewed', `"${key}" has no reviewed definition for ${schema.dialectId} yet, so it is not written`)];
  if (typeof value !== 'number') return [issue(key, 'type', `${o.label} must be a number`)];
  if (!Number.isFinite(value)) return [issue(key, 'notFinite', `${o.label} must be a finite number`)];
  if (o.valueType === 'integer' && !Number.isInteger(value)) return [issue(key, 'notInteger', `${o.label} must be a whole number`)];
  if (o.e158 === true && value <= 0) return [issue(key, 'belowMinimum', `${o.label} must be greater than 0 (the firmware refuses it with 108, E158)`)];
  if (o.values !== undefined && !o.values.some((v) => v.value === value)) {
    return [issue(key, 'enum', `${o.label} must be one of ${o.values.map((v) => `${v.value} (${v.label})`).join(', ')}`)];
  }
  const { min, max, minExclusive } = o.range;
  if ((minExclusive === true ? value <= min : value < min) || value > max) {
    return [issue(key, 'range', `${o.label} must be ${minExclusive === true ? 'greater than' : 'at least'} ${min} and at most ${max} ${o.unit}`)];
  }
  if (o.hwAllowed !== undefined && !o.hwAllowed.includes(value)) {
    return [issue(key, 'hwAllowed', `TinyG hardware supports ${o.hwAllowed.join(', ')} for ${o.label.toLowerCase()}`)];
  }
  return [];
}

/** Cross-key rules over the draft (valid values only) on top of the board's values. */
function checkCrossKey(schema: SettingsSchema, valid: ReadonlyMap<string, number>, ctx: ValidateContext): Issue[] {
  const issues: Issue[] = [];
  const known = (key: string): number | undefined => {
    const fromDraft = valid.get(key);
    if (fromDraft !== undefined) return fromDraft;
    const fromBase = ctx.base !== undefined && Object.hasOwn(ctx.base, key) ? ctx.base[key] : undefined;
    return isFiniteNumber(fromBase) ? fromBase : undefined;
  };

  for (const a of TRAVEL_AXES) {
    const tn = `${a}tn`;
    const tm = `${a}tm`;
    if (!valid.has(tn) && !valid.has(tm)) continue;
    const lo = known(tn);
    const hi = known(tm);
    if (lo === undefined || hi === undefined) {
      const missing = lo === undefined ? tn : tm;
      issues.push(issue(missing, 'crossFieldUnknown', `${a.toUpperCase()} travel cannot be checked: "${missing}" is neither in the draft nor read from the board`));
    } else if (!(lo < hi)) {
      for (const key of [tn, tm]) {
        if (valid.has(key)) issues.push(issue(key, 'travelOrder', `${a.toUpperCase()} travel minimum (${lo}) must be less than travel maximum (${hi})`));
      }
    }
  }

  const switchesInSchema = SWITCH_KEYS.every((k) => schema.settings.get(k)?.overlay !== undefined);
  if (switchesInSchema && SWITCH_KEYS.some((k) => valid.has(k))) {
    const modes = new Map<string, number>();
    for (const k of SWITCH_KEYS) {
      const m = known(k);
      if (m === undefined) issues.push(issue(k, 'switchesIncomplete', `all 8 switch modes must be known when any is changed; "${k}" is neither in the draft nor read from the board`));
      else modes.set(k, m);
    }
    if (modes.size === SWITCH_KEYS.length) {
      for (const a of ['x', 'y', 'z', 'a']) {
        const mn = modes.get(`${a}sn`) as number;
        const mx = modes.get(`${a}sx`) as number;
        const homing = (m: number): boolean => (m & SW_HOMING_BIT) !== 0;
        if (homing(mn) && homing(mx)) {
          issues.push(issue(`${a}sn`, 'multipleHomingSwitches', `${a.toUpperCase()} has a homing switch on both ends; homing refuses that axis (EN cycle_homing.c:261, status 246)`));
        }
      }
      const probes = ['xsn', 'xsx', 'ysn', 'ysx', 'zsn', 'zsx'].filter((k) => modes.get(k) === SW_MODE_PROBE);
      if (probes.length > 1) {
        issues.push(issue(probes[1] as string, 'multipleProbeInputs', `only one probe input is allowed; ${probes.join(' and ')} are both set to probe (EN switch.c:292-306, status 253)`));
      }
      for (const k of ['asn', 'asx']) {
        if (modes.get(k) === SW_MODE_PROBE) issues.push(issue(k, 'probeOnRotary', `the probe input cannot be on the A axis (EN switch.c:286-289, status 254)`));
      }
    }
  }

  if (ctx.declaredSwitchType !== undefined && schema.settings.get('st')?.overlay !== undefined) {
    const st = known('st');
    const expected = ctx.declaredSwitchType === 'NC' ? 1 : 0;
    if (st !== undefined && st !== expected) {
      issues.push(
        issue('st', 'switchTypeMismatch', `the machine declares ${ctx.declaredSwitchType} switches, so the switch type must be ${expected} (${ctx.declaredSwitchType === 'NC' ? 'normally closed' : 'normally open'})`),
      );
    }
  }
  return issues;
}

/**
 * Validates a draft (`token → value`). Returns every issue found, in draft
 * key order then cross-key order; an empty list means every key may be
 * written. The draft is read with own keys only.
 */
export function validate(draft: Readonly<Record<string, unknown>>, schema: SettingsSchema, ctx: ValidateContext = {}): readonly Issue[] {
  const issues: Issue[] = [];
  const valid = new Map<string, number>();
  for (const [key, value] of ownEntries(draft)) {
    const keyIssues = checkKey(schema, key, value);
    issues.push(...keyIssues);
    if (keyIssues.length === 0) valid.set(key, value as number);
  }
  if (schema.mode === 'writable') issues.push(...checkCrossKey(schema, valid, ctx));
  return Object.freeze(issues);
}
