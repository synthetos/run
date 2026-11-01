/**
 * Every required warning (W) and confirmation (C) string of run.synthetos.com,
 * exactly as SAFETY §5 and §6 word them (T-S32).
 *
 * This file is the single source of these strings: the lint rule
 * `run/no-signal-word-literal` refuses a "WARNING —", "DANGER —" or
 * "NOTICE —" string anywhere else, and `test/strings.test.ts` parses the
 * in-repo SAFETY.md §5–§6 (and OLD-S §6 for the rows SAFETY.md defines as
 * "As OLD-S Cn") and fails unless every function here, rendered with example
 * parameters, matches the document byte for byte. Change the document first,
 * then this file; never the other way round.
 *
 * Every string is a function of its parameters (SAFETY §6: "All text is
 * generated from live values through strings.ts"). Parameters are checked:
 * a warning must never show `NaN`, `undefined`, an empty name or a control
 * or bidirectional-override character that could disguise what follows, so
 * an invalid value throws `SafetyStringError` instead of rendering.
 *
 * Pure, dependency-free, deterministic. Changing this file needs
 * safety-path review (SAFETY §8).
 */

/** Thrown when a string is asked for with a value that cannot be shown safely. */
export class SafetyStringError extends Error {
  override readonly name = 'SafetyStringError';
}

/**
 * C0 and C1 control characters (including line breaks and tabs), the Unicode
 * line and paragraph separators (U+2028, U+2029), the bidirectional marks
 * (U+061C, U+200E, U+200F) and the bidirectional embedding, override and
 * isolate characters (U+202A-U+202E, U+2066-U+2069). Any of them inside a
 * machine name, port or file name could break, reorder or hide the rest of a
 * warning. Written as escapes so a reviewer can see every code point.
 */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/** A text value: non-empty, not only whitespace, no unsafe characters. */
function text(name: string, value: string): string {
  if (typeof value !== 'string') throw new SafetyStringError(`${name} must be a string`);
  if (value.trim() === '') throw new SafetyStringError(`${name} must not be empty`);
  if (UNSAFE_TEXT.test(value)) throw new SafetyStringError(`${name} contains a control or bidirectional-override character`);
  return value;
}

/** A numeric value, rendered with `String()`. Non-finite numbers throw. */
function num(name: string, value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SafetyStringError(`${name} must be a finite number, got ${String(value)}`);
  }
  return String(Object.is(value, -0) ? 0 : value);
}

/** A whole, non-negative count. */
function count(name: string, value: number): string {
  if (!Number.isInteger(value) || value < 0) throw new SafetyStringError(`${name} must be a whole number of 0 or more, got ${String(value)}`);
  return String(value);
}

/** A signed distance such as `+0.25` (C3). */
function signed(name: string, value: number): string {
  const rendered = num(name, value);
  return value > 0 ? `+${rendered}` : rendered;
}

/** One of a fixed set of values. */
function oneOf<T extends string>(name: string, value: T, allowed: readonly T[]): T {
  if (!allowed.includes(value)) throw new SafetyStringError(`${name} must be one of ${allowed.join(', ')}, got ${String(value)}`);
  return value;
}

/** A non-empty list of text values, joined with ", ". */
function list(name: string, values: readonly string[]): string {
  if (values.length === 0) throw new SafetyStringError(`${name} must not be empty`);
  return values.map((v, i) => text(`${name}[${i}]`, v)).join(', ');
}

/** A list of high-risk changes; an empty list renders as "none". */
function riskList(values: readonly string[]): string {
  return values.length === 0 ? 'none' : list('highRisk', values);
}

/** The ballot box that starts every checkbox item in SAFETY §6. */
export const BOX = '☐';

/**
 * A confirmation made of checkboxes (C1, C6, C7). `intro` is shown before the
 * boxes; each box is one checkbox the user must tick (in order, for C6).
 */
export interface Checklist {
  readonly intro?: string;
  readonly boxes: readonly string[];
}

/** The checklist as one line of text, in the form SAFETY §6 writes it. */
export function renderChecklist(checklist: Checklist): string {
  const boxes = checklist.boxes.map((b) => `${BOX} ${b}`);
  return (checklist.intro === undefined ? boxes : [checklist.intro, ...boxes]).join(' ');
}

/** The words a user types for a typed confirmation (SAFETY §6). */
export const TYPED_WORDS = Object.freeze({
  /** C5 and C19 with a high-risk change, and the wiring "expected settings" accept. */
  write: 'WRITE',
  /** C10. */
  runUnhomed: 'RUN UNHOMED',
  /** C12. */
  background: 'BACKGROUND',
  /** C18. */
  leaveWithoutRestore: 'LEAVE WITHOUT RESTORE',
  /** C21. */
  noWakeLock: 'NO WAKE LOCK',
});

// ---------------------------------------------------------------- §5 warnings

/** W1: the persistent bar on every page of run.synthetos.com. */
export function w1(): string {
  return 'WARNING — This software is not an emergency stop. Your machine must have a hardwired E-stop that removes motor and spindle power. Keep it within reach whenever the machine is powered.';
}

/** W2: the pause button label, every TinyG dialect. */
export function w2Label(): string {
  return 'Pause (spindle stays on) — not an E-stop';
}

/** W2: the pause button tooltip. */
export function w2Tooltip(): string {
  return 'Decelerates and pauses motion. The spindle and coolant keep running. Use "Stop job" to stop with the spindle off, and your E-stop in an emergency.';
}

/** W3: the LOST banner (full width, `--danger`, `role="alert"`, audible tone). */
export function w3(): string {
  return 'DANGER — Connection lost. The machine may still be moving and the spindle may still be running. Use your E-stop if anything is unsafe. Machine position is now unknown.';
}

/** W4: the STALE banner. */
export function w4(p: { readonly seconds: number }): string {
  return `WARNING — No status from the machine for ${num('seconds', p.seconds)} s. Commands are blocked. What you see may be out of date.`;
}

/** W5: before Start, and while RUNNING. `seconds` is an estimate. */
export function w5(p: { readonly distanceMm: number; readonly seconds: number }): string {
  return (
    `WARNING — If this browser tab closes, crashes, sleeps or loses USB, the machine will continue the queued moves ` +
    `(up to ${num('distanceMm', p.distanceMm)} mm, about ${num('seconds', p.seconds)} s — an estimate) and the spindle will stay ` +
    'in its last state indefinitely, even after motion stops. A spindle left running against the work is a fire risk. ' +
    'Disable screen lock and sleep, keep this tab visible, and stay at the machine.'
  );
}

/** W5-HB: replaces W5 only on an image whose D8 heartbeat passed HB-1..HB-13, with `hbt` read back as armed. */
export function w5Hb(p: { readonly seconds: number }): string {
  return (
    `WARNING — If this tab stops responding, the controller is set to stop motion and turn the spindle off within about ` +
    `${num('seconds', p.seconds)} s. This is not an E-stop and can fail. Keep this tab visible and stay at the machine.`
  );
}

/** W6: previous session ended while LIVE; overrides NOT CONNECTED. */
export function w6(): string {
  return 'WARNING — The previous session ended while connected to a live machine. The machine may have kept moving after this page stopped. Check the machine before doing anything. Machine state is UNKNOWN until you reconnect and re-home.';
}

/** W7: the NOT CONNECTED band. */
export function w7(): string {
  return 'NOT CONNECTED — no machine. Preview and setup only; nothing on this page is moving a machine.';
}

/** W8: the LIVE band. */
export function w8(p: { readonly machineName: string; readonly boardId: string; readonly firmware: string; readonly port: string }): string {
  return (
    `LIVE — connected to ${text('machineName', p.machineName)} (${text('boardId', p.boardId)}, ${text('firmware', p.firmware)}) ` +
    `on ${text('port', p.port)}. Commands move the real machine.`
  );
}

/** W9: unhomed envelope, one axis. */
export function w9(p: { readonly axis: string }): string {
  return `Soft limits are inactive: axis ${text('axis', p.axis)} is not homed. The machine can travel past its limits.`;
}

/** W10: feedhold spindle note, every TinyG dialect. */
export function w10(): string {
  return 'On TinyG a feedhold does not stop the spindle or coolant. Use "Stop job" to end the job with the spindle off.';
}

/** W11: flash banner. */
export function w11(): string {
  return 'DANGER — Flashing resets the controller. Motors lose holding torque and outputs may switch on or toggle. Do not unplug the board or close this tab until flashing finishes. An interruption in the last seconds can leave the board needing a programmer.';
}

/** W12: stop not confirmed (`role="alert"`, tone). */
export function w12(): string {
  return 'DANGER — STOP NOT CONFIRMED. The machine did not report that it stopped. USE YOUR E-STOP.';
}

/** W13: preview disclaimer. */
export function w13(): string {
  return 'NOTICE — This preview uses our interpreter, not your firmware. It can miss problems. Configure homing and firmware soft limits ($sl=1).';
}

/** W14: watermark on a wiring export without an E-stop. */
export function w14Watermark(): string {
  return 'INCOMPLETE — NO E-STOP SHOWN';
}

/** W14: footer on a wiring export without an E-stop. */
export function w14Footer(): string {
  return 'This diagram does not replace a qualified electrician. Emergency stop circuits must remove motor and spindle power in hardware.';
}

/** W15: laser or plasma on TinyG, per build (`TG` stock 440.21, `EN` edge-next). */
export function w15(p: { readonly dialect: 'TG' | 'EN' }): string {
  const prefix = 'Laser and plasma control on TinyG is not supported by this tool.';
  return oneOf('dialect', p.dialect, ['TG', 'EN']) === 'TG'
    ? `${prefix} This firmware has no output polarity setting and a feedhold leaves the output on.`
    : `${prefix} A feedhold leaves the output on, so a laser would keep firing.`;
}

/** W16: reset button. */
export function w16(): string {
  return 'The reset button on the board is not an E-stop. A reset makes outputs float and may switch an active-low relay ON.';
}

/** W17: PROGRAM_PAUSED. */
export function w17(): string {
  return 'WARNING — Program paused. The spindle and coolant may still be running (UNCONFIRMED): this firmware does not turn them off at a program stop. Wait for the spindle to stop, or use your E-stop, before reaching in.';
}

/** W18: Reset controller. */
export function w18(): string {
  return 'WARNING — Resetting the controller drops motor holding torque, so axes that can fall (Z) may drop. Outputs float during the reset. Machine position will be lost and homing will be required.';
}

/** W19: session normalisation consent (OLD-S W19, verbatim). */
export function w19(): string {
  return 'NOTICE — These reporting settings are stored on the board. Other programs (CNCjs, ChiliPeppr, serial-port-json-server, your own scripts) read them too, and may stop working correctly if they change. This tool restores the original values when you disconnect normally. If this tab crashes, reconnect here and choose "Restore original reporting settings" before using another program.';
}

/** W20: after a polarity, motor-map, scale or travel write, before commissioning. */
export function w20(): string {
  return 'WARNING — Direction and distance are not verified. Before running anything, check with small moves (1 mm or less), hand on the E-stop, that each axis moves the right way and the right distance.';
}

/** W21: wiring and power, on the wiring checklist. */
export function w21(): string {
  return 'Switch motor power OFF before connecting or disconnecting motors.';
}

/**
 * W22: signed out or offline while LIVE (inline, not modal). Under D1 (sign-in
 * required) a new Start, jog, home or settings write needs sign-in again; a
 * running job and the never-gated actions do not (SAFETY §4.9).
 */
export function w22(): string {
  return 'Signed out. A running job and Pause, Stop and Spindle off are not affected. Sign in again to start a job, jog, home, or change settings. Cloud save is paused until you sign in again.';
}

/** W23: stored profile changed. */
export function w23(p: {
  readonly machineName: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly device: string;
  readonly date: string;
}): string {
  return (
    `WARNING — The saved profile for ${text('machineName', p.machineName)} changed since this browser last applied it ` +
    `(revision ${count('fromRevision', p.fromRevision)} → ${count('toRevision', p.toRevision)}, changed from ` +
    `${text('device', p.device)} on ${text('date', p.date)}). Nothing has been written to the controller. ` +
    'Review the differences before applying.'
  );
}

/** W24: a profile or file changed from a sign-in this browser has not seen. */
export function w24(p: { readonly kind: 'profile' | 'file'; readonly device: string; readonly date: string }): string {
  return (
    `WARNING — This ${oneOf('kind', p.kind, ['profile', 'file'])} was changed from a sign-in this browser has not seen before ` +
    `(${text('device', p.device)}, ${text('date', p.date)}). If you did not make this change, do not use it, and sign out ` +
    'everywhere from your account page.'
  );
}

/** W25: READ_ONLY firmware. `advice` picks the closing sentence. */
export function w25(p: { readonly fb: string; readonly reason: string; readonly advice: 'upgrade' | 'usual-sender' }): string {
  const advice =
    oneOf('advice', p.advice, ['upgrade', 'usual-sender']) === 'upgrade'
      ? 'Upgrade to the approved TinyG firmware'
      : 'Use your usual sender';
  return (
    `This controller's firmware (${text('fb', p.fb)}, ${text('reason', p.reason)}) is supported read-only. ` +
    `You can view settings and send a feedhold, but not move the machine. ${advice}.`
  );
}

/** W26: stop during a dwell. */
export function w26(): string {
  return 'The controller ignores feedhold while it is dwelling or waiting for the spindle. Use "Stop job" to stop now, or your E-stop.';
}

/** W27: Stop job result, EN. */
export function w27(): string {
  return 'Job stopped. The controller turned the spindle and coolant off and is in alarm 207. Check the machine, then clear the alarm to continue.';
}

/** W28: flash and factory-defaults window. */
export function w28(): string {
  return "DANGER — Keep spindle and VFD mains switched off. While flashing, while the board is in the bootloader and until your settings are restored, the controller's outputs float or use factory polarity, which can switch an active-low spindle relay or VFD ON.";
}

/** W29: observer tab after the controlling tab is gone. */
export function w29(): string {
  return 'NO TAB CONTROLS THIS MACHINE — the controlling tab closed or crashed. The machine may still be moving and the spindle may still be running. Use your E-stop.';
}

/** W30: state band during a hold, every TinyG dialect. */
export function w30(): string {
  return 'PAUSED — SPINDLE MAY BE RUNNING';
}

/** W31: hold timeout countdown. */
export function w31(p: { readonly seconds: number }): string {
  return `This job will be stopped with the spindle off in ${num('seconds', p.seconds)} s, because it is paused with the spindle on. Choose "Keep paused" to wait longer.`;
}

/** W32: ORPHANED_MOTION. */
export function w32(): string {
  return 'WARNING — This controller is paused, holding or still has queued moves from a previous session. This page did not send them and cannot resume them. Use "Stop job" to end them with the spindle off, or reset the controller.';
}

/** W33: liveness FAULT countdown (`role="alert"`, tone). */
export function w33(p: { readonly cause: string; readonly seconds: number }): string {
  return (
    `DANGER — This page lost track of the machine (${text('cause', p.cause)}). The machine is paused and the spindle may be ` +
    `running. The job will be stopped with the spindle off in ${num('seconds', p.seconds)} s. Check the machine now.`
  );
}

// ------------------------------------------------------------ §6 confirmations

/** C1, full form: the first time, on a text-version change, and once per calendar day in this browser. */
export function c1Full(): Checklist {
  return {
    intro: 'Before connecting, confirm:',
    boxes: [
      'A hardwired E-stop that removes motor and spindle power is installed and I tested it today.',
      'Limit switches or soft limits are configured, or I will keep moves small.',
      'The work area is clear of people, tools and loose items.',
      'I am wearing eye and ear protection.',
      'I will not leave the machine unattended while it is powered.',
    ],
  };
}

/** C1, short form. */
export function c1Short(): Checklist {
  return { boxes: ['My E-stop is within reach and I tested it today.'] };
}

/**
 * C3: first jog move per axis (OLD-S C3). `expectedSteps` is
 * `0.25 × (360/sa) × mi / tr`, computed by the jog plan from the board's
 * settings.
 */
export function c3(p: { readonly axis: string; readonly distanceMm: number; readonly feedMmPerMin: number; readonly expectedSteps: number }): string {
  return (
    `Axis ${text('axis', p.axis)} will move ${signed('distanceMm', p.distanceMm)} mm at ${num('feedMmPerMin', p.feedMmPerMin)} mm/min ` +
    `(expected ${num('expectedSteps', p.expectedSteps)} motor steps). Hand on E-stop?`
  );
}

/** C4, Phases 2–3: homing, with the search bound `|tm − tn| + lb` read from the controller. */
export function c4(p: { readonly searchMm: number }): string {
  return (
    'Home Z, then X, then Y. Each axis moves toward its switch until it triggers. The search can travel up to ' +
    `${num('searchMm', p.searchMm)} mm (|tm − tn| + lb from the controller's settings). Hand on E-stop?`
  );
}

/** C4, from Phase 4: the OLD-S C4 text, with the temporary homing search cap (SAFETY §4.5a). */
export function c4TemporaryCap(p: { readonly searchMm: number; readonly travelMin: number; readonly travelMax: number }): string {
  return (
    `Home Z, then X, then Y. Each axis moves toward its switch until it triggers (search limited to ${num('searchMm', p.searchMm)} mm). ` +
    `To limit the search, travel (${num('travelMin', p.travelMin)}/${num('travelMax', p.travelMax)}) is changed temporarily and ` +
    'restored after homing. Hand on E-stop?'
  );
}

/** C5: settings write. `changes` is the rendered change table; typed `WRITE` when `highRisk` is not empty. */
export function c5(p: {
  readonly settings: number;
  readonly machineName: string;
  readonly boardId: string;
  readonly changes: string;
  readonly highRisk: readonly string[];
}): string {
  return (
    `Write ${count('settings', p.settings)} settings to ${text('machineName', p.machineName)} (${text('boardId', p.boardId)})? ` +
    `Changes: ${text('changes', p.changes)}. High-risk changes: ${riskList(p.highRisk)}.`
  );
}

/**
 * C6: flash, the ordered checkboxes. The seven OLD-S C6 boxes, verbatim and
 * in their order, then the box SAFETY §6 adds for H47.
 */
export function c6Boxes(): Checklist {
  return {
    boxes: [
      '1. Motor power is OFF.',
      '2. Motors are unplugged from the board (only with power off).',
      '3. Any axis that can fall (Z) is lowered or supported.',
      '4. Spindle, VFD, laser and coolant mains power are switched off and isolated.',
      '5. The tool is clear of the work, and the E-stop is within reach.',
      "6. Motor power is back ON (TinyG's logic is powered from it).",
      '7. I have downloaded the settings backup.',
      'Spindle and VFD mains are switched off and will stay off until my settings are restored and confirmed',
    ],
  };
}

/** C6: flash, the final question after every box is ticked. */
export function c6Question(p: { readonly boardId: string; readonly fromBuild: string; readonly toBuild: string; readonly sha256Short: string }): string {
  return (
    `Flash TinyG ${text('boardId', p.boardId)} from build ${text('fromBuild', p.fromBuild)} to ${text('toBuild', p.toBuild)} ` +
    `(sha256 ${text('sha256Short', p.sha256Short)})?`
  );
}

/** A coordinate range `min..max`. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/** C7: Arm. One checkbox. */
export function c7(p: {
  readonly file: string;
  readonly sha256Short: string;
  readonly state: 'SAME' | 'NEW' | 'CHANGED';
  readonly lines: number;
  readonly units: 'mm' | 'inch';
  readonly wcs: string;
  readonly x: Range;
  readonly y: Range;
  readonly zMin: number;
  /** Spindle speed in rpm when the file turns the spindle on, otherwise `null`. */
  readonly spindleRpm: number | null;
  readonly estimated: string;
  readonly overrunMm: number;
  readonly overrunSeconds: number;
  readonly longestLineSeconds: number;
  readonly splitMoves: number;
  readonly wakeLock: 'ON' | 'OFF';
}): Checklist {
  const range = (name: string, r: Range): string => `${num(`${name}.min`, r.min)}..${num(`${name}.max`, r.max)}`;
  const spindle = p.spindleRpm === null ? 'spindle OFF' : `spindle ON S${num('spindleRpm', p.spindleRpm)}`;
  return {
    intro:
      `Arm job ${text('file', p.file)} (sha256 ${text('sha256Short', p.sha256Short)}, ${oneOf('state', p.state, ['SAME', 'NEW', 'CHANGED'])}): ` +
      `${count('lines', p.lines)} lines, units ${oneOf('units', p.units, ['mm', 'inch'])}, WCS ${text('wcs', p.wcs)} (read from machine), ` +
      `X ${range('x', p.x)}, Y ${range('y', p.y)}, Z min ${num('zMin', p.zMin)}, ${spindle}, estimated ${text('estimated', p.estimated)}, ` +
      `may continue up to ${num('overrunMm', p.overrunMm)} mm (about ${num('overrunSeconds', p.overrunSeconds)} s, estimate) ` +
      `if the connection is lost; no single line queues more than ${num('longestLineSeconds', p.longestLineSeconds)} s ` +
      `(${count('splitMoves', p.splitMoves)} long moves were split). Wake lock ${oneOf('wakeLock', p.wakeLock, ['ON', 'OFF'])}.`,
    boxes: ['E-stop in reach, work clamped, area clear, screen lock off.'],
  };
}

/** C8: Start, within 60 s of Arm. */
export function c8(p: { readonly file: string }): string {
  return `Start ${text('file', p.file)} now?`;
}

/** C9: Resume (OLD-S C9), first step. `spindle` is the reported state or `UNCONFIRMED`. */
export function c9(p: { readonly line: number; readonly spindle: string }): string {
  return `Resume held job (paused at line ${count('line', p.line)})? Spindle: ${text('spindle', p.spindle)}. Offsets unchanged since hold.`;
}

/** C9: Resume, the spindle-restart second step. */
export function c9SpindleRestart(p: { readonly direction: 'M3' | 'M4'; readonly rpm: number; readonly spinUpSeconds: number }): string {
  return (
    `Restart spindle ${oneOf('direction', p.direction, ['M3', 'M4'])} at S${num('rpm', p.rpm)} and wait ` +
    `${num('spinUpSeconds', p.spinUpSeconds)} s before motion?`
  );
}

/** C10: run with unhomed axes (expert mode). Typed `RUN UNHOMED`. */
export function c10(p: { readonly axes: readonly string[] }): string {
  return `Soft limits are inactive on ${list('axes', p.axes)}. Type ${TYPED_WORDS.runUnhomed} to continue.`;
}

/** C12: override `hold-and-spindle-pause` to `drain` for this session (OLD-S C12). Typed `BACKGROUND`. */
export function c12(): string {
  return `This machine is set to pause the job when this tab is hidden. Keep the job running in the background for this session instead? If the tab is hidden, the job continues and the spindle stays on. Type ${TYPED_WORDS.background}.`;
}

/** C13: clear an alarm. `meaning` is the meaning of the alarm code. */
export function c13(p: { readonly meaning: string }): string {
  return `Clear the alarm? ${text('meaning', p.meaning)}. Position may be wrong; homing will be required.`;
}

/** C13 for EN alarm 207 (the job was stopped by Stop job). */
export function c13En207(): string {
  return 'Clear the alarm? The job was stopped. Position is kept; homing is recommended.';
}

/** C14: preflight finds M6. Declining blocks the job. */
export function c14(p: { readonly toolChanges: number }): string {
  return (
    `This file has ${count('toolChanges', p.toolChanges)} tool changes (M6). The controller does not stop for M6. ` +
    'Insert "M5 M9 M0" before each M6? The sender will stop sending at each one and wait until the machine has stopped ' +
    'before asking you to change the tool.'
  );
}

/** C15: Reset controller (OLD-S C15), shown after W18. TinyG stock (`TG`) adds a sentence. */
export function c15(p: { readonly boardId: string; readonly dialect: 'TG' | 'EN' }): string {
  const base = `Reset controller ${text('boardId', p.boardId)} now? Holding torque drops and position is lost.`;
  return oneOf('dialect', p.dialect, ['TG', 'EN']) === 'TG'
    ? `${base} If the controller is stalled this may not work; press the reset button on the board.`
    : base;
}

/** C16: set work zero. */
export function c16(p: { readonly wcs: string; readonly axis: string; readonly machinePositionMm: number; readonly newOffsetMm: number }): string {
  return (
    `Set ${text('wcs', p.wcs)} ${text('axis', p.axis)} zero at the current position (machine ${num('machinePositionMm', p.machinePositionMm)} mm)? ` +
    `New offset: ${num('newOffsetMm', p.newOffsetMm)} mm. This offset is saved on the controller.`
  );
}

/** C17: restore after an abnormal end (OLD-S C17). */
export function c17(p: { readonly pending: string; readonly diff: string }): string {
  return `The last session ended before restoring ${text('pending', p.pending)}. Restore the original values now? ${text('diff', p.diff)}`;
}

/** C18: leaving the flasher before restoring. Typed `LEAVE WITHOUT RESTORE` (a hard stop instead in the H47 cases). */
export function c18(p: { readonly factoryDefaults: string }): string {
  return (
    `The board is running factory defaults (${text('factoryDefaults', p.factoryDefaults)}), which may not match your machine. ` +
    `Homing and jogging stay blocked until you restore. Type ${TYPED_WORDS.leaveWithoutRestore} to continue.`
  );
}

/** C19: apply a stored profile to the connected board. Typed `WRITE` when `highRisk` is not empty. */
export function c19(p: {
  readonly profileName: string;
  readonly revision: number;
  readonly machineName: string;
  readonly boardId: string;
  /** The key-level diff against this machine's baseline, with provenance per change. */
  readonly diff: string;
  readonly highRisk: readonly string[];
}): string {
  return (
    `Apply profile ${text('profileName', p.profileName)} revision ${count('revision', p.revision)} to ` +
    `${text('machineName', p.machineName)} (${text('boardId', p.boardId)})? ${text('diff', p.diff)}. ` +
    `High-risk changes: ${riskList(p.highRisk)}.`
  );
}

/** The C19 diff text when this computer has no baseline for the machine. */
export const C19_NO_BASELINE = 'No baseline on this computer';

/** C19 provenance labels for each change. */
export const C19_PROVENANCE = Object.freeze({ thisComputer: 'made on this computer', elsewhere: 'made elsewhere' });

/** C20: arm a file in state NEW. */
export function c20New(p: { readonly machineName: string }): string {
  return `This file has never been run on ${text('machineName', p.machineName)} from this browser. Review the preflight report below before arming.`;
}

/** C20: arm a file in state CHANGED. */
export function c20Changed(p: {
  readonly name: string;
  readonly machineName: string;
  readonly when: string;
  readonly device: string;
  readonly diffSummary: string;
}): string {
  return (
    `This file changed since you last ran '${text('name', p.name)}' on ${text('machineName', p.machineName)} ` +
    `(${text('when', p.when)}, from ${text('device', p.device)}). ${text('diffSummary', p.diffSummary)}. Review the changes before arming.`
  );
}

/** C21: start without a screen wake lock (expert mode). Typed `NO WAKE LOCK`. */
export function c21(): string {
  return `The screen may sleep or lock during this job, which can freeze or hide this tab. Type ${TYPED_WORDS.noWakeLock} to start anyway.`;
}

/**
 * C22: preflight finds that the job ends with the spindle or coolant on.
 * `spindle` is the end state, such as `on, S12000`; `coolant` such as `on`.
 */
export function c22(p: { readonly spindle: string; readonly coolant: string }): string {
  return (
    `This file ends with the spindle ${text('spindle', p.spindle)} and coolant ${text('coolant', p.coolant)} and no program end ` +
    'that turns them off. Append "M5 M9" so the job ends with them off?'
  );
}

/** C23: resolve NEEDS_REVIEW by updating the profile from the board. */
export function c23(p: { readonly machineName: string; readonly boardId: string; readonly revision: number }): string {
  return (
    `Keep the settings on ${text('machineName', p.machineName)} (${text('boardId', p.boardId)}) and save them as profile ` +
    `revision ${count('revision', p.revision)}? Nothing is written to the controller.`
  );
}
