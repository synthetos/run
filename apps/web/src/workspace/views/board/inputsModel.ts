/**
 * The Inputs tab as data (Board settings spec §5.4). Pure: rows from the
 * settings file's `inputs`, the homing summary (which end each axis homes
 * towards, and at which pin), and the consequences of the planned switch
 * modes: a limit turned off, homing on both ends, an enabled axis left
 * without a homing switch, a second probe, a probe where the firmware refuses
 * one (`probeAllowed`).
 */
import type { SettingValue, SettingsFile } from '@synthetos/schema';

type Settings = Readonly<Record<string, SettingValue>>;
type Drafts = Readonly<Record<string, number>>;

export interface InputRow {
  readonly id: string;
  readonly label: string;
  readonly pin: string;
  readonly functionKey: string;
  readonly board: number | null;
  readonly planned: number | null;
  readonly pending: boolean;
  readonly state: 'pressed' | 'released' | 'off' | null;
}

const PROBE = 4;
const num = (s: Settings, k: string): number | null => (typeof s[k] === 'number' ? (s[k] as number) : null);
const isHoming = (m: number | null): boolean => m === 1 || m === 3;
const isLimit = (m: number | null): boolean => m === 2 || m === 3;
const STATES: Readonly<Record<number, InputRow['state']>> = { [-1]: 'off', 0: 'released', 1: 'pressed' };

/** The axis letter and end of a switch-mode token (`xsn` → x, min). */
function switchOf(key: string): { readonly axis: string; readonly end: 'min' | 'max' } | null {
  const m = /^([a-z])s([nx])$/.exec(key);
  return m === null ? null : { axis: m[1] as string, end: m[2] === 'n' ? 'min' : 'max' };
}

export function inputRows(defs: SettingsFile, settings: Settings, drafts: Drafts, states?: Readonly<Record<string, number>>): readonly InputRow[] {
  return defs.inputs.map((i) => {
    const board = num(settings, i.function);
    const draft = drafts[i.function];
    const raw = states !== undefined && i.state !== undefined ? states[i.state] : undefined;
    return {
      id: i.id,
      label: i.label,
      pin: i.pin,
      functionKey: i.function,
      board,
      planned: draft ?? board,
      pending: draft !== undefined,
      state: raw === undefined ? null : (STATES[raw] ?? null),
    };
  });
}

function pinOf(defs: SettingsFile, key: string): string {
  return defs.inputs.find((i) => i.function === key)?.pin ?? '';
}

export function homingSummary(defs: SettingsFile, planned: Settings, axes: readonly string[]): readonly { readonly axis: string; readonly text: string }[] {
  return axes.map((a) => {
    const A = a.toUpperCase();
    const min = isHoming(num(planned, `${a}sn`));
    const max = isHoming(num(planned, `${a}sx`));
    if (min && max) return { axis: a, text: `${A} homes on both ends` };
    if (min) return { axis: a, text: `${A} homes towards min · ${pinOf(defs, `${a}sn`)}` };
    if (max) return { axis: a, text: `${A} homes towards max · ${pinOf(defs, `${a}sx`)}` };
    return { axis: a, text: `${A} no homing switch` };
  });
}

function limitLines(defs: SettingsFile, board: Settings, planned: Settings): string[] {
  return defs.inputs.flatMap((i) => {
    const sw = switchOf(i.function);
    if (sw === null || !isLimit(num(board, i.function)) || isLimit(num(planned, i.function))) return [];
    const A = sw.axis.toUpperCase();
    return [`${i.label} is no longer a limit. Only soft limits stop ${A} at the ${sw.end === 'max' ? 'far' : 'near'} end.`];
  });
}

function axesOf(defs: SettingsFile): string[] {
  return [...new Set(defs.inputs.map((i) => switchOf(i.function)?.axis).filter((a): a is string => a !== undefined))];
}

function homingLines(defs: SettingsFile, planned: Settings): string[] {
  return axesOf(defs).flatMap((a) => {
    const A = a.toUpperCase();
    const min = isHoming(num(planned, `${a}sn`));
    const max = isHoming(num(planned, `${a}sx`));
    if (min && max) return [`${A} can't home on both ends. Choose one.`];
    const am = num(planned, `${a}am`);
    return !min && !max && am !== null && am !== 0 ? [`${A} has no homing switch. Home all skips ${A}.`] : [];
  });
}

function probeLines(defs: SettingsFile, planned: Settings): string[] {
  const probes = defs.inputs.filter((i) => num(planned, i.function) === PROBE);
  const out: string[] = [];
  if (probes.length > 1) out.push('Only one input can be the probe.');
  const allowed = defs.probeAllowed;
  if (allowed !== undefined && probes.some((i) => !allowed.includes(switchOf(i.function)?.axis ?? ''))) {
    const names = allowed.map((a) => a.toUpperCase());
    out.push(`A probe is allowed only on ${names.slice(0, -1).join(', ')} or ${names[names.length - 1] ?? ''} on this firmware.`);
  }
  return out;
}

/** One line per consequence the rules find in the planned switch modes. */
export function inputConsequences(defs: SettingsFile, board: Settings, planned: Settings): readonly string[] {
  return [...limitLines(defs, board, planned), ...homingLines(defs, planned), ...probeLines(defs, planned)];
}
