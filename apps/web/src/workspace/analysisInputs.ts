/**
 * The job analysis's motion inputs (docs/design/ANALYZE.md §1, slice 1): read-only. The board's own settings win for
 * that board; a reading saved in this browser is used when disconnected and says when it was taken; the machine
 * profile comes last. Every value keeps its source, and native units are converted with the evidence named.
 *
 * Nothing here asks the board for anything: it reads the settings the connect-time read already holds
 * (`LiveView.readout`), and it never treats a pending settings draft as applied.
 */
import type { Evidence, MotionInputs, XyzAxis } from '@synthetos/advisor';
import type { SettingValue } from '@synthetos/schema';
import type { MachineProfile } from './library.ts';
import { connected, snapshotOf, type LiveView } from './model.ts';
import { isObject, stored } from './storage.ts';

const MM_PER_INCH = 25.4;
const AXES: readonly XyzAxis[] = ['X', 'Y', 'Z'];

/** One board's motion settings as read: rapid (`vm`), feed (`fr`) and jerk (`jm`) per axis, in the board's units. */
export interface BoardReading {
  readonly dialect: string;
  readonly boardId: string | null;
  /** The board's `unit`: 0 inches, 1 millimetres, null when not read. */
  readonly unit: number | null;
  readonly vm: Readonly<Partial<Record<XyzAxis, number>>>;
  readonly fr: Readonly<Partial<Record<XyzAxis, number>>>;
  readonly jm: Readonly<Partial<Record<XyzAxis, number>>>;
  /** Epoch milliseconds. */
  readonly at: number;
}

const numberMap = (v: unknown): v is Record<string, number> => isObject(v) && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x));
const isReading = (v: unknown): v is BoardReading =>
  isObject(v) && typeof v['dialect'] === 'string' && (v['boardId'] === null || typeof v['boardId'] === 'string') && (v['unit'] === null || typeof v['unit'] === 'number') && numberMap(v['vm']) && numberMap(v['fr']) && numberMap(v['jm']) && typeof v['at'] === 'number';

/** The last board reading this browser saw, kept for when no board is connected ("Last read …"). */
export const savedReading = stored<BoardReading | null>('analysis.board-reading.v1', null, (v): v is BoardReading | null => v === null || isReading(v));

function axisValues(settings: Readonly<Record<string, SettingValue>>, field: string): Partial<Record<XyzAxis, number>> {
  const out: Partial<Record<XyzAxis, number>> = {};
  for (const a of AXES) {
    const v = settings[`${a.toLowerCase()}${field}`];
    if (typeof v === 'number' && Number.isFinite(v)) out[a] = v;
  }
  return out;
}

/** The connected board's motion settings, or null (not connected, or the settings read is not complete). */
export function boardReading(view: LiveView | null, now: number): BoardReading | null {
  if (view === null || !connected(view)) return null;
  const settings = view.readout.settings;
  const vm = axisValues(settings, 'vm');
  if (Object.keys(vm).length === 0) return null;
  const s = snapshotOf(view);
  const unit = s?.live.unit;
  const id = s?.identity?.id;
  return { dialect: view.readout.dialectId ?? 'unknown', boardId: typeof id === 'string' && id.length > 0 ? id : null, unit: typeof unit === 'number' ? unit : null, vm, fr: axisValues(settings, 'fr'), jm: axisValues(settings, 'jm'), at: now };
}

/** "Last read 9 Nov, 14:02" in the viewer's locale. */
export function lastReadLabel(at: number): string {
  const d = new Date(at);
  return `Last read ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** One reading's value in mm/min, with its evidence. Inches are converted and say so; unknown units give no value. */
function fromReading(r: BoardReading, values: BoardReading['vm'], axis: XyzAxis, live: boolean): Evidence<number> {
  const base = live ? 'Board settings' : lastReadLabel(r.at);
  const source = live ? 'board' : 'saved-board';
  const v = values[axis];
  if (v === undefined) return { value: null, source, label: base, units: 'mm/min', observedAt: r.at };
  if (r.unit === null) return { value: null, source, label: `${base} (units not read)`, units: 'mm/min', observedAt: r.at };
  return { value: r.unit === 0 ? v * MM_PER_INCH : v, source, label: r.unit === 0 ? `${base} (in/min, converted)` : base, units: 'mm/min', observedAt: r.at };
}

const NONE: Evidence<number> = { value: null, source: 'assumption', label: 'Not known', units: 'mm/min' };

/** Where each value comes from: the connected board, else the saved reading, else the profile, else not known. */
export interface InputSources {
  readonly live: BoardReading | null;
  readonly saved: BoardReading | null;
  readonly profile: MachineProfile | null;
}

function pick(sources: InputSources, field: 'vm' | 'fr', axis: XyzAxis): Evidence<number> {
  if (sources.live !== null) return fromReading(sources.live, sources.live[field], axis, true);
  if (sources.saved !== null) return fromReading(sources.saved, sources.saved[field], axis, false);
  const p = sources.profile?.axes?.[axis.toLowerCase() as 'x' | 'y' | 'z'];
  const v = field === 'vm' ? p?.maxVelocity : p?.maxFeed;
  return v === undefined ? NONE : { value: v, source: 'profile', label: `Machine profile (${sources.profile?.name ?? ''})`, units: 'mm/min' };
}

export function motionInputs(sources: InputSources): MotionInputs {
  return { rapid: { X: pick(sources, 'vm', 'X'), Y: pick(sources, 'vm', 'Y'), Z: pick(sources, 'vm', 'Z') } };
}

/** The per-axis settings Advanced shows, each with its source. */
export interface AxisSetting {
  readonly axis: XyzAxis;
  readonly rapid: Evidence<number>;
  readonly feed: Evidence<number>;
}

export function axisSettings(sources: InputSources): readonly AxisSetting[] {
  return AXES.map((axis) => ({ axis, rapid: pick(sources, 'vm', axis), feed: pick(sources, 'fr', axis) }));
}
