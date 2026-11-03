/**
 * What the machine strip says, in plain words (WORKSPACE_TENETS 3 and 4),
 * from the session snapshot the worker posted. Unknown is never shown as
 * zero: a value the board has not reported reads as an em dash.
 *
 * Pure: the same view gives the same words.
 */
import { boardText } from '@synthetos/safety';
import type { LiveView } from './model.ts';

export const UNKNOWN = '—';

export type StripTone = 'off' | 'live' | 'run' | 'hold' | 'alarm' | 'warn';

export interface Readout {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly title: string;
}

export interface StripStatus {
  readonly connected: boolean;
  readonly title: string;
  readonly name: string;
  readonly tone: StripTone;
  readonly pill: { readonly text: string; readonly tone: 'live' | 'warn' | 'danger' | 'ok' } | null;
  readonly text: string | null;
  readonly readouts: readonly Readout[];
  /** The board reports the spindle on (`spe` 1): only picks the held wording "Paused · spindle still on". */
  readonly spindleOn: boolean;
}

/** A number with a thin-space thousands separator, as the prototype shows them. */
export function num(n: number, digits = 0): string {
  const fixed = Math.abs(n).toFixed(digits);
  const [int, frac] = fixed.split('.') as [string, string | undefined];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '−' : ''}${grouped}${frac === undefined ? '' : `.${frac}`}`;
}

/** A coordinate with three decimals and a true minus sign, or the em dash. */
export function coord(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(3)}` : UNKNOWN;
}

/** The board as a person reads it: "TinyG v8 · 450.01 · SIM-EN-0001". */
export function boardLabel(view: LiveView): string {
  const s = view.message?.snapshot ?? null;
  const id = s?.identity ?? null;
  if (s === null || s.base === 'NOT_CONNECTED') return 'No board connected';
  const family = s.classification?.dialectId?.startsWith('g2') === true ? 'g2core' : 'TinyG';
  const parts: string[] = [];
  parts.push(id?.hv === undefined ? family : `${family} v${boardText(String(id.hv))}`);
  if (typeof id?.fb === 'number') parts.push(`firmware ${id.fb.toFixed(2)}`);
  const boardId = boardText(id?.id);
  if (boardId !== '') parts.push(boardId);
  return parts.join(' · ');
}

type Snapshot = NonNullable<LiveView['message']>['snapshot'];
type Live = Snapshot['live'];

/** The spindle and coolant readouts the page shows. */
export const READOUT_KEYS = ['spe', 'spc', 'spd', 'sps', 'cof', 'com'] as const;

/**
 * The live state with each spindle and coolant readout taken from the status report when it carries it,
 * otherwise from the worker's read-only poll (`snapshot.values[token]`, answered with status 0). Pure.
 *
 * DISPLAY ONLY: these say what the outputs were last driven to, each sampled on its own. Nothing that
 * pauses, stops or decides anything reads them (SAFETY §4.4); the worker's reducer ignores them too.
 */
export function displayReadouts(snapshot: Snapshot | null | undefined): Live | undefined {
  if (snapshot === null || snapshot === undefined) return undefined;
  const live = snapshot.live;
  const merged: Record<string, unknown> = { ...live };
  for (const key of READOUT_KEYS) {
    if (reported(live[key])) continue;
    const polled = snapshot.values[key];
    if (polled !== undefined && polled.status === 0 && reported(polled.value)) merged[key] = polled.value;
  }
  return merged as unknown as Live;
}

/** Shown when the board's status list (its answer to `{sr:null}`) does not carry a readout. */
export const NOT_REPORTED = 'Not reported by this board’s status list';

export const SPINDLE_TITLE =
  'What the controller reports it is driving the spindle output to, from its status reports. The speed is the commanded speed after the controller’s limits, never a measured one: TinyG has no speed sensor. A command queued behind a move shows only once it runs. For display only: never rely on it for safety.';
export const COOLANT_TITLE =
  'What the controller reports it is driving the flood and mist outputs to, from its status reports. A command queued behind a move shows only once it runs. For display only: never rely on it for safety.';

function reported(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Neither readout of a pair is known (from the status list or a poll): a dash, or "not reported" when the board's status list lacks them. */
function missing(live: Live | undefined, keys: readonly string[]): string {
  const list = live?.srList;
  return list !== undefined && !keys.some((k) => list.includes(k)) ? NOT_REPORTED : UNKNOWN;
}

/**
 * The spindle as the board reports it (edge-next `spe`, `spc`, `spd`, `sps`): "On · CW · 18 000 rpm
 * commanded", "Off", or the dash. Display only (each field is sampled on its own; outputs as driven).
 */
export function spindleText(live: Live | undefined): string {
  const spe = live?.spe;
  const spc = live?.spc;
  if (!reported(spe) && !reported(spc)) return missing(live, ['spe', 'spc']);
  const on = reported(spe) ? spe === 1 : spc === 1 || spc === 2;
  if (!on) return 'Off';
  const parts = ['On'];
  const dir = spc === 1 ? 'CW' : spc === 2 ? 'CCW' : live?.spd === 0 ? 'CW' : live?.spd === 1 ? 'CCW' : null;
  if (dir !== null) parts.push(dir);
  const sps = live?.sps;
  if (reported(sps)) parts.push(`${num(sps)} rpm commanded`);
  return parts.join(' · ');
}

/** Flood (`cof`) and mist (`com`) as the board reports them: "Off", "Flood", "Mist", "Flood and mist", or the dash. */
export function coolantText(live: Live | undefined): string {
  const cof = live?.cof;
  const com = live?.com;
  if (!reported(cof) && !reported(com)) return missing(live, ['cof', 'com']);
  const on = [cof === 1 ? 'Flood' : null, com === 1 ? 'mist' : null].filter((x): x is string => x !== null);
  if (on.length === 0) return reported(cof) && reported(com) ? 'Off' : cof === 0 ? 'Flood off' : 'Mist off';
  return on.length === 2 ? 'Flood and mist' : on[0] === 'mist' ? 'Mist' : 'Flood';
}

/** The board reports the spindle on (`spe` 1). Only for the "Paused · spindle still on" wording; never a decision. */
export function spindleReportedOn(view: LiveView): boolean {
  return displayReadouts(view.message?.snapshot)?.spe === 1;
}

const MOVING = new Set(['running', 'jogging', 'homing', 'probing']);
const ALARM = new Set(['alarm', 'shutdown', 'panic', 'softAlarm', 'interlock']);

function units(view: LiveView): string {
  const u = view.message?.dro.units ?? null;
  return u === 'in' ? 'in/min' : u === 'mm' ? 'mm/min' : 'units/min';
}

function readouts(view: LiveView): readonly Readout[] {
  const live = displayReadouts(view.message?.snapshot);
  const feed = typeof live?.feed === 'number' ? live.feed : null;
  const vel = typeof live?.vel === 'number' ? live.vel : null;
  const line = typeof live?.line === 'number' && live.line > 0 ? live.line : null;
  const feedValue = feed === null && vel === null ? UNKNOWN : vel !== null && feed !== null ? `${num(vel)} / ${num(feed)}` : num((feed ?? vel) as number);
  return [
    {
      label: 'Feed',
      value: feedValue,
      unit: feedValue === UNKNOWN ? '' : units(view),
      title: 'Actual velocity over commanded feed, from the controller’s status reports. A dash means not reported yet.',
    },
    { label: 'Spindle', value: spindleText(live), title: SPINDLE_TITLE },
    { label: 'Coolant', value: coolantText(live), title: COOLANT_TITLE },
    { label: 'Job', value: line === null ? UNKNOWN : `line ${num(line)}`, title: line === null ? 'No job is running from this page. Running jobs arrives in a later phase.' : 'The line the controller reports executing.' },
  ];
}

export function stripStatus(view: LiveView, machineName: string | null): StripStatus {
  const s = view.message?.snapshot ?? null;
  const name = `${machineName ?? 'No machine profile'} · ${boardLabel(view)}`;
  const entry = view.entry.step;
  if (s === null || s.base === 'NOT_CONNECTED') {
    const title = entry === 'checking' ? 'Checking before connect' : entry === 'opening' ? 'Choosing the port' : entry === 'c1' ? 'Confirm to connect' : 'Not connected';
    return { connected: false, title, name: machineName ?? 'No board connected', tone: 'off', pill: null, text: null, readouts: [], spindleOn: false };
  }
  const base = { connected: true, name, readouts: readouts(view), spindleOn: spindleReportedOn(view) };
  const o = s.overlays;
  if (o.includes('LOST')) return { ...base, title: 'Connection lost', tone: 'alarm', pill: { text: 'Lost', tone: 'danger' }, text: 'The machine may still be moving. Use your E-stop if anything is unsafe.' };
  if (o.includes('FAULT')) return { ...base, title: 'Fault', tone: 'alarm', pill: { text: 'Fault', tone: 'danger' }, text: s.fault?.detail ?? 'The session stopped trusting the link.' };
  if (o.includes('ORPHANED_MOTION')) return { ...base, title: "Moves this page didn't send", tone: 'alarm', pill: { text: 'Check the machine', tone: 'danger' }, text: "Look at the machine: if it moves, use your E-stop. The board reported being paused, moving or holding queued moves that this page didn't send. To clear them, reset or power-cycle the controller, then reload this page and connect again." };
  if (s.base === 'OPENING' || s.base === 'PORT_REQUEST' || s.base === 'IDENTIFYING') return { ...base, title: 'Identifying the board', tone: 'live', pill: null, text: s.probe === null ? 'Asking the board what it is…' : `Asking the board what it is: ${s.probe.answered} of ${s.probe.of} answers` };
  if (s.base === 'READING') return { ...base, title: 'Reading the board', tone: 'live', pill: null, text: 'Reading state and settings. Nothing is written.' };
  if (s.base === 'BLOCKED') return { ...base, title: 'Not the selected board', tone: 'alarm', pill: { text: 'Blocked', tone: 'danger' }, text: 'Nothing is sent to this board.' };
  // Push-driven (amendment 2026-11-02): neither a report nor a heartbeat for the silence window. The link is suspect.
  if (o.includes('STALE')) return { ...base, title: 'No reports from the board', tone: 'warn', pill: { text: 'Stale', tone: 'warn' }, text: 'Nothing has arrived from the board for a while. Commands are blocked; what you see may be out of date.' };
  // Phase 2 (SAFETY §4.4): the Stop job sequence, from the session's own state; never "requested".
  if (s.base === 'STOPPING_JOB') return { ...base, title: 'Stopping', tone: 'run', pill: null, text: 'Clearing the queue, then spindle and coolant off.' };
  if (s.base === 'HOMING') return { ...base, title: 'Homing', tone: 'run', pill: null, text: 'Each axis moves to its switch. Pause or Stop job ends it.' };
  const cls = s.live.machineClass;
  if (cls !== undefined && MOVING.has(cls)) return { ...base, title: 'Moving', tone: 'run', pill: null, text: null };
  if (cls !== undefined && ALARM.has(cls)) return { ...base, title: 'Alarm', tone: 'alarm', pill: { text: 'Alarm', tone: 'danger' }, text: 'The controller reports an alarm. Check the machine.' };
  if (o.includes('UNKNOWN')) return { ...base, title: 'Connected · state unknown', tone: 'warn', pill: { text: 'Unknown', tone: 'warn' }, text: 'The previous session ended while connected. Check the machine, then confirm it or home it (below).' };
  if (o.includes('NEEDS_REVIEW')) return { ...base, title: 'Connected · read only', tone: 'live', pill: { text: 'Needs review', tone: 'warn' }, text: 'The board’s settings differ from this computer’s reference.' };
  if (o.includes('READ_ONLY')) return { ...base, title: 'Connected · read only', tone: 'live', pill: { text: 'Read only', tone: 'live' }, text: 'Phase 1: positions and settings are read, nothing is written.' };
  // Phase 2: the last motion result in plain words ("Stopped: queue cleared, spindle and coolant off"), from polled state.
  return { ...base, title: 'Machine idle', tone: 'live', pill: null, text: s.notices.motion?.text ?? null };
}
