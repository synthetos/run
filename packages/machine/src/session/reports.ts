/**
 * The session's status-report configuration at connect (owner 2026-11-02; SAFETY §4.2 amendment
 * "push-driven state", H64, T-S101).
 *
 * On connect the session reads the machine's full state once (the `seed` reads), then makes sure the
 * board pushes what run needs, and from then on the page is driven by pushed status reports and the
 * edge-next heartbeat. This module is pure: it says which lines to send, and the reducer sends them one
 * at a time, each answered before the next (the EEPROM stall, H57), with a read-back after every
 * persisted change.
 *
 * **Plain writes, written only where they differ.** The firmware compares before it writes EEPROM
 * (write_persistent_value, and the sr list's `se` rows), but the session still diffs against what it read,
 * which saves round trips: the list is written only when it differs from run's, `sv` only when it is not 1,
 * `si` only when absurd, each answered and read back before the next line. A RAM-only write mode was
 * designed with the firmware maintainer and is parked; `reportSteps` is the one place that would change
 * if it ever lands (no such code exists here, and the session never sends a `ram` key).
 *
 * What run needs in the status report list: state, hold, line, velocity and feed, units, coordinate
 * system and distance mode, work and machine position (X, Y, Z, A), and the spindle and coolant
 * readouts. `sv` must be 1 (filtered: only changed fields). `si` is left alone unless it is absurd
 * (above 1000 ms: the page would lag by seconds and the silence window would not hold), when it is
 * set back to the firmware default 250 ms. The heartbeat (`{"rt":{"hb":N}}`, RAM only, off at reset)
 * is turned on when `{"rt":null}` answers (status 100 means the firmware has none).
 */
/** The status report fields run needs (at most 30 on TinyG). Order is the order written. */
export const RUN_SR_FIELDS: readonly string[] = Object.freeze([
  'stat',
  'hold',
  'line',
  'vel',
  'feed',
  'unit',
  'coor',
  'dist',
  'posx',
  'posy',
  'posz',
  'posa',
  'mpox',
  'mpoy',
  'mpoz',
  'mpoa',
  'spe',
  'spc',
  'sps',
  'cof',
  'com',
]);

/** Dialects whose status report list and heartbeat run configures. */
export const REPORT_DIALECTS: ReadonlySet<string> = new Set(['tinyg-en']);

/**
 * The heartbeat interval run asks for, in whole SECONDS: one beat per second. The edge-next `hb` is seconds,
 * 0 off, 1..60 (RT_HB_MAX; @cite EN runtime.h:6, :15); anything else is refused with 110 (runtime.c:107-118).
 * Amended 2026-11-02: run sent `{"rt":{"hb":1000}}` (ms), which the firmware refuses, so there was no heartbeat.
 */
export const HEARTBEAT_S = 1;
/** The same interval in ms, for the session's own timing. */
export const HEARTBEAT_INTERVAL_MS = HEARTBEAT_S * 1000;
/** `si` above this is absurd and is set back to `SI_DEFAULT`. */
export const SI_MAX_SENSIBLE = 1000;
/** The firmware default status interval (@cite EN settings/settings_default.h:81). */
export const SI_DEFAULT = 250;

/**
 * The full machine state read once after identification (and after every reconnect, which is a new
 * connect): homing per axis, units, coordinate system, distance mode, tool, machine and work position,
 * all offsets but the saved g54..g59 (the settings read takes those), the spindle and coolant readouts,
 * and the reporting settings. Each is filtered through the dialect's read allowlist before it is sent.
 */
export const SEED_TOKENS: readonly string[] = Object.freeze(['home', 'hom', 'unit', 'coor', 'dist', 'tool', 'mpo', 'pos', 'ofs', 'g92', 'g28', 'g30', 'spe', 'spc', 'spd', 'sps', 'cof', 'com', 'sv', 'si']);

export type ReportStepKind = 'srList' | 'srReadback' | 'sv' | 'svReadback' | 'si' | 'siReadback' | 'rtProbe' | 'heartbeat';

export interface ReportStep {
  readonly kind: ReportStepKind;
  /** The key its answer carries. */
  readonly token: 'sr' | 'sv' | 'si' | 'rt';
  /** The exact line (without LF) for a write; absent for a read-back GET. */
  readonly line?: string;
  /** For `sv`/`si`: the value before the change (W36). */
  readonly from?: number;
}

/** What the board reported before configuration. */
export interface ReportCurrent {
  readonly srList: readonly string[] | undefined;
  readonly sv: number | undefined;
  readonly si: number | undefined;
}

/** True when the board's list holds exactly run's fields (order does not matter). */
export function srListMatches(list: readonly string[] | undefined): boolean {
  if (list === undefined) return false;
  return list.length === RUN_SR_FIELDS.length && RUN_SR_FIELDS.every((f) => list.includes(f));
}

/** `{sr:{stat:true,...}}` (relaxed JSON: the strict form does not fit the 254-byte JSON line). */
export function srListLine(): string {
  return `{sr:{${RUN_SR_FIELDS.map((f) => `${f}:true`).join(',')}}}`;
}

/** `{"rt":{"hb":N}}`, N whole seconds (1..60). */
export function heartbeatLine(seconds: number): string {
  return `{"rt":{"hb":${Math.round(seconds)}}}`;
}

export const RT_PROBE_LINE = '{"rt":null}';

/**
 * Capability seam: does the board's heartbeat also beat while the machine is held, dwelling or has moves queued
 * without stepping? Today it does not: edge-next beats only while the machine is quiet (@cite EN
 * runtime.c:37-52, :62-71), so in those states the watchdog asks once per silent window (ENQ, else a `stat`
 * GET) instead of going STALE (SAFETY §4.2 amendment 2026-11-02, H69). Beats during hold and dwell are under
 * discussion with the firmware maintainer (option (a)); when a build has them and says so, this returns true for
 * it and the session stops asking. Nothing else may change for that.
 */
export function heartbeatCoversHold(): boolean {
  return false;
}

/** The configuration steps: only what differs, each write followed by its read-back; then the heartbeat. */
export function reportSteps(current: ReportCurrent): readonly ReportStep[] {
  const steps: ReportStep[] = [];
  if (!srListMatches(current.srList)) {
    steps.push({ kind: 'srList', token: 'sr', line: srListLine() }, { kind: 'srReadback', token: 'sr' });
  }
  if (current.sv !== undefined && current.sv !== 1) {
    steps.push({ kind: 'sv', token: 'sv', line: '{sv:1}', from: current.sv }, { kind: 'svReadback', token: 'sv' });
  }
  if (current.si !== undefined && current.si > SI_MAX_SENSIBLE) {
    steps.push({ kind: 'si', token: 'si', line: `{si:${SI_DEFAULT}}`, from: current.si }, { kind: 'siReadback', token: 'si' });
  }
  steps.push({ kind: 'rtProbe', token: 'rt', line: RT_PROBE_LINE }, { kind: 'heartbeat', token: 'rt', line: heartbeatLine(HEARTBEAT_S) });
  return steps;
}

/** The report-configuration line shapes the write gate admits (each must also be the step in progress). */
const REPORT_LINES: readonly RegExp[] = [
  /^\{sr:\{([a-z]{2,4}:true)(,[a-z]{2,4}:true){0,29}\}\}$/,
  /^\{sv:1\}$/,
  new RegExp(`^\\{si:${SI_DEFAULT}\\}$`),
  /^\{"rt":null\}$/,
  /^\{"rt":\{"hb":([1-9]|[1-5]\d|60)\}\}$/,
];

/** True when `line` is one of the configuration shapes, with only run's fields in a list. */
export function reportLineShape(line: string): boolean {
  if (!REPORT_LINES.some((re) => re.test(line))) return false;
  const list = /^\{sr:\{(.*)\}\}$/.exec(line);
  if (list === null) return true;
  return (list[1] as string).split(',').every((pair) => RUN_SR_FIELDS.includes(pair.slice(0, -':true'.length)));
}
