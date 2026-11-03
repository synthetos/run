/**
 * Phase 2 motion in the page (owner 2026-11-02; SAFETY §4.5b, H50–H53, T-S89, T-S92).
 *
 * - `motionUi`: whether the motion controls (jog, zero, spindle and coolant on) are enabled, and why not,
 *   from the worker's snapshot and its motion flag. The session decides every request again; this only
 *   keeps the page honest about what will be refused. Pause and Stop job are never decided here.
 * - `JogController`: the press-and-hold logic of the jog pad and the keyboard. A step press sends one jog
 *   of the chosen size. A Hold press starts a hold jog, renews it every `RENEW_MS` while held, and releases
 *   it on pointer-up, pointer-cancel, lost capture, window blur and the page going hidden. The session ends
 *   a hold jog on its own when the renewals stop (H50), so a lost release here is bounded there.
 * - The confirmation texts' path for Go to zero (C25) and the offsets shown next to Set zero.
 *
 * Pure apart from the timers `JogController` is given. The page sees the session only through the worker
 * RPC (T-S39).
 */
import { homingAxes, type HomingAxisConfig, type SettingValue } from '@synthetos/schema';
import type { MotionAxis, MotionCommand, SnapshotMessage } from '../machine-worker/rpc.ts';
import type { LiveView } from './model.ts';

type Snapshot = SnapshotMessage['snapshot'];

/** How often a held jog is renewed (the session ends it after 500 ms without one). */
export const RENEW_MS = 200;
/** Jog speed bounds and default, mm/min (the session caps at 5000; the firmware at the axis `fr`). */
export const JOG_FEED = Object.freeze({ min: 10, max: 5000, default: 1000 });
/** Step sizes, mm and inch. The inch steps are sent in mm. */
export const STEPS_MM: readonly number[] = Object.freeze([0.01, 0.1, 1, 10, 100]);
export const STEPS_IN: readonly number[] = Object.freeze([0.001, 0.01, 0.1, 1, 4]);
export const MM_PER_IN = 25.4;

export interface MotionUi {
  /** Jog, go to zero, set zero, spindle and coolant on may be sent now. */
  readonly enabled: boolean;
  /** Why not, in plain words (null when enabled). */
  readonly reason: string | null;
  /** The worker's motion capability flag (bench and staging only). */
  readonly flag: boolean;
  readonly connected: boolean;
  /** `home` as read at connect: true homed, false not homed, null unknown. */
  readonly homed: boolean | null;
  /** A move of this session is running (jog, go to zero, or the stop sequence). */
  readonly busy: boolean;
  /** A hold jog is running. */
  readonly holdJog: boolean;
  /** A Pause of this session's motion is confirmed: Resume is offered. */
  readonly held: boolean;
  /** The controller is in alarm: Clear alarm is offered. */
  readonly alarm: boolean;
  /** After a reconnect: "I've checked the machine" is offered. */
  readonly unknown: boolean;
  /** The last motion result from the session, in plain words. */
  readonly notice: string | null;
}

const JOB_STATES: ReadonlySet<string> = new Set(['PREAMBLE', 'RUNNING', 'HOLD_REQUESTED', 'BARRIER_DRAINING', 'PROGRAM_PAUSED', 'END_HOLDBACK', 'ARMED', 'PREFLIGHT_OK', 'JOB_LOADED']);

function snapshotOf(view: LiveView | null): Snapshot | null {
  const s = view?.message?.snapshot ?? null;
  return s === null || s.base === 'NOT_CONNECTED' ? null : s;
}

/** Why the motion controls are disabled now, or null (T-S92). The checks run in the session's order of precedence. */
function why(s: Snapshot | null, flag: boolean): string | null {
  if (s === null) return 'Connect a machine to use these controls.';
  if (!flag) return 'Motion control is not enabled in this build. Positions and settings are read only.';
  const o = s.overlays;
  if (o.includes('LOST')) return 'The connection is lost.';
  if (o.includes('FAULT')) return 'A fault is latched. Use Stop job if needed, then acknowledge the fault.';
  if (o.includes('ORPHANED_MOTION')) return 'The controller has motion this page did not send. Use Stop job first.';
  if (s.classification === null || s.base === 'IDENTIFYING' || s.base === 'READING' || s.base === 'OPENING' || s.base === 'PORT_REQUEST') return 'Identifying the board.';
  if (o.includes('READ_ONLY') || s.classification.mode !== 'full') return 'This firmware is not approved for motion control.';
  if (o.includes('STALE')) return 'No status from the machine. Wait for it to answer.';
  if (o.includes('UNKNOWN')) return 'The previous session ended while connected. Check the machine, then confirm below.';
  if (o.includes('NEEDS_REVIEW')) return 'The board’s settings differ from the reference. Review them first.';
  if (s.base === 'BLOCKED') return 'This is not the selected board.';
  if (JOB_STATES.has(s.base)) return 'Not available while a job is in progress.';
  if (s.base === 'ALARM') return 'The controller is in alarm. Clear the alarm first.';
  if (s.base === 'HELD') return 'Paused. Resume, or use Stop job.';
  if (s.base === 'STOPPING_JOB') return 'Stopping.';
  if (s.base === 'HOMING') return 'Homing. Pause or Stop job ends it.';
  if (s.base === 'JOGGING' || (s.motion ?? null) !== null) return 'A move is running.';
  if (s.base !== 'IDLE_UNHOMED' && s.base !== 'IDLE_HOMED') return 'Only available while the machine is idle.';
  return null;
}

export function motionUi(view: LiveView | null): MotionUi {
  const s = snapshotOf(view);
  const flag = view?.message?.motion === true;
  const reason = why(s, flag);
  const home = s?.live.home;
  const m = s?.motion ?? null;
  return Object.freeze({
    enabled: reason === null,
    reason,
    flag,
    connected: s !== null,
    homed: home === undefined ? null : home === 1,
    busy: m !== null && !m.held,
    holdJog: m?.hold === true,
    held: m?.held === true,
    alarm: s?.base === 'ALARM',
    unknown: flag && s !== null && s.base === 'CONNECTED_UNKNOWN' && s.overlays.length === 1 && s.overlays[0] === 'UNKNOWN' && s.classification?.mode === 'full',
    notice: s?.notices.motion?.text ?? null,
  });
}

/** The work offset of each axis: machine minus work position, where both are known (shown next to Set zero). */
export function workOffsets(view: LiveView | null): Readonly<Partial<Record<MotionAxis, number>>> {
  const m = view?.message;
  if (m === null || m === undefined) return {};
  // The board's own offsets of the active system, when read; else machine minus work position.
  const read = m.dro.wcs.offsets;
  if (read !== null) return read as Readonly<Partial<Record<MotionAxis, number>>>;
  const out: Partial<Record<MotionAxis, number>> = {};
  for (const axis of m.dro.axes) {
    const a = axis.axis as MotionAxis;
    if (typeof axis.machine === 'number' && typeof axis.work === 'number') out[a] = Math.round((axis.machine - axis.work) * 1000) / 1000;
  }
  return out;
}

/** Current machine Z (connect-time read, then pushed reports), or null. */
export function machineZ(view: LiveView | null): number | null {
  const z = view?.message?.dro.axes.find((a) => a.axis === 'z')?.machine;
  return typeof z === 'number' ? z : null;
}

const NAMES: Readonly<Record<MotionAxis, string>> = { x: 'X', y: 'Y', z: 'Z', a: 'A' };

export function axesText(axes: readonly MotionAxis[]): string {
  const n = axes.map((a) => NAMES[a]);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n.at(-1) as string}`;
}

/**
 * The path Go to zero will take, in plain words, for C25: the same order the session sends (Z raised first in
 * machine coordinates, never lower than now; then X and Y; then Z), so the dialog shows what will happen (H53).
 */
export function goToZeroPath(axes: readonly MotionAxis[], safeZ: number, currentZ: number | null): string {
  const planar = axes.filter((a) => a !== 'z');
  const parts: string[] = [];
  if (planar.length > 0) {
    const z = currentZ === null ? safeZ : Math.max(currentZ, safeZ);
    parts.push(currentZ !== null && z <= currentZ ? `Z stays at machine ${fmt(z)} mm` : `Z up to machine ${fmt(z)} mm`);
    parts.push(`${axesText(planar)} to work 0`);
  }
  if (axes.includes('z')) parts.push('Z down to work 0');
  return parts.join(', then ');
}

function fmt(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

// --- Jog controller ---------------------------------------------------------------

export interface JogTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface JogSettings {
  /** Step length in mm, or null for Hold. */
  readonly stepMm: number | null;
  readonly feed: number;
}

/**
 * One press of the jog pad or a jog key. `press` sends a step (step mode) or starts a hold jog (Hold mode);
 * `release` ends a hold jog. Only one press is active at a time; a second press while one is active is ignored.
 */
export class JogController {
  readonly #send: (command: MotionCommand) => void;
  readonly #timers: JogTimers;
  #renew: unknown = null;
  #active = false;

  constructor(send: (command: MotionCommand) => void, timers: JogTimers) {
    this.#send = send;
    this.#timers = timers;
  }

  /** A hold jog is being held. */
  get holding(): boolean {
    return this.#active;
  }

  press(axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>, settings: JogSettings): void {
    if (this.#active) return;
    if (settings.stepMm !== null) {
      this.#send({ op: 'jog', axes, distanceMm: settings.stepMm, feed: settings.feed });
      return;
    }
    this.#active = true;
    this.#send({ op: 'jog', axes, distanceMm: null, feed: settings.feed });
    this.#renew = this.#timers.setInterval(() => this.#send({ op: 'jogRenew' }), RENEW_MS);
  }

  /** End a hold jog: pointer-up, pointer-cancel, lost capture, key-up, blur, hidden. Harmless otherwise. */
  release(): void {
    if (!this.#active) return;
    this.#active = false;
    if (this.#renew !== null) this.#timers.clearInterval(this.#renew);
    this.#renew = null;
    this.#send({ op: 'jogRelease' });
  }
}

/** The jog key bindings: arrows for X and Y, Page Up and Page Down for Z (only while the panel has focus). */
export function jogKey(key: string): Readonly<Partial<Record<MotionAxis, 1 | -1>>> | null {
  switch (key) {
    case 'ArrowLeft':
      return { x: -1 };
    case 'ArrowRight':
      return { x: 1 };
    case 'ArrowUp':
      return { y: 1 };
    case 'ArrowDown':
      return { y: -1 };
    case 'PageUp':
      return { z: 1 };
    case 'PageDown':
      return { z: -1 };
    default:
      return null;
  }
}

// --- Homing, set machine position and offsets (amendment 2026-11-02) ---------------

/** The axes the page offers for homing and offsets. */
export const HOME_AXES: readonly MotionAxis[] = Object.freeze(['x', 'y', 'z', 'a']);

export interface HomingView {
  /** Home (and Set machine position) may be sent now: idle, or connected with UNKNOWN as the only overlay. */
  readonly enabled: boolean;
  /** Why not, in plain words (null when enabled). */
  readonly reason: string | null;
  /** Each axis's homing configuration, from the settings read at connect. */
  readonly axes: Readonly<Record<MotionAxis, HomingAxisConfig>>;
  /** X, Y, Z (and A when configured): the axes Home all homes. */
  readonly configured: readonly MotionAxis[];
  /** The settings were read (the configuration is known). */
  readonly read: boolean;
  /** Homing is running now. */
  readonly homing: boolean;
  /** The largest search distance of the configured axes, mm (C4), when known. */
  readonly searchMm: number | null;
}

/** Whether Home and Set machine position can be sent, and which axes are configured (SAFETY §4.5b as amended, H65). */
export function homingView(view: LiveView | null, settings: Readonly<Record<string, SettingValue>>): HomingView {
  const s = snapshotOf(view);
  const flag = view?.message?.motion === true;
  const axes = homingAxes(settings) as Readonly<Record<MotionAxis, HomingAxisConfig>>;
  const configured = HOME_AXES.filter((a) => axes[a].configured);
  const read = Object.keys(settings).length > 0;
  const searches = configured.map((a) => axes[a].searchMm).filter((v): v is number => v !== null);
  const searchMm = searches.length === 0 ? null : Math.max(...searches);
  let reason: string | null = null;
  if (s === null) reason = 'Connect a machine to home it.';
  else if (!flag) reason = 'Motion control is not enabled in this build.';
  else if (s.base === 'HOMING') reason = 'Homing. Pause or Stop job ends it.';
  else if (s.classification?.mode !== 'full' || s.overlays.includes('READ_ONLY')) reason = 'This firmware is not approved for motion control.';
  else if (s.overlays.some((o) => o !== 'UNKNOWN')) reason = why(s, flag) ?? 'Not available now.';
  else if (s.base !== 'IDLE_UNHOMED' && s.base !== 'IDLE_HOMED' && s.base !== 'CONNECTED_UNKNOWN') reason = why(s, flag) ?? 'Only available while the machine is idle.';
  else if ((s.motion ?? null) !== null) reason = 'A move is running.';
  return Object.freeze({ enabled: reason === null, reason, axes, configured, read, homing: s?.base === 'HOMING', searchMm });
}

/** `G54`..`G59` for the active system (`coor` 1..6), or null. */
export function activeSystem(view: LiveView | null): { readonly n: number; readonly code: string } | null {
  const coor = snapshotOf(view)?.live.coor;
  return coor !== undefined && Number.isInteger(coor) && coor >= 1 && coor <= 6 ? { n: coor, code: `G${53 + coor}` } : null;
}

function group(view: LiveView | null, token: string): Readonly<Partial<Record<MotionAxis, number>>> | null {
  const r = snapshotOf(view)?.values[token];
  if (r === undefined || r.status !== 0 || typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) return null;
  const out: Partial<Record<MotionAxis, number>> = {};
  for (const a of HOME_AXES) {
    const v = (r.value as Record<string, unknown>)[a];
    if (typeof v === 'number' && Number.isFinite(v)) out[a] = v;
  }
  return out;
}

export interface OffsetsView {
  /** The active system (`G54`..`G59`), or null when not read or G53. */
  readonly system: string | null;
  /** Its saved offsets, as read. */
  readonly saved: Readonly<Partial<Record<MotionAxis, number>>> | null;
  /** The temporary (G92) offset, as read; null when not read. */
  readonly temporary: Readonly<Partial<Record<MotionAxis, number>>> | null;
  /** A temporary offset is in force (any axis not 0). */
  readonly temporaryInForce: boolean;
  /** The total offset (`ofs`), as read. */
  readonly total: Readonly<Partial<Record<MotionAxis, number>>> | null;
}

/** The active offsets as the board reported them (each change is read back once). */
export function offsetsView(view: LiveView | null): OffsetsView {
  const sys = activeSystem(view);
  const temporary = group(view, 'g92');
  return Object.freeze({
    system: sys?.code ?? null,
    saved: sys === null ? null : group(view, sys.code.toLowerCase()),
    temporary,
    temporaryInForce: temporary !== null && Object.values(temporary).some((v) => v !== 0),
    total: group(view, 'ofs'),
  });
}
