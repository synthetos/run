/**
 * The board as data for the Board and Machines views: what each setting
 * means in plain words (the reviewed overlay, with the raw key kept as
 * secondary text), the TinyG v8 connector pins from the generated board
 * definition (RUN_PLAN rule 6: derived facts only, nothing invented), and the
 * proposed settings draft.
 *
 * The draft is a proposal kept in this browser. Writing settings is a later,
 * separately reviewed phase: nothing here reaches the board.
 */
import { computed } from '@preact/signals';
import { BOARD_DEFINITIONS, settingsSchemaFor, type BoardDefinition, type SettingValue } from '@synthetos/schema';
import { boardElectrical } from '@synthetos/wiring';
import { valueText } from '../machine-ui/SettingsView.ts';
import { connected, type LiveView } from './model.ts';
import { isObject, stored } from './storage.ts';

export const AXIS_NAMES = ['X', 'Y', 'Z', 'A', 'B', 'C'] as const;
export const MOTORS = [1, 2, 3, 4] as const;

/** Labels for the keys the overlay does not describe (sys group); values of these are shown as read. */
const PLAIN_LABEL: Readonly<Record<string, string>> = {
  baud: 'Serial baud setting',
  ex: 'Flow control',
  ec: 'Expand line feed to CR LF',
  ee: 'Echo',
  ej: 'JSON mode',
  jv: 'JSON verbosity',
  js: 'JSON syntax',
  qv: 'Queue report verbosity',
  sv: 'Status report verbosity',
  si: 'Status report interval',
  tv: 'Text verbosity',
  ct: 'Chordal tolerance',
  ja: 'Junction acceleration',
  coph: 'Coolant output polarity',
  spph: 'Spindle PWM polarity',
  spde: 'Spindle direction delay',
  gpl: 'Default plane',
  gco: 'Default coordinate system',
  gpa: 'Default path control',
  fb: 'Firmware build',
  fv: 'Firmware version',
  hp: 'Hardware platform',
  hv: 'Hardware version',
  id: 'Board id',
  rxm: 'Receive mode',
  p1frq: 'PWM frequency',
  p1csl: 'CW speed, low end',
  p1csh: 'CW speed, high end',
  p1cpl: 'CW duty at low speed',
  p1cph: 'CW duty at high speed',
  p1wsl: 'CCW speed, low end',
  p1wsh: 'CCW speed, high end',
  p1wpl: 'CCW duty at low speed',
  p1wph: 'CCW duty at high speed',
  p1pof: 'Duty when off',
};

/** Plain-words values for keys the repository documents (session types.ts: `ex` 0 off, 1 XON/XOFF, 2 RTS/CTS). */
const PLAIN_VALUES: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  ex: { 0: 'off', 1: 'XON/XOFF', 2: 'RTS/CTS' },
};

/** Keys this firmware holds reserved: they answer "reserved" and cannot be set (den.json `_reserved_hold_setting`). */
export const RESERVED = new Set(['coph', 'spph', 'spde']);

export interface SettingMeta {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly description: string;
  /** Allowed enumerated values, when the overlay lists them. */
  readonly values: readonly { readonly value: number; readonly label: string }[] | null;
  readonly hwAllowed: readonly number[] | null;
}

function defs(dialect: string | null): ReturnType<typeof settingsSchemaFor>['settings'] | null {
  try {
    return settingsSchemaFor(dialect ?? 'tinyg-en').settings;
  } catch {
    return null;
  }
}

export function settingMeta(key: string, dialect: string | null = null): SettingMeta {
  const o = defs(dialect)?.get(key)?.overlay;
  return {
    key,
    label: o?.label ?? PLAIN_LABEL[key] ?? key,
    unit: o === undefined || o.unit === 'enum' ? '' : o.unit === 'Mmm/min3' ? 'M mm/min³' : o.unit === 'Mdeg/min3' ? 'M deg/min³' : o.unit === 'microsteps' ? '' : o.unit,
    description: o?.description ?? '',
    values: o?.values ?? null,
    hwAllowed: o?.hwAllowed ?? null,
  };
}

/** A setting's value in plain words: "limit + homing", "normally closed", "1.8 deg/step"; or null when not read. */
export function plainValue(key: string, v: SettingValue | undefined, dialect: string | null = null): string | null {
  if (v === undefined) return null;
  const m = settingMeta(key, dialect);
  if (typeof v === 'number') {
    const named = m.values?.find((e) => e.value === v)?.label ?? PLAIN_VALUES[key]?.[v];
    if (named !== undefined) return named;
    const shown = Number.isInteger(v) ? v.toLocaleString('en-US').replace(/,/g, ' ') : String(Number(v.toFixed(4)));
    return m.unit === '' ? shown : `${shown} ${m.unit}`;
  }
  return valueText(v);
}

/** The settings of the last complete read (empty when none). */
export function settingsOf(view: LiveView | null): Readonly<Record<string, SettingValue>> {
  return view !== null && connected(view) ? view.readout.settings : {};
}

export function dialectOf(view: LiveView | null): string | null {
  return view?.readout.dialectId ?? null;
}

// ---------------------------------------------------------------- motors and axes

/** The axis letter motor `m` drives (`{m}ma`), or null when not read. */
export function motorAxis(settings: Readonly<Record<string, SettingValue>>, m: number): string | null {
  const ma = settings[`${m}ma`];
  return typeof ma === 'number' ? (AXIS_NAMES[ma] ?? `axis ${ma}`) : null;
}

/** Steps per mm from step angle, microsteps and travel per revolution: 360 / sa × mi / tr. Null unless all three are positive. */
export function stepsPerUnit(sa: number | undefined, mi: number | undefined, tr: number | undefined): number | null {
  if (sa === undefined || mi === undefined || tr === undefined || !(sa > 0) || !(mi > 0) || !(tr > 0)) return null;
  return (360 / sa) * mi / tr;
}

/** The motor that drives an axis per the board's `ma` settings; else the factory order 1 X, 2 Y, 3 Z, 4 A, marked as assumed. */
export function motorFor(settings: Readonly<Record<string, SettingValue>>, axis: string): { readonly motor: number | null; readonly assumed: boolean } {
  const index = AXIS_NAMES.indexOf(axis.toUpperCase() as 'X');
  const read = MOTORS.filter((m) => settings[`${m}ma`] !== undefined);
  if (read.length > 0) {
    const m = MOTORS.find((x) => settings[`${x}ma`] === index);
    return { motor: m ?? null, assumed: false };
  }
  return { motor: index >= 0 && index < 4 ? index + 1 : null, assumed: true };
}

// ---------------------------------------------------------------- the draft

const isDraft = (v: unknown): v is Record<string, number> => isObject(v) && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x));

/** Proposed settings, by token. Kept in this browser; never written to the board in this phase. */
export const draftStore = stored<Readonly<Record<string, number>>>('board-draft.v1', {}, isDraft);

export function setDraft(key: string, value: number | null): void {
  const next: Record<string, number> = { ...draftStore.value.value };
  if (value === null || !Number.isFinite(value)) delete next[key];
  else next[key] = value;
  draftStore.set(next);
}

export function clearDraft(keys?: readonly string[]): void {
  if (keys === undefined) {
    draftStore.set({});
    return;
  }
  const next: Record<string, number> = { ...draftStore.value.value };
  for (const k of keys) delete next[k];
  draftStore.set(next);
}

export const draftCount = computed(() => Object.keys(draftStore.value.value).length);

/** How a draft value compares with the board: same, changed, or the board value is not read. */
export function draftDiff(key: string, settings: Readonly<Record<string, SettingValue>>): 'none' | 'same' | 'changed' | 'unread' {
  const d = draftStore.value.value[key];
  if (d === undefined) return 'none';
  const b = settings[key];
  if (b === undefined) return 'unread';
  return typeof b === 'number' && Math.abs(b - d) < 1e-9 ? 'same' : 'changed';
}

// ---------------------------------------------------------------- the TinyG v8 board

/** The generated TinyG v8 definition (tinyg-v8@8), or null when the build carries none. */
export function tinygV8(): BoardDefinition | null {
  return BOARD_DEFINITIONS.find((b) => b.id === 'tinyg-v8@8') ?? null;
}

export type PinRole = 'input' | 'output' | 'ground' | 'logic-supply' | 'motor-supply' | 'motor';

export interface PinInfo {
  /** `J7.3`, or `M1.2` for a motor terminal (the board data names no motor connector). */
  readonly ref: string;
  readonly connector: string;
  readonly n: number;
  /** The board's own pin label (`Xmin`, `SpinDir`, `GND`). */
  readonly label: string;
  readonly role: PinRole;
  /** What the pin does, in plain words. */
  readonly function: string;
  readonly signal?: string;
  /** The microcontroller pin from the generated pin map. */
  readonly mcu?: string;
  /** Setting keys that decide or report what this pin does. */
  readonly keys: readonly string[];
  readonly note?: string;
  readonly src: string;
}

const SIDE: Readonly<Record<string, string>> = { min: 'minimum', max: 'maximum' };

function inputFunction(signal: string): { readonly text: string; readonly keys: readonly string[] } {
  const m = /^in\.limit-(min|max)-([xyza])$/.exec(signal);
  if (m === null) return { text: 'Switch input', keys: ['st'] };
  const [, side, axis] = m as unknown as [string, 'min' | 'max', string];
  return { text: `${axis.toUpperCase()} ${SIDE[side]} switch input`, keys: [`${axis}s${side === 'min' ? 'n' : 'x'}`, 'st'] };
}

const OUTPUT_FUNCTION: Readonly<Record<string, { readonly text: string; readonly keys: readonly string[]; readonly note?: string }>> = {
  'out.spindleEnable': { text: 'Spindle enable output', keys: ['spep', 'spe'] },
  'out.spindleDirection': { text: 'Spindle direction output', keys: ['spdp', 'spc', 'spd'] },
  'out.spindlePwm': { text: 'Spindle speed output (PWM)', keys: ['p1frq', 'p1csl', 'p1csh', 'p1cpl', 'p1cph', 'sps'], note: 'Its polarity key (spph) is reserved on this firmware.' },
  'out.coolant': { text: 'Coolant output', keys: ['cof', 'com', 'coph'], note: 'Mist and flood share this one output. Its polarity key (coph) is reserved on this firmware.' },
};

/** Every connector pin of the TinyG v8, from the board definition, plus the four terminals of each motor output. */
export function v8Pins(board: BoardDefinition | null = tinygV8()): readonly PinInfo[] {
  if (board === null) return [];
  const mcu = new Map((board.pins ?? []).map((p) => [p.signal, p.mcu]));
  const supply = boardElectrical(board).supply;
  const out: PinInfo[] = [];
  for (const c of board.connectors ?? []) {
    for (const p of c.pins) {
      const base = { ref: `${c.id}.${p.n}`, connector: c.id, n: p.n, label: p.label, src: c.src };
      if (p.signal?.startsWith('in.') === true) {
        const f = inputFunction(p.signal);
        out.push({ ...base, role: 'input', function: f.text, signal: p.signal, ...(mcu.get(p.signal) === undefined ? {} : { mcu: mcu.get(p.signal) as string }), keys: f.keys });
      } else if (p.signal?.startsWith('out.') === true) {
        const f = OUTPUT_FUNCTION[p.signal] ?? { text: 'Output', keys: [] };
        out.push({ ...base, role: 'output', function: f.text, signal: p.signal, ...(mcu.get(p.signal) === undefined ? {} : { mcu: mcu.get(p.signal) as string }), keys: f.keys, ...(f.note === undefined ? {} : { note: f.note }) });
      } else if (p.net === 'GND') {
        out.push({ ...base, role: 'ground', function: 'Ground', keys: [] });
      } else if (p.net === '3V3') {
        out.push({ ...base, role: 'logic-supply', function: '3.3 V from the board, for switches', keys: [], note: 'Signal pins on this connector are 3.3 V logic and not 5 V tolerant.' });
      } else if (p.net === 'VMOT') {
        out.push({ ...base, role: 'motor-supply', function: 'Motor supply input (Vmot)', keys: [], ...(supply === undefined ? {} : { note: `${supply.min}–${supply.max} V DC, ${supply.recommend} V recommended. The board's logic runs from this supply.` }) });
      }
    }
  }
  const driver = board.motors.driver?.value;
  for (const m of MOTORS) {
    for (let k = 1; k <= 4; k++) {
      out.push({
        ref: `M${m}.${k}`,
        connector: `M${m}`,
        n: k,
        label: `Motor ${m}, terminal ${k}`,
        role: 'motor',
        function: 'Stepper motor coil terminal',
        keys: ['ma', 'sa', 'tr', 'mi', 'po', 'pm'].map((s) => `${m}${s}`),
        note: `${driver === undefined ? 'The motor driver' : `Driven by its ${driver.replace(/, one per motor.*$/, '')}`}. The board data does not name the coil order of the four terminals: follow the board's silkscreen and your motor's datasheet.`,
        src: board.motors.driver?.src ?? board.source.note,
      });
    }
  }
  return out;
}

export function pinByRef(ref: string): PinInfo | null {
  return v8Pins().find((p) => p.ref === ref) ?? null;
}

/** The connector pins of one connector id (J1, J6, J7, J8, M1..M4), in pin order. */
export function connectorPins(id: string): readonly PinInfo[] {
  return v8Pins().filter((p) => p.connector === id).sort((a, b) => a.n - b.n);
}

export function connectorLabel(id: string): string {
  const c = tinygV8()?.connectors?.find((x) => x.id === id);
  if (c !== undefined) return `${c.id} ${c.label}`;
  return /^M\d$/.test(id) ? `Motor ${id.slice(1)}` : id;
}
