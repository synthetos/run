/**
 * `tinyg-440`: stock TinyG master 440.21, the fallback dialect (PN §2.1).
 *
 * Every `@cite TG` is `firmware/tinyg/<file>:<line>` at TinyG master d0418390
 * (build 440.21; `vendor/firmware-pins.json`). Streaming on this dialect is
 * allowed only for a build in the signed manifest, which needs its own HIL
 * run (D22, HIL-6.1); until then every 440.21 board is READ_ONLY.
 *
 * Two corrections to the old notes are encoded here: 440.21 does NOT pause on
 * M0/M1/M60 and does NOT soft-limit arcs (PN §9.2, §10.2).
 */
import { BYTE, POLLS, TINYG_MAX_LINE_BYTES, deepFreeze, statCore, statusTable } from './shared.ts';
import type { Dialect } from './types.ts';

export const TINYG_440: Dialect = deepFreeze<Dialect>({
  id: 'tinyg-440',
  family: 'tinyg',
  label: 'TinyG 440.21',
  mode: 'manifest',
  upgradeOffer: true,
  // {"r":{...,"msg":"SYSTEM READY"},"f":[1,...]} (OLD-PN §2.2).
  bannerShape: 'r-footer',

  // @cite TG canonical_machine.h:306-319. Stat 2 is a SOFT alarm: queued moves keep running (OLD-PN §10).
  stat: [...statCore('softAlarm'), { name: 'SHUTDOWN', machineClass: 'shutdown' }],
  // @cite TG canonical_machine.h:346-353.
  hold: ['OFF', 'SYNC', 'PLAN', 'DECEL', 'HOLD', 'END_HOLD'],

  // @cite TG tinyg.h:272, :280, :378, :384-386, :416, :460-461, :496-497, :515-528, :537-543, :548-549. Limit and alarmed are
  // swapped against EN (T-S4): limit 204, alarmed 203.
  status: statusTable([
    // A settings write while moving answers FILE_NOT_OPEN (@cite TG persistence.c:89-90).
    [9, 'FILE_NOT_OPEN', 'notAccepted'],
    [17, 'FUNCTION_IS_STUBBED', 'stubbed'],
    [100, 'UNRECOGNIZED_NAME', 'unrecognizedToken'],
    [106, 'COMMAND_NOT_ACCEPTED', 'notAccepted'],
    [107, 'INPUT_EXCEEDS_MAX_LENGTH', 'overlong'],
    [108, 'INPUT_LESS_THAN_MIN_VALUE', 'belowMinimum'],
    [132, 'MCODE_COMMAND_UNSUPPORTED', 'mcodeUnsupported'],
    [172, 'L_WORD_IS_MISSING', 'lWordMissing'],
    [173, 'L_WORD_IS_INVALID', 'lWordInvalid'],
    [203, 'MACHINE_ALARMED', 'rejectedAlarm'],
    [204, 'LIMIT_SWITCH_HIT', 'limitHit'],
    [220, 'SOFT_LIMIT_EXCEEDED', 'softLimit'],
    [221, 'SOFT_LIMIT_EXCEEDED_XMIN', 'softLimit'],
    [222, 'SOFT_LIMIT_EXCEEDED_XMAX', 'softLimit'],
    [223, 'SOFT_LIMIT_EXCEEDED_YMIN', 'softLimit'],
    [224, 'SOFT_LIMIT_EXCEEDED_YMAX', 'softLimit'],
    [225, 'SOFT_LIMIT_EXCEEDED_ZMIN', 'softLimit'],
    [226, 'SOFT_LIMIT_EXCEEDED_ZMAX', 'softLimit'],
    [227, 'SOFT_LIMIT_EXCEEDED_AMIN', 'softLimit'],
    [228, 'SOFT_LIMIT_EXCEEDED_AMAX', 'softLimit'],
    [229, 'SOFT_LIMIT_EXCEEDED_BMIN', 'softLimit'],
    [231, 'SOFT_LIMIT_EXCEEDED_CMIN', 'softLimit'],
    [232, 'SOFT_LIMIT_EXCEEDED_CMAX', 'softLimit'],
    [240, 'HOMING_CYCLE_FAILED', 'homingFailed'],
    [241, 'HOMING_ERROR_BAD_OR_NO_AXIS', 'homingFailed'],
    [242, 'HOMING_ERROR_ZERO_SEARCH_VELOCITY', 'homingFailed'],
    [243, 'HOMING_ERROR_ZERO_LATCH_VELOCITY', 'homingFailed'],
    [244, 'HOMING_ERROR_TRAVEL_MIN_MAX_IDENTICAL', 'homingFailed'],
    [245, 'HOMING_ERROR_NEGATIVE_LATCH_BACKOFF', 'homingFailed'],
    [246, 'HOMING_ERROR_SWITCH_MISCONFIGURATION', 'homingFailed'],
    [250, 'PROBE_CYCLE_FAILED', 'probeFailed'],
    [251, 'PROBE_ENDPOINT_IS_STARTING_POINT', 'probeFailed'],
  ]),

  // All four are trapped anywhere in the byte stream (@cite TG xio/xio_usb.c:145-161).
  // No ^D and no ENQ: neither is trapped, and ENQ would corrupt the next line (T-S24a/b).
  realtime: {
    feedhold: { byte: BYTE.FEEDHOLD, scope: 'anywhere' },
    resume: { byte: BYTE.RESUME, scope: 'anywhere' },
    flush: { byte: BYTE.FLUSH, scope: 'anywhere' },
    reset: { byte: BYTE.RESET, scope: 'anywhere' },
    // Latched and run once motion stops or the hold is complete (@cite TG canonical_machine.c:1260, :1272-1279).
    flushHonoured: 'latched',
    resetLosesPort: false,
    // ^X only sets a flag: a main loop stuck on a full TX buffer cannot be reset (@cite TG xio/xio_usb.c:146-148; E128).
    resetDeferredByMainLoop: true,
  },

  caps: {
    jobKill: false,
    enq: false,
    tid: false, // EN-HIL test_identity.py comment (PN §5.3)
    m400: false, // EN-HIL test_e002 marks d440 as still failing
    programStopPauses: false, // only queues _exec_program_finalize (@cite TG canonical_machine.c:1396-1406; E020 on d440)
    // A queued M2/M30 (and M0/M1/M60) runs _exec_program_finalize, which overwrites the soft
    // alarm's machine_state with PROGRAM_END/STOP (@cite TG canonical_machine.c:1351-1353, :1396-1411).
    // A line already in the planner when the alarm is raised therefore clears it silently (the H35
    // class); new lines are refused with 203 (@cite TG gcode_parser.c:62). The cycle end at planner
    // drain does the same (@cite TG canonical_machine.c:1388-1393; plan_exec.c:173), so the host
    // must latch FAULT on the alarm exception and never rely on stat 2 persisting.
    m2ClearsAlarm: true,
    arcSoftLimits: false, // the check is commented out (@cite TG plan_arc.c:39, :171; E041 on d440)
    alarmStopsSpindle: false, // a soft alarm keeps queued moves and the spindle running (OLD-PN §10)
    spindlePauseOnHold: 'never',
    lineInSr: false, // @cite TG settings.h:68
    footerRevs: [1], // [1,status,len+1,checksum] (@cite TG json_parser.c:529)
  },

  limits: {
    maxLineBytes: TINYG_MAX_LINE_BYTES,
    maxJsonLineBytes: 254, // INPUT_BUFFER_LEN 255 with the terminator (@cite TG controller.h:35)
    rxBytes: 254, // @cite TG xio/xio_usart.h:54
    plannerBlocks: 32, // pool size (@cite TG planner.h:103); provisional until B-QR-1
    plannerHeadroom: 4, // @cite TG planner.h:104
  },

  polls: POLLS,

  flow: {
    engine: {
      kind: 'byteWindow',
      inFlightMax: 180,
      // Field 3 is the bytes the line consumed + 1: a mismatch with the sent length is FAULT (PN §7.4).
      byteCrossCheck: 'rev1',
      xoff: { high: 0.8, low: 0.1 }, // @cite TG xio/xio_usart.h:68-69
    },
    queuedMotionCeiling: true,
    flowControl: 'none',
    // A host XON disables TX and can deadlock (E142, @cite TG xio/xio_usb.c:167-171).
    neverSend: [BYTE.KILL, BYTE.ENQ, BYTE.XON, BYTE.XOFF],
  },

  transport: {
    usb: [{ vendorId: 0x0403, productId: 0x6015, role: 'control', label: 'TinyG v8 (FTDI FT230X)' }],
    baudRate: 115200,
    refuseBaudRates: [1200],
    controlPort: 'single',
    maxSerialInterfaces: 1,
  },

  gcode: {
    // No L word at all: `case 'L': break;`, so G10 L20 acts as L2 (@cite TG gcode_parser.c:400; canonical_machine.c:662).
    lWords: [2],
    blocked: [
      {
        id: 'text-after-comment',
        kind: 'textAfterComment',
        reason: 'Comments end the block, so text after one is silently dropped (PN §9.3; OLD-PN §9.1, TG gcode_parser.c:98, :108-109).',
      },
      {
        id: 'g18-arc',
        kind: 'arcInPlane',
        plane: 'G18',
        reason: 'G18 arcs run in the non-standard direction (E029), so the preview would be wrong (PN §9.3).',
      },
      {
        id: 'g28-g30-g20-g91',
        kind: 'codeUnderModal',
        codes: ['G28', 'G30'],
        modes: ['G20', 'G91'],
        reason: 'G28/G30 are broken under G20 or G91 (E039, PN §9.3).',
      },
      { id: 'g28.4', kind: 'code', code: 'G28.4', reason: 'G28.4 rewrites the machine position (E055, PN §9.3).' },
      { id: 'e-word', kind: 'word', letter: 'E', reason: '`E` is read as an exponent (E159, PN §9.3).' },
      {
        id: 'e088-queued-per-line',
        kind: 'queuedCommandsPerLine',
        max: 3,
        counted: ['S', 'T', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'G4', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59'],
        reason: 'A block queuing more than the 4-buffer headroom can PANIC (E088): at most 3 queued commands plus motion (PN §9.3).',
      },
      {
        id: 'g93',
        kind: 'code',
        code: 'G93',
        reason: 'Inverse time is broken (E130); blocked on both TinyG dialects until B-E130 closes (PN §9.3).',
      },
    ],
    // M0/M1/M60 do not pause 440.21: the host barrier is the ONLY stop (PN §9.2).
    barrierCodes: ['M0', 'M60', 'M1'],
    // Held back as on EN, because a buffered program end clears the soft alarm (caps.m2ClearsAlarm).
    holdbackEndCodes: ['M2', 'M30'],
    // The job subset of the 440.21 parser (@cite TG gcode_parser.c:258-400). G codes are switched on
    // `(uint8_t)value`, so any dotted code outside this list would run as its integer code: only the listed
    // sub-codes pass. Left out on purpose: G28.2/G28.3/G28.4 and G38.2 (as EN), G90.1/G91.1 (parsed but
    // never applied to arcs: 440.21 has no arc distance mode in canonical_machine.c, so the preview would
    // disagree), M114/M115/M400 (host-only) and M201.3 (parsed here too, @cite TG gcode_parser.c:370-375, and
    // it changes jerk at parse time as on EN, PN §9.3; PN lists it as n/a for TG, which this source corrects).
    job: {
      codes: [
        'G0', 'G1', 'G2', 'G3', 'G4', 'G10', 'G17', 'G18', 'G19', 'G20', 'G21', 'G28', 'G28.1', 'G30', 'G30.1',
        'G40', 'G49', 'G53', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G61', 'G61.1', 'G64', 'G80',
        'G90', 'G91', 'G92', 'G92.1', 'G92.2', 'G92.3', 'G93', 'G94',
        'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M30', 'M60',
      ],
      // Override enables, accepted and ignored (@cite TG gcode_parser.c:364-367; PN §9.3).
      ignoredCodes: ['M48', 'M49', 'M50', 'M51'],
      words: ['T', 'F', 'P', 'S', 'X', 'Y', 'Z', 'A', 'B', 'C', 'I', 'J', 'K', 'L', 'R'],
      maxTool: 255, // `(uint8_t)trunc(value)`: larger values wrap (@cite TG gcode_parser.c:382; canonical_machine.h:105)
      midFileProgramEnd: 'warn', // S §4.7 step 8
      optionalStopOff: 'drop', // M1 is M0 on 440.21 and does not pause (@cite TG gcode_parser.c:353-354; PN §9.2)
      programEndStopsOutputs: false, // UNVERIFIED on 440.21 (B-M2-1): C22 also inserts M5 M9 before a final M2/M30
    },
  },

  // SAFETY §4.4, "Stop job, tinyg-440": the flush path, then M5 and M9.
  stopJob: {
    steps: [
      { kind: 'awaitInFlightWrite' },
      { kind: 'stopFeeding' },
      { kind: 'writeRealtime', byte: BYTE.FEEDHOLD },
      { kind: 'awaitHeld', timeoutMs: 3000, skipIfNotMoving: true },
      { kind: 'writeRealtime', byte: BYTE.FLUSH },
      {
        kind: 'verifyDrained',
        stat: [3, 4],
        holdZero: false,
        plannerEmpty: true,
        velZero: false,
        consecutive: 2,
        intervalMs: 250,
        timeoutMs: 3000,
      },
      { kind: 'writeLine', line: 'M5', awaitResponse: true },
      { kind: 'writeLine', line: 'M9', awaitResponse: true },
      { kind: 'resetCounters' },
      { kind: 'done', spindle: 'unconfirmed' },
    ],
    onTimeout: 'faultW12',
  },

  unverified: [
    { field: 'limits.plannerBlocks', bench: 'B-QR-1', note: 'Expected 32 free when empty. Until it closes, the drain check may fall back to polled vel = 0 (SAFETY §4.4).' },
    { field: 'transport.usb', bench: 'B-ID-1', note: 'FT230X default VID:PID; not read from a v8 board yet.' },
    { field: 'flow.engine', bench: 'B-FC-1', note: 'Overrun bytes are tossed silently and can splice lines; prevention relies on the host window.' },
    { field: 'realtime.feedhold', bench: 'B-FH-1', note: 'Whether `!` is honoured during a G4 dwell is open on TG.' },
    { field: 'gcode.blocked.g93', bench: 'B-E130', note: 'G93 stays blocked.' },
  ],
});
