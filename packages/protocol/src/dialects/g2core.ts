/**
 * `g2core-edge`: g2core edge-preview (fv 0.99, fb 101.06 "PRIVATE BUILD").
 *
 * READ-ONLY until Phase 7, but real data, not a stub (owner, 2026-11-01: g2
 * support is certain). It exists so that every shared interface is proven
 * against a controller that is not TinyG (RUN_PLAN §5.1 rule 5): line-mode
 * flow, start-of-line control characters, native USB CDC with a possible
 * second command port, a reset that loses the port, and different status and
 * hold tables. The shared contract tests run against it.
 *
 * Every `@cite G2` is `g2core/<file>:<line>` at g2 edge-preview 1fb5940
 * (`vendor/firmware-pins.json`); `Resources/` paths are from the g2 repository
 * root. `@cite G2W` is the g2 wiki at 339ec97.
 * `@cite MOT` is `Motate/MotateProject/motate/` in the same g2 tree.
 *
 * `g2core-101.03` (the last published release) has no data file: its tables
 * were not read for this task, and a g2 board that is not 101.06 classifies
 * as unknown and READ_ONLY (classify.ts).
 */
import { BYTE, POLLS, READ_ONLY_STOP_JOB, deepFreeze, statCore, statusTable } from './shared.ts';
import type { Dialect } from './types.ts';

export const G2CORE_EDGE: Dialect = deepFreeze<Dialect>({
  id: 'g2core-edge',
  family: 'g2core',
  label: 'g2core edge (101.06)',
  mode: 'readOnly',
  upgradeOffer: false,
  // An `r` carrying fv, fb, fbs, fbc, hp, hv, id, msg (OLD-PN §2.2; G2 report.cpp:87-100).
  bannerShape: 'r-footer',

  // @cite G2 canonical_machine.h:72-85.
  stat: [
    ...statCore('alarm'),
    { name: 'INTERLOCK', machineClass: 'interlock' },
    { name: 'SHUTDOWN', machineClass: 'shutdown' },
    { name: 'PANIC', machineClass: 'panic' },
  ],
  // @cite G2 canonical_machine.h:135-147.
  hold: [
    'OFF',
    'REQUESTED',
    'SYNC',
    'DECEL_CONTINUE',
    'DECEL_TO_ZERO',
    'DECEL_COMPLETE',
    'MOTION_STOPPING',
    'MOTION_STOPPED',
    'HOLD_ACTIONS_PENDING',
    'HOLD_ACTIONS_COMPLETE',
    'HOLD',
    'EXIT_ACTIONS_PENDING',
    'EXIT_ACTIONS_COMPLETE',
  ],

  // @cite G2 error.h:84, :186-194, :205-206, :225, :269-270, :308-312, :328-342, :351-358, :362-366.
  status: statusTable([
    [17, 'FUNCTION_IS_STUBBED', 'stubbed'],
    [100, 'UNRECOGNIZED_NAME', 'unrecognizedToken'],
    [106, 'COMMAND_NOT_ACCEPTED', 'notAccepted'],
    [107, 'INPUT_EXCEEDS_MAX_LENGTH', 'overlong'],
    [108, 'INPUT_LESS_THAN_MIN_VALUE', 'belowMinimum'],
    [117, 'INPUT_FROM_MUTED_CHANNEL_ERROR', 'mutedChannel'], // S H25
    [118, 'CHECKSUM_MATCH_FAILED', 'checksumFailed'],
    [132, 'MCODE_COMMAND_UNSUPPORTED', 'mcodeUnsupported'],
    [172, 'L_WORD_IS_MISSING', 'lWordMissing'],
    [173, 'L_WORD_IS_INVALID', 'lWordInvalid'],
    [203, 'LIMIT_SWITCH_HIT', 'limitHit'],
    [204, 'COMMAND_REJECTED_BY_ALARM', 'rejectedAlarm'],
    [205, 'COMMAND_REJECTED_BY_SHUTDOWN', 'rejectedShutdown'],
    [206, 'COMMAND_REJECTED_BY_PANIC', 'rejectedPanic'],
    [207, 'KILL_JOB', 'jobKilled'],
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
    [230, 'SOFT_LIMIT_EXCEEDED_BMAX', 'softLimit'], // g2 has it right; TinyG duplicates 220
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
    [252, 'NO_PROBE_INPUT_CONFIGURED', 'probeFailed'],
    [253, 'MULTIPLE_PROBE_SWITCHES_CONFIGURED', 'probeFailed'],
    [254, 'PROBE_IS_ALREADY_TRIPPED', 'probeFailed'],
  ]),

  // Control characters are recognised only as the first byte of a line (@cite G2 xio.cpp:747-754)
  // and dispatched by @cite G2 controller.cpp:279-284.
  realtime: {
    feedhold: { byte: BYTE.FEEDHOLD, scope: 'lineStart' },
    resume: { byte: BYTE.RESUME, scope: 'lineStart' },
    // Only in a hold or right after `!`; otherwise `%` starts an ordinary line (@cite G2 xio.cpp:754).
    flush: { byte: BYTE.FLUSH, scope: 'lineStart' },
    // hw_hard_reset(): USB re-enumerates and the port object is lost (@cite G2 controller.cpp:284).
    reset: { byte: BYTE.RESET, scope: 'lineStart' },
    // cm_request_job_kill() plus a flush (@cite G2 controller.cpp:282). Its end state (M30 vs ALARM)
    // is UNVERIFIED (B-G2-1); never sent while g2 is read-only.
    kill: { byte: BYTE.KILL, scope: 'lineStart' },
    enq: { byte: BYTE.ENQ, scope: 'lineStart' }, // {"ack":true} (@cite G2 controller.cpp:130, :283)
    flushHonoured: 'afterFeedhold',
    resetLosesPort: true,
    resetDeferredByMainLoop: false,
  },

  caps: {
    jobKill: true,
    enq: true,
    tid: false, // no tid handling in G2 json_parser.cpp
    m400: false, // no M400 in G2 gcode_parser.cpp
    programStopPauses: true, // stat 3; whether the spindle stops is UNVERIFIED (B-G2-5)
    // "ALARMs will also clear on receipt of an M30 or M2" (@cite G2 alarm.cpp:162-163).
    m2ClearsAlarm: true,
    // The body of _test_arc_soft_limits() is commented out (@cite G2 plan_arc.cpp:579-593).
    arcSoftLimits: false,
    // The header comment says cm_alarm stops the spindle; the code only requests a feedhold
    // (@cite G2 alarm.cpp:146-148 vs :166-175).
    alarmStopsSpindle: false,
    // `spph` is a real setting on g2 (default false, @cite G2 settings/settings_default.h:96-97).
    spindlePauseOnHold: 'probe',
    lineInSr: true, // @cite G2 settings/settings_default.h:208
    // [1,status,linelen+1], no checksum (@cite G2 json_parser.cpp:612-616). Field 3 meaning per build: B-G2-2.
    footerRevs: [1],
    footerChecksum: 'absent',
  },

  limits: {
    maxLineBytes: 400, // run's cap, under the 512-byte line buffer (OLD-PN §7.2)
    // A line reaching the buffer size - 1 is split and the rest skipped (@cite G2 xio.h:112; xio.cpp:809-813).
    maxJsonLineBytes: 511,
    rxBytes: 1024, // per device (@cite G2 xio.cpp:1040)
    // 48 on Due and G2v9, 60 on gQuadratic (@cite G2 board/ArduinoDue/hardware.h:123; board/gquadratic/hardware.h:94).
    // Board-dependent: the board definition must supply it before g2 streams (Phase 7).
    plannerBlocks: 48,
    plannerHeadroom: 4, // @cite G2 planner.h:239
  },

  polls: POLLS,

  flow: {
    // Prime 4 lines, then one more per `r` (@cite G2W g2core-Communications.md:38-60).
    engine: { kind: 'lineWindow', linesInFlightMax: 4, jsonTakesSlot: true, realtimeTakesSlot: false, jsonJumpsQueue: true },
    queuedMotionCeiling: true,
    flowControl: 'none',
    neverSend: [BYTE.XON, BYTE.XOFF],
  },

  transport: {
    usb: [
      // Native USB CDC; interfaces MI_00 and MI_02 when two are exposed
      // (@cite G2 board/ArduinoDue/board_xio.cpp:38-39; Resources/TinyGv2.inf:33-34).
      { vendorId: 0x1d50, productId: 0x606d, role: 'control', label: 'g2core (native USB)' },
      { vendorId: 0x03eb, productId: 0x6124, role: 'bootloader', label: 'SAM-BA boot ROM' }, // TinyGv2.inf:31
      // DTR edges reset the SAM3X and 1200 baud erases it: refused before open (OLD-PN §3.2; TinyGv2.inf:32).
      { vendorId: 0x2341, productId: 0x003d, role: 'refuse', label: 'Arduino Due programming port' },
    ],
    // Ignored on native USB, except 1200, which clears GPNVM1 and resets into SAM-BA on close
    // (@cite MOT MotateUSBCDC.h:537-548).
    baudRate: 115200,
    refuseBaudRates: [1200],
    // The first channel to connect becomes control, data and primary; a later one can still command
    // the board unless it is muted (@cite G2 xio.cpp:1095-1131; settings/settings_default.h:168; S H25).
    controlPort: 'firstConnectedCdc',
    maxSerialInterfaces: 2,
  },

  gcode: {
    // L1, L2, L10 and L20 are implemented (@cite G2 canonical_machine.cpp:952).
    lWords: [1, 2, 10, 20],
    blocked: [
      {
        id: 'text-after-comment',
        kind: 'textAfterComment',
        reason: 'How g2 treats text after a comment is unverified (B-G2-7); rejected until it is (OLD-PN §9.1).',
      },
      {
        id: 'm100',
        kind: 'code',
        code: 'M100',
        reason: 'M100 runs in-stream JSON commands (@cite G2 gcode_parser.cpp:1034-1035); refused in v1 (OLD-PN §7.2).',
      },
    ],
    barrierCodes: ['M0', 'M60', 'M1'],
    holdbackEndCodes: ['M2', 'M30'],
    job: null, // Read-only until Phase 7: no job is streamed to g2core.
  },

  // Read-only until Phase 7: `!` only (SAFETY §4.4). The awaited in-flight write keeps `!` at a line start.
  stopJob: READ_ONLY_STOP_JOB,

  unverified: [
    { field: 'realtime.kill', bench: 'B-G2-1', note: '^D end state (M30 vs ALARM) differs between wiki pages.' },
    { field: 'caps.footerRevs', bench: 'B-G2-2', note: 'The wiki calls field 3 free line buffers; the code sends linelen + 1.' },
    { field: 'caps.programStopPauses', bench: 'B-G2-5', note: 'Whether M0/M1 stop the spindle and coolant.' },
    { field: 'transport.controlPort', bench: 'B-G2-6', note: 'Detecting and muting a second CDC channel from the host.' },
    { field: 'gcode.blocked.text-after-comment', bench: 'B-G2-7', note: 'Rejected until measured.' },
    { field: 'limits.plannerBlocks', bench: 'B-QR-1', note: 'Board-dependent (48 or 60); per-board constant needed for Phase 7.' },
  ],
});
