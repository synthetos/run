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

/** W2: the pause button label, every TinyG dialect (amended 2026-11-02, OD-6: the single word "Pause"). */
export function w2Label(): string {
  return 'Pause';
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
  // Short wording approved by the owner, 2026-11-09 (OD-32: "approve with fire risk").
  return (
    `WARNING — If this tab closes or sleeps, the machine keeps moving (up to ${num('distanceMm', p.distanceMm)} mm, about ` +
    `${num('seconds', p.seconds)} s) and the spindle stays on, a fire risk. Keep this tab open and stay at the machine.`
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

/**
 * Short stop-path texts SAFETY quotes outside the numbered warnings
 * (§4.3 "Web Lock", §4.4 Pause step 4, §4.9 timeout row, the H-row for
 * other tabs). Not W-numbered; checked against SAFETY.md by strings.test.ts.
 */
export const STOP_TEXT = Object.freeze({
  /** §4.4 Pause step 4 (amended 2026-11-02): Pause was sent and no hold is reported yet. Brief; resolves. */
  pausing: 'Pausing…',
  /** §4.4 Pause step 4 (amended 2026-11-02): no hold reported within a couple of seconds of a Pause. */
  pauseNoAnswer: "No answer from the board yet: use your E-stop if it's still moving",
  /** §4.3, §4.9: a stop request no machine worker acknowledged within 250 ms. */
  notDelivered: 'STOP NOT DELIVERED — use your E-stop',
  /** §2 H-row and §4.3: an observer tab. */
  controlledElsewhere: 'Machine is controlled in another tab',
  /** §4.4, OD-6: the Stop job button label (no longer "spindle off"). */
  stopJob: 'Stop job',
  /** §4.4 step 5, OD-6: the machine strip while held. */
  paused: 'Paused',
  /** §4.4 step 5, OD-6: the machine strip while held with the spindle commanded on. */
  pausedSpindleOn: 'Paused · spindle still on',
  /** §4.4 step 5, OD-6: a Pause pressed while the machine was idle. */
  pausedIdle: 'Paused: the machine was idle, nothing changed',
  /** §4.4 Stop job, Phase 2 (§4.5b): the flush sequence completed. */
  stopped: 'Stopped: queue cleared, spindle and coolant off',
  /** §4.4 Resume, Phase 2 (§4.5b): `~` was written for a hold this session made. */
  resumed: 'Resumed',
});

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

/** W34: jog panel and confirmations while the machine is not homed (Phase 2, §4.5b). */
export function w34(): string {
  return 'WARNING — The machine is not homed, so soft limits may not protect it. A jog can drive an axis into its end. Use small steps and keep a hand on the E-stop.';
}

/**
 * W35: the session set the board's persisted status report list at connect (amendment 2026-11-02, H64). Shown in
 * the Run view and written to the session log.
 */
export function w35(): string {
  return "NOTICE — Run set this board's status report list to include machine position and spindle/coolant. The list is saved on the board, so other programs that read its status reports see the change too.";
}

/** W36: the session changed another persisted reporting setting (`sv`, or an absurd `si`) at connect (H64). */
export function w36(p: { readonly setting: string; readonly from: number; readonly to: number }): string {
  return (
    `NOTICE — Run changed a reporting setting saved on this board: ${text('setting', p.setting)} from ${num('from', p.from)} to ` +
    `${num('to', p.to)}. Other programs that read its status reports see the change too.`
  );
}

/**
 * W37: the tool-change card (Phase 3, H74). Run stopped before the M6, waited for the queue to drain and turned
 * the spindle and coolant off.
 */
export function w37(): string {
  return 'WARNING — Tool change. The job is stopped and Run turned the spindle and coolant off. Wait until the spindle has stopped turning before you reach in, and keep a hand on the E-stop while you jog.';
}

/** W38: a job line the controller refused (Phase 3, H70). The job is paused at that line. */
export function w38(p: { readonly line: number; readonly status: number; readonly meaning: string }): string {
  return (
    `WARNING — The controller refused line ${count('line', p.line)} (status ${count('status', p.status)}: ${text('meaning', p.meaning)}). ` +
    'The job is paused and nothing after that line is sent. Lines sent before it may still run. Use "Stop job", or skip the line and continue.'
  );
}

/** W39: run changed the board's line setting for a job (Phase 3, H77; plain wording, owner 2026-11-09). Saved on the board; put back when the job ends. */
export function w39(): string {
  return (
    'NOTICE — Run changed a board setting for this job: it sends the job one line at a time (saved on the board). Run puts the ' +
    'setting back when the job ends; if this page closes during the job, the next connect from this browser puts it back. ' +
    'Programs that count characters need the old setting.'
  );
}

/** W40: the controller reset during a job (Phase 3, H72). A FAULT. */
export function w40(p: { readonly line: number }): string {
  return (
    `DANGER — The controller reset during the job at line ${count('line', p.line)}. Everything queued is gone and the machine ` +
    'position is unknown. Outputs may have switched during the reset. Check the machine before doing anything.'
  );
}

/** W41: a breakpoint on a line already queued on the controller (Phase 3, H75). */
export function w41(p: { readonly line: number }): string {
  return `Line ${count('line', p.line)} is already queued on the controller, so a breakpoint there cannot stop the job.`;
}

/** W42: Stop job ended a running job (Phase 3, §4.4a): the flush sequence completed. */
export function w42(p: { readonly line: number }): string {
  return `Stopped at line ${count('line', p.line)}: queue cleared, spindle and coolant off`;
}

/** W43: the job stopped before a breakpoint line and the queue drained (Phase 3, H75). */
export function w43(p: { readonly line: number }): string {
  return `Stopped at breakpoint · line ${count('line', p.line)}`;
}

/** W44: run put the board's line-mode setting back at connect, outside a job (Phase 3, H77). */
export function w44(p: { readonly to: number }): string {
  return `NOTICE — Run had switched this board to line mode (rxm 1) for a job that did not end here. Run put it back to rxm ${count('to', p.to)} (saved on the board).`;
}

/** W45: the update changed the board's settings; the restore is required (firmware update, 2026-11-03, H81). */
export function w45(p: { readonly count: number }): string {
  return (
    `WARNING — The update changed this board's settings (${count('count', p.count)} differ from your backup taken before the update). ` +
    'Restore them before you use the machine. Jobs, jogging and settings changes stay locked until the restore is read back and the switch check is done.'
  );
}

/** W46: the switch check after an update that changed switch settings (firmware update, 2026-11-03, H82). */
export function w46(): string {
  return 'WARNING — Check your limit switches. The update changed the switch settings. Press and release each limit switch: Run unlocks jobs and jogging only after it has seen every one change.';
}

/** W47: unsigned custom firmware (firmware update, 2026-11-03, H85). */
export function w47(): string {
  return "WARNING — This is unsigned custom firmware. Run has not checked what it does. Run backs up the board's settings and its current firmware first, and the board stays read-only after the update unless you trust this build on this board.";
}

/** W48: the machine strip while a custom build the user trusted runs on the board (H87). */
export function w48(): string {
  return 'Custom firmware (trusted by you)';
}

/** W49: recovery, the board has no application (firmware update, 2026-11-03, H80). */
export function w49(p: { readonly seconds: number }): string {
  return `Unplug the USB cable and plug it back in now. Run is waiting for the bootloader: ${count('seconds', p.seconds)} s.`;
}

/** W50: the old-firmware gate (firmware update, 2026-11-03). */
export function w50(p: { readonly fb: string; readonly minimum: string }): string {
  return (
    `This board runs firmware ${text('fb', p.fb)}, older than the minimum ${text('minimum', p.minimum)} for its hardware. ` +
    'You can view it and back it up; update it to use jobs, jogging and settings changes.'
  );
}

/** W51: Pause during a probe (Probe Z, H90): a hold ends the G38.2 cycle, in ALARM 250 with no contact. */
export function w51(): string {
  return "Pause won't pause a probe: it ends it in an alarm. To stop, use Stop job. In an emergency, use your E-stop.";
}

/** W52: a dropped lead (Probe Z, H90): with a normally open plate the board cannot tell. */
export function w52(): string {
  return "If the lead comes off now, the board can't tell. Z keeps going to the depth limit. Keep your E-stop in reach.";
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
export function c4(p: { readonly axes: string; readonly searchMm: number }): string {
  return (
    `Home ${text('axes', p.axes)}? The machine will move each axis toward its homing switch until it triggers (the controller ` +
    `homes Z first). The search can travel up to ${num('searchMm', p.searchMm)} mm (|tm − tn| + lb from the controller's settings). Hand on E-stop?`
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

/**
 * C16: set work zero, one question for whichever axes are set (owner, 2026-11-09: "X, Y and Z", "Z"). The machine
 * positions and the new offsets are shown apart from it, in Advanced only.
 */
export function c16(p: { readonly wcs: string; readonly axes: string }): string {
  return `Set ${text('axes', p.axes)} zero at the tool's current position? The board saves it (as ${text('wcs', p.wcs)}), so it stays until you set zero again.`;
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

/** C24: manual spindle on (Phase 2, §4.5b). The user may turn it off for the rest of the browser session. */
export function c24(p: { readonly direction: 'CW' | 'CCW'; readonly rpm: number }): string {
  return `Spindle will start (${oneOf('direction', p.direction, ['CW', 'CCW'])}, S${num('rpm', p.rpm)}). Hands clear?`;
}

/** C25: go to work zero (Phase 2, §4.5b), with the path the session will send. */
export function c25(p: { readonly axes: string; readonly path: string }): string {
  return `Go to work zero on ${text('axes', p.axes)}? The machine will move: ${text('path', p.path)}. Keep a hand on the E-stop.`;
}

/**
 * C25's added sentence (OD-23, 2026-11-08) when the machine position is set but not by a homing cycle seen in this
 * connection: Z is not lifted, because the top of Z travel is not known.
 */
export function c25HandSet(): string {
  return 'The machine position was set by hand, so Run does not know the top of Z travel: raise Z first if the tool is near the work or a clamp.';
}

/**
 * C26: set the machine position here without moving, `G28.3` (amendment 2026-11-02, H67). For machines without homing
 * switches. Plain wording, owner 2026-11-09.
 */
export function c26(): string {
  return (
    "Set the machine's position to 0 here, without moving? Use this only on a machine without homing switches, with each " +
    'axis where you want machine zero. If this spot is wrong, the travel limits and every move after it are wrong too.'
  );
}

/** C27: a temporary offset, `G92` (amendment 2026-11-02, H68). */
export function c27(p: { readonly axes: string; readonly system: string }): string {
  return (
    `Set a temporary offset so that ${text('axes', p.axes)} read 0 here (G92)? It is not saved on the controller: a reset or a ` +
    `program end clears it, and Clear temporary offset (G92.1) removes it. The saved ${text('system', p.system)} offset does not change.`
  );
}

/** C28: clear the temporary offset, `G92.1` (amendment 2026-11-02, H68). */
export function c28(p: { readonly system: string }): string {
  return `Clear the temporary offset (G92.1)? Work positions go back to the saved ${text('system', p.system)} offsets.`;
}

/** C29: select the work coordinate system, `G54`..`G59` (amendment 2026-11-02). */
export function c29(p: { readonly system: string }): string {
  return `Use ${text('system', p.system)} for work coordinates? Work positions, Set work zero and Go to zero then use its saved offsets.`;
}

/** C30: start a job (Phase 3, §4.4a), with the work zero and the spindle the job will use. */
export function c30(p: { readonly file: string; readonly workZero: string; readonly spindle: string }): string {
  // Short wording, OD-32 (owner, 2026-11-09).
  return `Start ${text('file', p.file)}? Work zero: ${text('workZero', p.workZero)}. Spindle: ${text('spindle', p.spindle)}. Keep a hand on the E-stop.`;
}

/** The attestation's words in the one start tick (SAFETY §4.4 as amended by OD-32). */
export function startAttestTick(): string {
  return "I'll stay here, sleep off";
}

/** The one start tick: "I confirm: <phrase> · <phrase>." (OD-32), its phrases from C31, C36, C32 and the attestation. */
export function startTick(p: { readonly phrases: readonly string[] }): string {
  if (!Array.isArray(p.phrases) || p.phrases.length === 0) throw new SafetyStringError('phrases must be a non-empty list');
  return `I confirm: ${p.phrases.map((x, i) => text(`phrases[${i}]`, x)).join(' · ')}.`;
}

/** C31: the board's work zero is not the plan's (Phase 3, H73). */
export function c31(p: { readonly board: string; readonly plan: string }): string {
  return (
    `The board's work zero (${text('board', p.board)}) is not your plan's (${text('plan', p.plan)}). The job cuts where the board's ` +
    'work zero is. Use the board\'s work zero for this job?'
  );
}

/** C31's words in the one start tick (OD-32). */
export function c31Tick(): string {
  return "the board's work zero";
}

/** C32: the job turns the spindle on (Phase 3, H52, H74). */
export function c32(p: { readonly speeds: string }): string {
  return `This job starts the spindle (${text('speeds', p.speeds)}). It starts when that line runs, without another question. Hands clear of the cutter?`;
}

/** C32's words in the one start tick (OD-32). */
export function c32Tick(): string {
  return "hands clear";
}

/** C33: skip a refused line and continue (Phase 3, H70). */
export function c33(p: { readonly line: number; readonly text: string }): string {
  return (
    `Skip line ${count('line', p.line)} (${text('text', p.text)}) and continue? The controller refused it, so it did not run. ` +
    'The job continues with the next line, which may not be what the file meant.'
  );
}

/** C34: resume after a manual tool change (Phase 3, H74). */
export function c34(p: { readonly line: number; readonly tool: string }): string {
  return (
    `Resume with ${text('tool', p.tool)}? Run sends the tool change line ${count('line', p.line)}, returns to where the job stopped at a ` +
    'safe height if you moved the machine, and continues the job.'
  );
}

/** C35: start the spindle again after a tool change the file does not restart it after (Phase 3, H74). */
export function c35(p: { readonly direction: 'M3' | 'M4'; readonly rpm: number }): string {
  return (
    `The spindle was on before the tool change and the file does not start it again. Run starts it (${oneOf('direction', p.direction, ['M3', 'M4'])} ` +
    `S${num('rpm', p.rpm)}) before the job continues. Hands clear?`
  );
}

/** C36: start a job on a machine that is not homed (Phase 3, H73). */
export function c36(): string {
  return 'The machine is not homed, so soft limits may not protect it. Start only if you have checked where every axis is and that the job fits. I\'ve checked the machine.';
}

/** C36's words in the one start tick (OD-32). */
export function c36Tick(): string {
  return "axes checked";
}

/** C37: flash unsigned custom firmware (firmware update, 2026-11-03, H85). */
export function c37(p: { readonly name: string; readonly sha256Short: string; readonly boardId: string }): string {
  return (
    `Flash unsigned custom firmware ${text('name', p.name)} (sha256 ${text('sha256Short', p.sha256Short)}) to ${text('boardId', p.boardId)}? ` +
    'Run has not checked what it does. Your settings and the current firmware are backed up first.'
  );
}

/** C38: trust one custom build on one board (firmware update, 2026-11-03, H87). */
export function c38(p: { readonly name: string; readonly sha256Short: string; readonly boardId: string }): string {
  return (
    `Trust ${text('name', p.name)} (sha256 ${text('sha256Short', p.sha256Short)}) on board ${text('boardId', p.boardId)}? ` +
    'Run will let this exact build control this board as if it were approved. It never applies to another board or another build, and you can revoke it in Board → Firmware.'
  );
}

/**
 * C39: start a touch plate probe and set Z zero (Probe Z, H90). The page formats the numbers in its display units;
 * `zero` is the thickness less the stop distance, `stop` the calculated stop distance.
 */
/**
 * C40: the job could not be checked against the machine's travel (OD-24, 2026-11-08; wording approved by the owner,
 * 2026-11-08). `why` is the finding in plain words, e.g. "line 12: X would reach machine 812 mm, beyond its travel limit
 * of 800 mm, and the machine position was not set by a homing cycle in this connection".
 */
export function c40(p: { readonly why: string }): string {
  return `Run cannot check this job against the machine's travel: ${text('why', p.why)}. Start only if you have checked that every move fits the machine.`;
}

/** C40 as Start asks it, in the travel modal (OD-32): its title. */
export function c40Title(): string {
  return "Run can't check this job against the travel.";
}

/** C40 in the travel modal: why, then the rule. */
export function c40Body(p: { readonly why: string }): string {
  const why = text('why', p.why).replace(/\.$/, '');
  return `${why.charAt(0).toUpperCase()}${why.slice(1)}. Start only if every move fits.`;
}

/**
 * C41: start a job on a machine that is not homed when a move leaves an axis's travel (owner, 2026-11-09: one box
 * for C36 and C40, "yes use shorter words"). Names the first such move; `more` counts the moves past travel after it.
 */
export function c41(p: { readonly axis: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'; readonly line: number; readonly reach: number; readonly limit: number; readonly unit: 'mm' | '°'; readonly more: number }): string {
  const axis = oneOf('axis', p.axis, ['X', 'Y', 'Z', 'A', 'B', 'C']);
  const unit = oneOf('unit', p.unit, ['mm', '°']);
  const more = count('more', p.more);
  return (
    `${axis} isn't homed, so Run can't check its travel and soft limits may not protect it. ` +
    `Line ${count('line', p.line)}: ${axis} would reach ${num('reach', p.reach)} ${unit}, past its ${num('limit', p.limit)} ${unit} limit${more === '0' ? '' : `, and ${more} more`}. ` +
    "I've checked where every axis is and that every move fits."
  );
}

/** C41 in the travel modal (OD-32): its title. */
export function c41Title(p: { readonly axis: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C' }): string {
  return `This job goes past the ${oneOf('axis', p.axis, ['X', 'Y', 'Z', 'A', 'B', 'C'])} limit.`;
}

/** C41 in the travel modal: the first move past travel, and whether others follow (a count of moves is not shown). */
export function c41Body(p: { readonly axis: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'; readonly line: number; readonly reach: number; readonly limit: number; readonly unit: 'mm' | '°'; readonly more: number }): string {
  const axis = oneOf('axis', p.axis, ['X', 'Y', 'Z', 'A', 'B', 'C']);
  const unit = oneOf('unit', p.unit, ['mm', '°']);
  const more = count('more', p.more);
  return (
    `Line ${count('line', p.line)} moves ${axis} to ${num('reach', p.reach)} ${unit}. ${axis} stops at ${num('limit', p.limit)} ${unit}. ` +
    `${axis} isn't homed, so its position may be off.${more === '0' ? '' : ' Other lines go past too.'}`
  );
}

/** Added to C41 in the travel modal when the board's work zero is not the plan's (OD-32). */
export function c41ZeroFirst(): string {
  return "Your work zero isn't where you planned it.";
}

export function c39(p: { readonly feed: string; readonly depth: string; readonly system: string; readonly zero: string; readonly thickness: string; readonly stop: string }): string {
  return (
    `Probe Z? Z will move down at ${text('feed', p.feed)} mm/min until the board reports contact, up to ${text('depth', p.depth)} mm. ` +
    `On contact Run sets ${text('system', p.system)} Z so the tool reads ${text('zero', p.zero)} mm above the work (plate ${text('thickness', p.thickness)} mm, less ${text('stop', p.stop)} mm calculated stop distance). ` +
    'This is saved on the controller.'
  );
}
