/**
 * `tinyg-en`: TinyG edge-next, the primary TinyG target (PN §2.1).
 *
 * Every `@cite EN` is `firmware/tinyg/<file>:<line>` at edge-next ead63997
 * (`vendor/firmware-pins.json`, PIN-1), the commit that reports `fb` 450.01.
 * The release build number is not final (D4), so a board is never classified
 * by `fb` alone: the capability probe plus the signed approved-builds
 * manifest decide (PN §2.3, `classify.ts`).
 */
import { BYTE, POLLS, TINYG_MAX_LINE_BYTES, deepFreeze, statCore, statusTable } from './shared.ts';
import type { Dialect } from './types.ts';

export const TINYG_EN: Dialect = deepFreeze<Dialect>({
  id: 'tinyg-en',
  family: 'tinyg',
  label: 'TinyG edge-next',
  mode: 'manifest',
  upgradeOffer: false,
  // Always strict JSON, no footer (@cite EN report.c:65-78).
  bannerShape: 'bare-sr',

  // @cite EN canonical_machine.h:60-73 (cmCombinedState).
  stat: [
    ...statCore('alarm'),
    { name: 'INTERLOCK', machineClass: 'interlock' }, // unused on TinyG hardware
    { name: 'SHUTDOWN', machineClass: 'shutdown' },
    { name: 'PANIC', machineClass: 'panic' },
  ],
  // @cite EN canonical_machine.h:104-110 (cmFeedholdState).
  hold: ['OFF', 'REQUESTED', 'SYNC', 'DECEL_CONTINUE', 'DECEL_TO_ZERO', 'PENDING', 'HOLD'],

  // @cite EN error.h:88, :92, :192, :198-200, :231, :275-276, :313-317, :333-347, :356-363, :367-371.
  status: statusTable([
    [13, 'BUFFER_FULL', 'damagedLine'], // E162: a damaged line never runs (@cite EN controller.c:253-266)
    [17, 'FUNCTION_IS_STUBBED', 'stubbed'], // `spph`, `spde`, `coph` (@cite EN config_app.c:64-68)
    [100, 'UNRECOGNIZED_NAME', 'unrecognizedToken'],
    [106, 'COMMAND_NOT_ACCEPTED', 'notAccepted'], // settings write in a cycle, refused jog, misused M400
    [107, 'INPUT_EXCEEDS_MAX_LENGTH', 'overlong'], // E087, no alarm
    [108, 'INPUT_LESS_THAN_MIN_VALUE', 'belowMinimum'], // E158
    [132, 'MCODE_COMMAND_UNSUPPORTED', 'mcodeUnsupported'],
    [172, 'L_WORD_IS_MISSING', 'lWordMissing'],
    [173, 'L_WORD_IS_INVALID', 'lWordInvalid'],
    [203, 'LIMIT_SWITCH_HIT', 'limitHit'],
    [204, 'COMMAND_REJECTED_BY_ALARM', 'rejectedAlarm'],
    [205, 'COMMAND_REJECTED_BY_SHUTDOWN', 'rejectedShutdown'],
    [206, 'COMMAND_REJECTED_BY_PANIC', 'rejectedPanic'],
    [207, 'KILL_JOB', 'jobKilled'],
    // 220-229 and 231-233. SOFT_LIMIT_EXCEEDED_BMAX duplicates 220, so 230 is undefined (@cite EN error.h:344).
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
    [233, 'SOFT_LIMIT_EXCEEDED_ARC', 'softLimit'],
    [240, 'HOMING_CYCLE_FAILED', 'homingFailed'],
    [241, 'HOMING_ERROR_BAD_OR_NO_AXIS', 'homingFailed'],
    [242, 'HOMING_ERROR_ZERO_SEARCH_VELOCITY', 'homingFailed'],
    [243, 'HOMING_ERROR_ZERO_LATCH_VELOCITY', 'homingFailed'],
    [244, 'HOMING_ERROR_TRAVEL_MIN_MAX_IDENTICAL', 'homingFailed'],
    [245, 'HOMING_ERROR_NEGATIVE_LATCH_BACKOFF', 'homingFailed'],
    [246, 'HOMING_ERROR_HOMING_INPUT_MISCONFIGURED', 'homingFailed'],
    [247, 'HOMING_ERROR_MUST_CLEAR_SWITCHES_BEFORE_HOMING', 'homingFailed'],
    [250, 'PROBE_CYCLE_FAILED', 'probeFailed'],
    [251, 'PROBE_TRAVEL_TOO_SMALL', 'probeFailed'],
    [252, 'NO_PROBE_SWITCH_CONFIGURED', 'probeFailed'],
    [253, 'MULTIPLE_PROBE_SWITCHES_CONFIGURED', 'probeFailed'],
    [254, 'PROBE_SWITCH_ON_ABC_AXIS', 'probeFailed'],
  ]),

  // Realtime bytes are trapped in the RX ISR before the ring-full test (@cite EN xio/xio_usb.c:155-188, :216).
  realtime: {
    // Ignored unless the machine is moving: a feedhold during a dwell does nothing (@cite EN canonical_machine.c:1761-1767).
    feedhold: { byte: BYTE.FEEDHOLD, scope: 'anywhere' }, // @cite EN xio/xio_usb.c:164-167
    resume: { byte: BYTE.RESUME, scope: 'lineBoundary' }, // E021 (@cite EN xio/xio_usb.c:181-184)
    flush: { byte: BYTE.FLUSH, scope: 'lineBoundary' }, // E146 (@cite EN xio/xio_usb.c:172-180)
    reset: { byte: BYTE.RESET, scope: 'anywhere' }, // hw_hard_reset() from the ISR (@cite EN xio/xio_usb.c:160-162)
    // ALARM 207: feedhold, flush, spindle and coolant off at once, even in a dwell or a hold
    // (@cite EN xio/xio_usb.c:168-171; canonical_machine.c:1756-1759, :1852).
    kill: { byte: BYTE.KILL, scope: 'anywhere' },
    // Answered {"ack":true} from the main loop ahead of the planner gates (@cite EN xio/xio_usb.c:185-188; controller.c:169).
    enq: { byte: BYTE.ENQ, scope: 'anywhere' },
    // Honoured only while a hold or an alarm flush exists, otherwise ignored (@cite EN canonical_machine.c:1776-1790).
    flushHonoured: 'holdOrAlarmFlush',
    resetLosesPort: false,
    resetDeferredByMainLoop: false,
  },

  caps: {
    jobKill: true,
    enq: true,
    tid: true, // echoed at the top level, on errors too (@cite EN json_parser.c:93-160, :834-843; E049)
    m400: true, // reply deferred until drained (@cite EN controller.c:196, :573)
    programStopPauses: true, // M0/M60 → stat 3, hold 6, spindle stays on (@cite EN canonical_machine.c:2102-2114; E020)
    m2ClearsAlarm: true, // a standalone M2/M30 clears ALARM (@cite EN gcode_parser.c:76-78, :186-205; E135)
    arcSoftLimits: true, // @cite EN plan_arc.c:256-265, :590-601 (E041)
    alarmStopsSpindle: true, // spindle_reset() in cm_alarm (@cite EN canonical_machine.c:797, :835; E019)
    // `spph` answers 17 today (E060 not merged); a future build that answers a value may pause the spindle.
    spindlePauseOnHold: 'probe',
    lineInSr: true, // default sr list starts with `line` (@cite EN settings/settings_default.h:84)
    footerRevs: [2, 3], // rev 2 at rxm=0, rev 3 at rxm=1, the default (@cite EN json_parser.c:848-852; settings/settings_default.h:74)
  },

  limits: {
    maxLineBytes: TINYG_MAX_LINE_BYTES,
    maxJsonLineBytes: 254, // @cite EN json_parser.h:39
    rxBytes: 250, // @cite EN xio/xio_usart.h:54
    plannerBlocks: 32, // pool size (@cite EN planner.h:83); provisional until B-QR-1, see `unverified`
    plannerHeadroom: 12, // E088 (@cite EN planner.h:84)
    lineHeaders: 12, // in a 1000-byte pool (@cite EN xio.h:215-217)
  },

  polls: POLLS,

  flow: {
    engine: {
      kind: 'byteWindow',
      inFlightMax: 180,
      linesInFlightMax: 10, // 12 headers minus a margin of 2 (PN §7.4)
      freeHeaderPause: 2,
      // Footer field 3 is bytes only at rev 2 (rxm=0); at rev 3 it is free headers (PN §5.2).
      byteCrossCheck: 'rev2',
      xoff: { high: 0.3, low: 0.15 }, // E163 (@cite EN xio/xio_usart.h:64-69)
    },
    queuedMotionCeiling: true,
    flowControl: 'none',
    neverSend: [BYTE.XON, BYTE.XOFF],
  },

  transport: {
    usb: [{ vendorId: 0x0403, productId: 0x6015, role: 'control', label: 'TinyG v8 (FTDI FT230X)' }],
    baudRate: 115200,
    refuseBaudRates: [1200],
    controlPort: 'single',
    maxSerialInterfaces: 1,
  },

  gcode: {
    // L2 and L20 (L20 accounts for G92 and the tool length offset, E023); other L → 173, none → 172
    // (@cite EN canonical_machine.c:956-983).
    lWords: [2, 20],
    blocked: [
      {
        id: 'text-after-comment',
        kind: 'textAfterComment',
        reason: 'Comments end the block, so text after one is silently dropped (PN §9.3; @cite EN gcode_parser.c:108-140).',
      },
      {
        id: 'm201.3',
        kind: 'code',
        code: 'M201.3',
        reason: 'Changes jerk in RAM at parse time, not in queue order (PN §9.3; @cite EN canonical_machine.c:2553-2554).',
      },
      {
        id: 'g93',
        kind: 'code',
        code: 'G93',
        reason: 'Inverse time is pending board validation (E130); blocked until B-E130 closes (PN §9.3).',
      },
    ],
    barrierCodes: ['M0', 'M60', 'M1'],
    holdbackEndCodes: ['M2', 'M30'],
    // The job subset of the EN parser (@cite EN gcode_parser.c:364-547). Left out on purpose, as host-only:
    // G28.2/G28.3/G28.4 (homing and set-position: they redefine the machine position that preflight checked),
    // G38.2 (probing, rejected in v1 by S §4.7), M105/M114/M115 (reports whose replies are not line
    // responses) and M400 (the host's own barrier). M48-M51 answer 132 (@cite EN gcode_parser.c:493-495),
    // so they are not listed either and a job containing them is blocked.
    job: {
      codes: [
        'G0', 'G1', 'G2', 'G3', 'G4', 'G10', 'G17', 'G18', 'G19', 'G20', 'G21', 'G28', 'G28.1', 'G30', 'G30.1',
        'G40', 'G43.1', 'G49', 'G53', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G61', 'G61.1', 'G64', 'G80',
        'G90', 'G90.1', 'G91', 'G91.1', 'G92', 'G92.1', 'G92.2', 'G92.3', 'G93', 'G94',
        'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M30', 'M60', 'M201.3',
      ],
      ignoredCodes: [],
      words: ['T', 'F', 'P', 'S', 'X', 'Y', 'Z', 'A', 'B', 'C', 'I', 'J', 'K', 'L', 'R'],
      maxTool: 31, // TOOL_SELECT_MAX with __BITFIELDS (@cite EN canonical_machine.h:326-330; tinyg.h:62; E154)
      midFileProgramEnd: 'block', // a buffered M2/M30 clears an alarm (E135, H35)
      optionalStopOff: 'send', // M1 is skipped unless `os`=1 (@cite EN canonical_machine.c:2112-2115)
      programEndStopsOutputs: true, // spindle and coolant off at program end (@cite EN canonical_machine.c:2003-2043)
    },
  },

  // SAFETY §4.4, "Stop job, tinyg-en": ends with spindle and coolant off immediately.
  stopJob: {
    steps: [
      { kind: 'awaitInFlightWrite' },
      { kind: 'stopFeeding' },
      { kind: 'writeRealtime', byte: BYTE.KILL },
      { kind: 'awaitAlarm', status: 207, timeoutMs: 2000 },
      { kind: 'confirm', confirmation: 'C13' },
      { kind: 'clearAlarm' },
      // The E114 check. SAFETY §4.4 gives EN step 6 no timeout of its own; 3 s as TG step 4.
      {
        kind: 'verifyDrained',
        stat: [1, 3, 4],
        holdZero: true,
        plannerEmpty: true,
        velZero: true,
        consecutive: 2,
        intervalMs: 250,
        timeoutMs: 3000,
      },
      { kind: 'requireRehomeIfUnhomed' },
      { kind: 'resetCounters' },
      { kind: 'done', spindle: 'offControllerAlarm' },
    ],
    onTimeout: 'faultW12',
  },

  unverified: [
    { field: 'limits.plannerBlocks', bench: 'B-QR-1', note: 'Expected 32 free when empty, from the pool size.' },
    { field: 'transport.usb', bench: 'B-ID-1', note: 'FT230X default VID:PID; not read from a v8 board yet.' },
    { field: 'realtime.kill', bench: 'B-KILL-1', note: 'From source; byte-to-pins-off time not measured.' },
    { field: 'caps.programStopPauses', bench: 'B-M0-1', note: 'From source and EN-HIL; run is a host barrier anyway.' },
    { field: 'caps.m2ClearsAlarm', bench: 'B-M30-1', note: 'From source (E135); the holdback rule assumes it.' },
    { field: 'flow.engine.linesInFlightMax', bench: 'B-N-1', note: 'Integrity at jv=3 relies on response order.' },
    { field: 'gcode.blocked.g93', bench: 'B-E130', note: 'G93 stays blocked until validated on hardware.' },
  ],
});
