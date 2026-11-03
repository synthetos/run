/**
 * Hand overlay for `tinyg-en` (TinyG edge-next @ 93a723b8): the
 * motion-relevant settings, the EN polarity keys and the session key `os`
 * (ROADMAP P0-09, old P0-10 subset; RUN_PLAN §7.2; SAFETY §4.6).
 *
 * Every entry is cited to its cfgArray row (`src`). Ranges are the firmware's
 * own checks where it has them (cited), otherwise a host bound (`host:`)
 * that refuses values no real machine uses (typing errors, unit mix-ups),
 * never a bound tighter than a plausible machine needs.
 *
 * Units are the firmware's millimetre units: every write happens under G21
 * (SAFETY §4.6 step 5), so `convert` keys are never written in inches.
 *
 * CODEOWNERS: the owner reviews every change.
 */
import type { EnumValue, OverlayEntry, Range, TypedConfirm, Unit } from './types.ts';

/** cfgArray row of each key in EN config_app.c @ 93a723b8. */
const ROW: Readonly<Record<string, number>> = Object.freeze({
  '1ma': 211, '1sa': 212, '1tr': 213, '1mi': 214, '1po': 215, '1pm': 216,
  '2ma': 221, '2sa': 222, '2tr': 223, '2mi': 224, '2po': 225, '2pm': 226,
  '3ma': 232, '3sa': 233, '3tr': 234, '3mi': 235, '3po': 236, '3pm': 237,
  '4ma': 243, '4sa': 244, '4tr': 245, '4mi': 246, '4po': 247, '4pm': 248,
  xam: 276, xvm: 277, xfr: 278, xtn: 279, xtm: 280, xjm: 281, xjh: 282, xjd: 283, xsn: 284, xsx: 285, xsv: 286, xlv: 287, xlb: 288, xzb: 289,
  yam: 291, yvm: 292, yfr: 293, ytn: 294, ytm: 295, yjm: 296, yjh: 297, yjd: 298, ysn: 299, ysx: 300, ysv: 301, ylv: 302, ylb: 303, yzb: 304,
  zam: 306, zvm: 307, zfr: 308, ztn: 309, ztm: 310, zjm: 311, zjh: 312, zjd: 313, zsn: 314, zsx: 315, zsv: 316, zlv: 317, zlb: 318, zzb: 319,
  aam: 321, avm: 322, afr: 323, atn: 324, atm: 325, ajm: 326, ajh: 327, ajd: 328, ara: 329, asn: 330, asx: 331, asv: 332, alv: 333, alb: 334, azb: 335,
  bam: 337, bvm: 338, bfr: 339, btn: 340, btm: 341, bjm: 342, bjd: 343, bra: 344,
  cam: 356, cvm: 357, cfr: 358, ctn: 359, ctm: 360, cjm: 361, cjd: 362, cra: 363,
  sl: 460, st: 461, mt: 462, gun: 520, gdi: 523, spep: 649, spdp: 650, prbp: 656, os: 667,
});

const ALWAYS: TypedConfirm = { kind: 'always' };
const NEVER: TypedConfirm = { kind: 'never' };
const DOUBLED: TypedConfirm = { kind: 'increaseFactor', factor: 2 };

const VELOCITY_RANGE: Range = { min: 0, max: 200_000, minExclusive: true };
const VELOCITY_SOURCE = 'host: greater than 0; 200 000 per minute is far above any TinyG machine';
const TRAVEL_RANGE: Range = { min: -100_000, max: 100_000 };
const TRAVEL_SOURCE = 'host: a finite position within ±100 m (or ±100 000°); across keys tn < tm, at least 0.01 apart, and a range the firmware soft-limit test sees as one (float32, not fp_EQ, both ends above DISABLE_SOFT_LIMIT; travel.ts)';
const JERK_RANGE: Range = { min: 0, max: 100_000, minExclusive: true };
const JERK_SOURCE =
  'EN canonical_machine.c:2681 (E158: 0 or less refused with 108); host: at most 100 000 (millions), so the firmware never applies its ' +
  'divide-by-a-million path for values above 1 000 000 (canonical_machine.c:2684-2686), which would change the meaning of the number';
const BACKOFF_RANGE: Range = { min: 0, max: 1000 };
const BACKOFF_SOURCE = 'host: 0 to 1000; a negative latch backoff fails homing with 245 (EN error.h:361)';

function entry(key: string, fields: Omit<OverlayEntry, 'key' | 'src'>): OverlayEntry {
  // A key without a recorded row has no line; the overlay tests refuse any
  // entry whose line is not a cfgArray row number.
  const line = ROW[key] as number;
  return Object.freeze({
    key,
    ...fields,
    ...(fields.values === undefined ? {} : { values: Object.freeze(fields.values.map((v) => Object.freeze({ ...v }))) }),
    ...(fields.hwAllowed === undefined ? {} : { hwAllowed: Object.freeze([...fields.hwAllowed]) }),
    range: Object.freeze({ ...fields.range }),
    typedConfirm: Object.freeze({ ...fields.typedConfirm }),
    invalidates: Object.freeze([...fields.invalidates]),
    src: Object.freeze({ tag: 'EN', file: 'config_app.c', line }),
  });
}

function enumRange(values: readonly EnumValue[]): Range {
  const nums = values.map((v) => v.value);
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

// --- Motors 1..4 -------------------------------------------------------------

const AXIS_INDEX: readonly EnumValue[] = [
  { value: 0, label: 'X' },
  { value: 1, label: 'Y' },
  { value: 2, label: 'Z' },
  { value: 3, label: 'A' },
  { value: 4, label: 'B' },
  { value: 5, label: 'C' },
];

function motor(m: string): OverlayEntry[] {
  return [
    entry(`${m}ma`, {
      label: `Motor ${m} axis`,
      description: `The axis motor ${m} drives.`,
      unit: 'enum',
      valueType: 'integer',
      values: AXIS_INDEX,
      range: enumRange(AXIS_INDEX),
      rangeSource: 'EN config_app.c:1073-1079 (set_ma refuses an axis index of 6 or more, E112)',
      convert: false,
      scope: 'persisted',
      risk: 'high',
      typedConfirm: ALWAYS,
      afterWrite: 'W20',
      invalidates: ['dir.*', 'homing.*'],
      whatGoesWrong: 'A motor mapped to the wrong axis moves the wrong part of the machine, and a jog or homing move drives that part into its end stop.',
    }),
    entry(`${m}sa`, {
      label: `Motor ${m} step angle`,
      description: `Degrees per full step of motor ${m} (1.8 for a 200-step motor).`,
      unit: 'deg/step',
      valueType: 'number',
      range: { min: 0, max: 360, minExclusive: true },
      rangeSource: 'EN stepper.c:1350 (E158: 0 or less refused with 108); host: at most one revolution',
      e158: true,
      convert: false,
      scope: 'persisted',
      risk: 'high',
      typedConfirm: NEVER,
      afterWrite: 'W20',
      invalidates: ['scale.*', 'homing.*', 'softlimits'],
      whatGoesWrong: 'A wrong step angle scales every move on the axes this motor drives: the machine travels further or less than commanded and can leave its envelope.',
    }),
    entry(`${m}tr`, {
      label: `Motor ${m} travel per revolution`,
      description: `Millimetres (or degrees, on a rotary axis) the axis moves per motor revolution: screw lead, or belt pitch × pulley teeth.`,
      unit: 'mm/rev',
      valueType: 'number',
      range: { min: 0, max: 1000, minExclusive: true },
      rangeSource: 'EN stepper.c:1364 (E158: 0 or less refused with 108); host: at most 1000 per revolution',
      e158: true,
      convert: true,
      scope: 'persisted',
      risk: 'high',
      typedConfirm: NEVER,
      afterWrite: 'W20',
      invalidates: ['scale.*', 'homing.*', 'softlimits'],
      whatGoesWrong: 'A wrong travel per revolution scales every move: a 5 mm lead entered as 8 makes every move 60% too long.',
    }),
    entry(`${m}mi`, {
      label: `Motor ${m} microsteps`,
      description: `Microstep setting of the motor ${m} driver.`,
      unit: 'microsteps',
      valueType: 'integer',
      range: { min: 1, max: 8 },
      rangeSource: 'EN stepper.c:1380-1385 (0 refused with 108, E158; other values than 1, 2, 4, 8 accepted with a warning)',
      hwAllowed: [1, 2, 4, 8],
      e158: true,
      convert: false,
      scope: 'persisted',
      risk: 'high',
      typedConfirm: NEVER,
      afterWrite: 'W20',
      invalidates: ['scale.*', 'homing.*', 'softlimits'],
      whatGoesWrong: 'The TinyG v8 drivers support only 1, 2, 4 and 8 microsteps. Any other value is stored anyway, so the scale no longer matches what the driver does.',
    }),
    entry(`${m}po`, {
      label: `Motor ${m} polarity`,
      description: `Direction of motor ${m}: 0 normal, 1 reversed.`,
      unit: 'enum',
      valueType: 'integer',
      values: [
        { value: 0, label: 'normal' },
        { value: 1, label: 'reversed' },
      ],
      range: { min: 0, max: 1 },
      rangeSource: 'EN stepper.c:1511 [0=normal,1=reverse] (set_01)',
      convert: false,
      scope: 'persisted',
      risk: 'high',
      typedConfirm: ALWAYS,
      afterWrite: 'W20',
      invalidates: ['dir.*', 'homing.*'],
      whatGoesWrong: 'A reversed motor drives the axis the wrong way: homing runs away from its switch into the opposite end, and soft limits protect the wrong side.',
    }),
    entry(`${m}pm`, {
      label: `Motor ${m} power management`,
      description: `When motor ${m} is energized.`,
      unit: 'enum',
      valueType: 'integer',
      values: [
        { value: 0, label: 'disabled' },
        { value: 1, label: 'always on' },
        { value: 2, label: 'on in cycle' },
        { value: 3, label: 'on when moving' },
      ],
      range: { min: 0, max: 3 },
      rangeSource: 'EN stepper.c:1392-1398 (st_set_pm refuses MOTOR_POWER_MODE_MAX_VALUE = 4 or more, stepper.h:266-272)',
      convert: false,
      scope: 'persisted',
      risk: 'medium',
      typedConfirm: NEVER,
      afterWrite: null,
      invalidates: [],
      whatGoesWrong: 'Modes 0, 2 and 3 de-energize the motor when it is not moving: holding torque is lost, and an unbraked Z axis can fall under its own weight.',
    }),
  ];
}

// --- Axes ----------------------------------------------------------------------

type AxisKind = 'linear' | 'rotary';

function units(kind: AxisKind): { pos: Unit; vel: Unit; jerk: Unit } {
  return kind === 'linear' ? { pos: 'mm', vel: 'mm/min', jerk: 'Mmm/min3' } : { pos: 'deg', vel: 'deg/min', jerk: 'Mdeg/min3' };
}

/** Linear axes convert to inches under G20; rotary axes do not (their rows are `_fip`, not `_fipc`). */
const CONVERTS = (kind: AxisKind): boolean => kind === 'linear';

const LINEAR_MODES: readonly EnumValue[] = [
  { value: 0, label: 'disabled' },
  { value: 1, label: 'standard' },
  { value: 2, label: 'inhibited' },
];
const ROTARY_MODES: readonly EnumValue[] = [...LINEAR_MODES, { value: 3, label: 'radius' }];

const SWITCH_MODES: readonly EnumValue[] = [
  { value: 0, label: 'off' },
  { value: 1, label: 'homing' },
  { value: 2, label: 'limit' },
  { value: 3, label: 'limit + homing' },
  { value: 4, label: 'probe' },
];

function axisCore(a: string, kind: AxisKind): OverlayEntry[] {
  const u = units(kind);
  const A = a.toUpperCase();
  const modes = kind === 'linear' ? LINEAR_MODES : ROTARY_MODES;
  return [
    entry(`${a}am`, {
      label: `${A} axis mode`,
      description: `How the ${A} axis takes part in motion.`,
      unit: 'enum',
      valueType: 'integer',
      values: modes,
      range: enumRange(modes),
      rangeSource: 'EN canonical_machine.c:2616-2629 (linear axes up to 2, rotary up to 3; canonical_machine.h:287-293)',
      convert: false,
      scope: 'persisted',
      risk: 'high',
      // Radius mode (rotary only) reads the ${A} word in linear units and turns it into degrees
      // (@cite EN canonical_machine.c:497-500 `_calc_ABC`): one setting multiplies every ${A} move by
      // 360 / (2π × ra). The sanitiser models it from the live `am`/`ra`, and the change is typed (C5).
      typedConfirm: kind === 'rotary' ? ALWAYS : NEVER,
      afterWrite: null,
      invalidates: [`homing.${a}`, 'job.*.preflight'],
      // Inhibited: the kinematics force the joint to 0 on every segment (@cite EN kinematics.c:59), so the
      // motor is driven to step 0 by any move; the sanitiser blocks motion while such an axis reads away from 0.
      whatGoesWrong:
        kind === 'rotary'
          ? `Disabled, the ${A} axis ignores its words while jobs and the preview assume it moves. Inhibited, its position follows the program but its motor is held at step 0: the next move of ANY axis drives the motor there, so inhibiting ${A} away from 0 moves it back to 0, and leaving inhibited mode away from 0 moves it out to its position. In radius mode every ${A} word is read as a length and turned into degrees, so ${A} turns 360 / (2π × radius) degrees per mm (about 57× at radius 1).`
          : `Disabled, the ${A} axis ignores its words while jobs and the preview assume it moves. Inhibited, its position follows the program but its motor is held at step 0: the next move of ANY axis drives the motor there, so inhibiting ${A} away from 0 moves it back to 0, and leaving inhibited mode away from 0 moves it out to its position.`,
    }),
    entry(`${a}vm`, {
      label: `${A} maximum velocity`,
      description: `Velocity of ${A} rapid (G0) moves.`,
      unit: u.vel,
      valueType: 'number',
      range: VELOCITY_RANGE,
      rangeSource: VELOCITY_SOURCE,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'high',
      typedConfirm: DOUBLED,
      afterWrite: null,
      invalidates: ['job.*.preflight'],
      whatGoesWrong: 'Too high, the motors stall and lose position without any error; every later move is offset by the lost steps.',
    }),
    entry(`${a}fr`, {
      label: `${A} maximum feed rate`,
      description: `Highest feed (G1, G2, G3) velocity on ${A}.`,
      unit: u.vel,
      valueType: 'number',
      range: VELOCITY_RANGE,
      rangeSource: VELOCITY_SOURCE,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'high',
      typedConfirm: DOUBLED,
      afterWrite: null,
      invalidates: ['job.*.preflight'],
      whatGoesWrong: 'Too high, feed moves can stall the motors and lose position; too low, jobs run slower than programmed.',
    }),
    entry(`${a}tn`, {
      label: `${A} travel minimum`,
      description: `Lowest ${A} machine coordinate: the soft-limit and homing-search bound.`,
      unit: u.pos,
      valueType: 'number',
      range: TRAVEL_RANGE,
      rangeSource: TRAVEL_SOURCE,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'high',
      typedConfirm: ALWAYS,
      afterWrite: 'W20',
      invalidates: ['softlimits', 'job.*.preflight'],
      whatGoesWrong: 'A travel range larger than the machine lets soft limits and preflight pass moves that crash into the frame; homing searches that far before it gives up.',
    }),
    entry(`${a}tm`, {
      label: `${A} travel maximum`,
      description: `Highest ${A} machine coordinate: the soft-limit and homing-search bound.`,
      unit: u.pos,
      valueType: 'number',
      range: TRAVEL_RANGE,
      rangeSource: TRAVEL_SOURCE,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'high',
      typedConfirm: ALWAYS,
      afterWrite: 'W20',
      invalidates: ['softlimits', 'job.*.preflight'],
      whatGoesWrong: 'A travel range larger than the machine lets soft limits and preflight pass moves that crash into the frame; homing searches that far before it gives up.',
    }),
    entry(`${a}jm`, {
      label: `${A} maximum jerk`,
      description: `Jerk limit of ${A} moves, in millions (5000 = 5 000 000 000 per minute³).`,
      unit: u.jerk,
      valueType: 'number',
      range: JERK_RANGE,
      rangeSource: JERK_SOURCE,
      e158: true,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'high',
      typedConfirm: DOUBLED,
      afterWrite: null,
      invalidates: ['job.*.preflight'],
      whatGoesWrong: 'Too high, acceleration exceeds what the motors can deliver and they lose steps silently; a stop also takes longer to come to rest than the overrun bound assumes.',
    }),
    entry(`${a}jd`, {
      label: `${A} junction deviation`,
      description: `How far the path may round a corner at speed on ${A} (larger is faster).`,
      unit: u.pos,
      valueType: 'number',
      range: { min: 0, max: 5, minExclusive: true },
      rangeSource: 'host: greater than 0 and at most 5 (typical values are hundredths of a millimetre)',
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'medium',
      typedConfirm: NEVER,
      afterWrite: null,
      invalidates: ['job.*.preflight'],
      whatGoesWrong: 'Too large, corners are taken too fast and the motors can lose steps.',
    }),
  ];
}

function axisHoming(a: string, kind: AxisKind): OverlayEntry[] {
  const u = units(kind);
  const A = a.toUpperCase();
  const switchEntry = (end: 'n' | 'x'): OverlayEntry =>
    entry(`${a}s${end}`, {
      label: `${A} ${end === 'n' ? 'minimum' : 'maximum'} switch mode`,
      description: `What the ${A} ${end === 'n' ? 'minimum' : 'maximum'} switch input does.`,
      unit: 'enum',
      valueType: 'integer',
      values: SWITCH_MODES,
      range: enumRange(SWITCH_MODES),
      rangeSource: 'EN switch.c:350-358 (sw_set_sw refuses more than SW_MODE_MAX_VALUE = 4, switch.h:42-47)',
      convert: false,
      scope: 'persisted',
      risk: 'high',
      typedConfirm: ALWAYS,
      afterWrite: null,
      invalidates: ['switch.*', 'homing.*'],
      whatGoesWrong:
        'A limit switch set to off no longer stops the machine at the end of travel. A homing switch on the wrong end, or on both ends, makes homing fail or drive into the far end.',
    });
  return [
    entry(`${a}jh`, {
      label: `${A} homing jerk`,
      description: `Jerk used when homing and when stopping at a switch on ${A}, in millions.`,
      unit: u.jerk,
      valueType: 'number',
      range: JERK_RANGE,
      rangeSource: JERK_SOURCE,
      e158: true,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'medium',
      typedConfirm: DOUBLED,
      afterWrite: null,
      invalidates: [`homing.${a}`],
      whatGoesWrong: 'Too low, the axis overruns its switch before it stops; too high, the motors lose steps while homing.',
    }),
    switchEntry('n'),
    switchEntry('x'),
    entry(`${a}sv`, {
      label: `${A} homing search velocity`,
      description: `Velocity of the ${A} homing search towards the switch.`,
      unit: u.vel,
      valueType: 'number',
      range: VELOCITY_RANGE,
      rangeSource: `${VELOCITY_SOURCE} (0 fails homing with 242, EN error.h:358)`,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'medium',
      typedConfirm: NEVER,
      afterWrite: null,
      invalidates: [`homing.${a}`],
      whatGoesWrong: 'Too fast, the axis hits the switch hard and overruns it before it can stop.',
    }),
    entry(`${a}lv`, {
      label: `${A} homing latch velocity`,
      description: `Velocity of the slow ${A} move off the switch that sets the home position.`,
      unit: u.vel,
      valueType: 'number',
      range: VELOCITY_RANGE,
      rangeSource: `${VELOCITY_SOURCE} (0 fails homing with 243, EN error.h:359)`,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'medium',
      typedConfirm: NEVER,
      afterWrite: null,
      invalidates: [`homing.${a}`],
      whatGoesWrong: 'Too fast, the home position repeats poorly from one homing to the next.',
    }),
    entry(`${a}lb`, {
      label: `${A} latch backoff`,
      description: `How far ${A} backs off the switch to release it while homing.`,
      unit: u.pos,
      valueType: 'number',
      range: BACKOFF_RANGE,
      rangeSource: BACKOFF_SOURCE,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'medium',
      typedConfirm: NEVER,
      afterWrite: null,
      invalidates: [`homing.${a}`],
      whatGoesWrong: 'Too short, the switch never releases and homing fails; too long, the axis moves further than expected after touching the switch.',
    }),
    entry(`${a}zb`, {
      label: `${A} zero backoff`,
      description: `How far ${A} moves off the switch after homing before it sets zero.`,
      unit: u.pos,
      valueType: 'number',
      range: BACKOFF_RANGE,
      rangeSource: BACKOFF_SOURCE,
      convert: CONVERTS(kind),
      scope: 'persisted',
      risk: 'medium',
      typedConfirm: NEVER,
      afterWrite: null,
      invalidates: [`homing.${a}`, 'job.*.preflight'],
      whatGoesWrong: 'Zero stays on the switch: a limit switch can then trip during the first move of a job.',
    }),
  ];
}

function radius(a: string): OverlayEntry {
  const A = a.toUpperCase();
  return entry(`${a}ra`, {
    label: `${A} radius`,
    description: `Radius used to convert linear units to degrees when ${A} is in radius mode.`,
    unit: 'mm',
    valueType: 'number',
    range: { min: 0, max: 10_000, minExclusive: true },
    rangeSource: 'host: greater than 0 and at most 10 m',
    convert: true,
    scope: 'persisted',
    risk: 'medium',
    typedConfirm: NEVER,
    afterWrite: null,
    invalidates: [`scale.${a}`, 'job.*.preflight'],
    whatGoesWrong: `In radius mode a wrong radius scales every ${A} move.`,
  });
}

// --- System ----------------------------------------------------------------------

function onOff(off: string, on: string): readonly EnumValue[] {
  return [
    { value: 0, label: off },
    { value: 1, label: on },
  ];
}

const SYSTEM: readonly OverlayEntry[] = [
  entry('st', {
    label: 'Switch type',
    description: 'Whether every homing and limit switch is normally open (0) or normally closed (1).',
    unit: 'enum',
    valueType: 'integer',
    values: onOff('normally open', 'normally closed'),
    range: { min: 0, max: 1 },
    rangeSource: 'EN switch.c:343-348 (set_01; E106); switch.h:50-51',
    convert: false,
    scope: 'persisted',
    risk: 'high',
    typedConfirm: ALWAYS,
    afterWrite: null,
    invalidates: ['switch.*', 'homing.*'],
    whatGoesWrong: 'The wrong type makes every switch read as pressed or never pressed: limits trip at once, or never trip at all and the axis drives into its end.',
  }),
  entry('sl', {
    label: 'Soft limits',
    description: 'Refuse moves outside the travel range once the axes are homed.',
    unit: 'enum',
    valueType: 'integer',
    values: onOff('off', 'on'),
    range: { min: 0, max: 1 },
    rangeSource: 'host: 0 or 1 (set_ui8 does not check)',
    convert: false,
    scope: 'persisted',
    risk: 'high',
    typedConfirm: { kind: 'whenValue', value: 0 },
    afterWrite: null,
    invalidates: ['softlimits'],
    whatGoesWrong: 'With soft limits off, a G-code or jog error drives the machine past the end of travel.',
  }),
  entry('gun', {
    label: 'Default units',
    description: 'Units mode at power-up and after a program end: 0 inches (G20), 1 millimetres (G21).',
    unit: 'enum',
    valueType: 'integer',
    values: onOff('inches (G20)', 'millimetres (G21)'),
    range: { min: 0, max: 1 },
    rangeSource: 'EN canonical_machine.c:2865 [0=G20,1=G21] (set_01)',
    convert: false,
    scope: 'persisted',
    risk: 'medium',
    typedConfirm: NEVER,
    afterWrite: null,
    invalidates: ['job.*.preflight'],
    whatGoesWrong: 'A file without G20/G21 runs in the default units: a millimetre file read as inches moves 25.4 times too far.',
  }),
  entry('gdi', {
    label: 'Default distance mode',
    description: 'Distance mode at power-up and after a program end: 0 absolute (G90), 1 incremental (G91).',
    unit: 'enum',
    valueType: 'integer',
    values: onOff('absolute (G90)', 'incremental (G91)'),
    range: { min: 0, max: 1 },
    rangeSource: 'EN canonical_machine.c:2868 [0=G90,1=G91] (set_01)',
    convert: false,
    scope: 'persisted',
    risk: 'medium',
    typedConfirm: NEVER,
    afterWrite: null,
    invalidates: ['job.*.preflight'],
    whatGoesWrong: 'A file that assumes absolute coordinates runs every move relative to the last one in G91.',
  }),
  entry('mt', {
    label: 'Motor idle timeout',
    description: 'Seconds after motion stops before motors in power modes 2 and 3 are de-energized.',
    unit: 's',
    valueType: 'number',
    range: { min: 0.1, max: 4_294_967 },
    rangeSource: 'EN stepper.c:1459-1464 and stepper.h:281-282 (the firmware clamps to this range; the host refuses instead of letting it clamp)',
    convert: false,
    scope: 'persisted',
    risk: 'medium',
    typedConfirm: NEVER,
    afterWrite: null,
    invalidates: [],
    whatGoesWrong: 'A short timeout drops holding torque soon after each move: an unbraked Z axis can fall.',
  }),
  entry('spep', {
    label: 'Spindle enable polarity',
    description: 'Level of the spindle enable output for ON: 0 active low, 1 active high (the factory default).',
    unit: 'enum',
    valueType: 'integer',
    values: onOff('active low', 'active high'),
    range: { min: 0, max: 1 },
    rangeSource: 'EN spindle.c:62-81 (more than 1 refused; refused while the spindle is on or the planner is busy); config_app.c:1101',
    convert: false,
    scope: 'persisted',
    risk: 'polarity',
    typedConfirm: ALWAYS,
    afterWrite: null,
    invalidates: ['outputs.spindle'],
    whatGoesWrong:
      'With the wrong polarity, "spindle off" drives the output to the level an active-low relay or VFD reads as ON: the spindle starts when the app shows it stopped (SAFETY H11).',
  }),
  entry('spdp', {
    label: 'Spindle direction polarity',
    description: 'Level of the spindle direction output for clockwise: 0 low, 1 high.',
    unit: 'enum',
    valueType: 'integer',
    values: onOff('CW low', 'CW high'),
    range: { min: 0, max: 1 },
    rangeSource: 'EN spindle.c:62-81 (more than 1 refused; refused while the spindle is on or the planner is busy); config_app.c:1102',
    convert: false,
    scope: 'persisted',
    risk: 'polarity',
    typedConfirm: ALWAYS,
    afterWrite: null,
    invalidates: ['outputs.spindle'],
    whatGoesWrong: 'The spindle turns the opposite way to M3/M4: tools cut backwards, and threaded tool holders can loosen.',
  }),
  entry('prbp', {
    label: 'Probe input polarity',
    description: 'Whether the probe input is normally open (0) or normally closed (1), independent of the switch type.',
    unit: 'enum',
    valueType: 'integer',
    values: onOff('normally open', 'normally closed'),
    range: { min: 0, max: 1 },
    rangeSource: 'EN switch.c:327-341 (more than 1 refused; refused while a cycle runs); config_app.c:1103',
    convert: false,
    scope: 'persisted',
    risk: 'polarity',
    typedConfirm: ALWAYS,
    afterWrite: null,
    invalidates: ['probe.*'],
    whatGoesWrong: 'With the wrong polarity the probe reads as triggered at once, or never: a probing move drives the tool into the work or the touch plate.',
  }),
  entry('os', {
    label: 'Optional stop (M1)',
    description: 'Whether M1 pauses the program. Session only: not saved, off after a reset.',
    unit: 'enum',
    valueType: 'integer',
    values: onOff('off', 'on'),
    range: { min: 0, max: 1 },
    rangeSource: 'EN config_app.c:668 (set_01); config_app.c:1104',
    convert: false,
    scope: 'session',
    risk: 'low',
    typedConfirm: NEVER,
    afterWrite: null,
    invalidates: ['job.*.preflight'],
    whatGoesWrong: 'With optional stop off, an M1 placed for a tool check or a clamp move does not pause the job.',
  }),
];

export const TINYG_EN_OVERLAY: readonly OverlayEntry[] = Object.freeze([
  ...['1', '2', '3', '4'].flatMap(motor),
  ...['x', 'y', 'z'].flatMap((a) => [...axisCore(a, 'linear'), ...axisHoming(a, 'linear')]),
  ...axisCore('a', 'rotary'),
  ...axisHoming('a', 'rotary'),
  radius('a'),
  ...['b', 'c'].flatMap((a) => [...axisCore(a, 'rotary'), radius(a)]),
  ...SYSTEM,
]);
