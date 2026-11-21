/**
 * The Axes tab as data (Board settings spec §5.6). Pure: one card per axis (open for the machine's axes and any
 * axis whose mode is not Off; B and C, or any unused axis that is Off, collapse into one line), each card's summary,
 * its travel rules in words (soft limits, equal ends, a disabled end, the homing search per the firmware's
 * `homingTravel` rule), its homing switch from Inputs, and one line for a mode other than Standard.
 */
import { firmwareTravelEqual, travelSemanticsFor, type SettingValue, type SettingsFile } from '@synthetos/schema';
import { motorFor } from '../../boardFacts.ts';
import { numberWords, unitWords } from '../../settings/units.ts';

type Settings = Readonly<Record<string, SettingValue>>;
type Axis = 'x' | 'y' | 'z' | 'a' | 'b' | 'c';

export interface AxisCard {
  readonly axis: Axis;
  readonly rotary: boolean;
  readonly mode: number | null;
  readonly open: boolean;
  readonly summary: string;
  readonly travelLine: string;
  readonly homingLine: string;
  readonly modeLine: string | null;
  readonly motor: number | null;
}

const AXES: readonly Axis[] = ['x', 'y', 'z', 'a', 'b', 'c'];
const DISABLE_SOFT_LIMIT = -1_000_000;

/** The board the cards describe: its dialect (travel rules) and whether it reports lengths in inches (G20). */
export interface AxisContext {
  readonly dialectId: string;
  readonly inches?: boolean;
}
const num = (s: Settings, k: string): number | null => (typeof s[k] === 'number' ? (s[k] as number) : null);
const isHoming = (m: number | null): boolean => m === 1 || m === 3;
const lowerFirst = (t: string): string => t.charAt(0).toLowerCase() + t.slice(1);

function homingEnd(s: Settings, a: string): 'min' | 'max' | 'both' | null {
  const min = isHoming(num(s, `${a}sn`));
  const max = isHoming(num(s, `${a}sx`));
  if (min && max) return 'both';
  return min ? 'min' : max ? 'max' : null;
}

function equalEnds(dialectId: string, lo: number, hi: number): boolean {
  const sem = travelSemanticsFor(dialectId);
  return sem === undefined ? lo === hi : firmwareTravelEqual(sem, lo, hi);
}

/** The value label of an enumerated setting, or null. */
function label(defs: SettingsFile, key: string, v: number | null): string | null {
  return defs.tokens.get(key)?.values?.find((x) => x.value === v)?.label ?? null;
}

/** The unit of a token as the board reports it: a length (`convert`) in inches when the board reports G20. */
function unitOf(defs: SettingsFile, key: string, ctx: AxisContext): string {
  const d = defs.tokens.get(key);
  return unitWords(d?.unit, ctx.inches === true && d?.convert === true);
}

function searchLine(defs: SettingsFile, s: Settings, a: string, ctx: AxisContext & { readonly equal: boolean }): string {
  const { equal } = ctx;
  const lb = num(s, `${a}lb`) ?? 0;
  const u = unitOf(defs, `${a}tn`, ctx);
  const amount = (n: number): string => (u.startsWith('°') ? `${numberWords(n)}${u}` : `${numberWords(n)} ${u}`);
  if (!equal) return `Homing searches ${amount(Math.abs((num(s, `${a}tm`) ?? 0) - (num(s, `${a}tn`) ?? 0)) + lb)}.`;
  if (defs.homingTravel?.rule === 'radiusFullTurn' && num(s, `${a}am`) === 3) return 'Homing searches one full turn.';
  if (lb === 0) return 'Homing will stop with an error: the search distance is 0.';
  const here = defs.homingTravel?.rule === 'backoffOnly' ? ' on this firmware' : '';
  return `Homing searches only ${amount(lb)}: start and end are the same${here}. Set a travel range before homing ${a.toUpperCase()}.`;
}

function limitSentence(s: Settings, tn: number | null, tm: number | null, equal: boolean): string | null {
  if (num(s, 'sl') === 0) return 'Soft limits are off, so these ends are not checked.';
  if (equal) return 'No travel limit: the axis turns freely. Start and end are the same, so the board never checks this axis.';
  if ((tn !== null && tn <= DISABLE_SOFT_LIMIT) || (tm !== null && tm <= DISABLE_SOFT_LIMIT)) return 'No limit at this end.';
  return null;
}

/** What the board does with an axis's travel, in words (spec §5.6 travel rules). */
export function travelLine(defs: SettingsFile, planned: Settings, axis: string, ctx: AxisContext): string {
  const tn = num(planned, `${axis}tn`);
  const tm = num(planned, `${axis}tm`);
  const equal = tn !== null && tm !== null && equalEnds(ctx.dialectId, tn, tm);
  const end = homingEnd(planned, axis);
  const parts = [limitSentence(planned, tn, tm, equal), end === 'min' || end === 'max' ? searchLine(defs, planned, axis, { ...ctx, equal }) : null];
  return parts.filter((p): p is string => p !== null).join(' ');
}

function homingLine(defs: SettingsFile, s: Settings, a: string): string {
  const end = homingEnd(s, a);
  if (end === 'both') return 'Homes on both ends.';
  if (end === null) return 'No homing switch.';
  const input = defs.inputs.find((i) => i.function === `${a}s${end === 'min' ? 'n' : 'x'}`);
  return input === undefined ? `Homes towards ${end}.` : `Homes towards ${end} at the ${input.label}, ${input.pin}.`;
}

function modeLine(defs: SettingsFile, s: Settings, a: string): string | null {
  const mode = num(s, `${a}am`);
  if (mode === null || mode === 1) return null;
  const v = defs.tokens.get(`${a}am`)?.values?.find((x) => x.value === mode);
  return v === undefined ? null : `${v.label}${v.help === undefined ? '' : `: ${lowerFirst(v.help)}`}`;
}

function summaryOf(defs: SettingsFile, s: Settings, a: Axis, ctx: AxisContext): string {
  const rotary = a === 'a' || a === 'b' || a === 'c';
  const mode = label(defs, `${a}am`, num(s, `${a}am`)) ?? 'Mode not read';
  const u = unitOf(defs, `${a}tn`, ctx);
  const tn = num(s, `${a}tn`);
  const tm = num(s, `${a}tm`);
  const vm = num(s, `${a}vm`);
  const end = homingEnd(s, a);
  return [
    `${a.toUpperCase()} axis`,
    rotary ? `Rotary, ${lowerFirst(mode)}` : mode,
    tn === null || tm === null ? null : tn === tm ? 'no travel limit' : `${numberWords(tn)} to ${numberWords(tm)} ${u}`.replace(' °', '°'),
    vm === null ? null : `${numberWords(vm)} ${unitOf(defs, `${a}vm`, ctx)}`,
    end === null ? 'no homing switch' : end === 'both' ? 'homes on both ends' : `homes towards ${end}`,
  ].filter((p): p is string => p !== null).join(' · ');
}

/** A card for an axis that is listed (the machine uses it, or its mode is not Off): it starts open on a wide window. */
function cardOf(defs: SettingsFile, s: Settings, a: Axis, ctx: AxisContext): AxisCard {
  return {
    axis: a,
    rotary: a === 'a' || a === 'b' || a === 'c',
    mode: num(s, `${a}am`),
    open: true,
    summary: summaryOf(defs, s, a, ctx),
    travelLine: travelLine(defs, s, a, ctx),
    homingLine: homingLine(defs, s, a),
    modeLine: modeLine(defs, s, a),
    motor: motorFor(s, a).motor,
  };
}

export function axisCards(defs: SettingsFile, planned: Settings, machineAxes: readonly string[], ctx: AxisContext): { readonly cards: readonly AxisCard[]; readonly collapsedOff: readonly string[] } {
  const axes = AXES.filter((a) => defs.tokens.has(`${a}am`));
  const used = (a: Axis): boolean => machineAxes.includes(a) || (num(planned, `${a}am`) ?? 0) !== 0;
  return {
    cards: axes.filter(used).map((a) => cardOf(defs, planned, a, ctx)),
    collapsedOff: axes.filter((a) => !used(a)),
  };
}
