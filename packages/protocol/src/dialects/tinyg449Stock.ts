/**
 * `tinyg-449-stock`: stock TinyG edge-0.97 (`fb` 449.xx without the
 * edge-next capability tokens). ALWAYS READ_ONLY, with an upgrade offer (D23).
 *
 * It carries the bugs edge-next fixed (SAFETY H44): E094 (a line-mode wrap
 * overwrites queued lines), E019 (alarms leave the spindle on), E042 (an
 * unknown word raises ALARM), E162 (overruns splice lines silently), E045
 * (shutdown cannot be cleared), E033 (no RUN state), E104 (`hp` reads the
 * `hv` bytes) and E096 (^D ignored). The data below describes the firmware
 * so that a READ_ONLY session can show its state; nothing here enables a
 * write. `mode: 'readOnly'` makes the classifier ignore any manifest entry.
 *
 * Every `@cite S449` is `firmware/tinyg/<file>:<line>` at origin/edge-0.97
 * c5024186 (build 449.01; `vendor/firmware-pins.json`), the commit the EN-HIL
 * `d449.json` table was generated from (PN §11).
 */
import { BYTE, POLLS, READ_ONLY_STOP_JOB, TINYG_MAX_LINE_BYTES, deepFreeze, statCore, statusTable } from './shared.ts';
import type { Dialect } from './types.ts';

export const TINYG_449_STOCK: Dialect = deepFreeze<Dialect>({
  id: 'tinyg-449-stock',
  family: 'tinyg',
  label: 'TinyG edge-0.97 (stock 449)',
  mode: 'readOnly',
  upgradeOffer: true,
  // The same bare-sr banner as edge-next, but it follows `js` and can be relaxed (PN §2.2).
  bannerShape: 'bare-sr',

  // @cite S449 canonical_machine.h:60-73.
  stat: [
    ...statCore('alarm'),
    { name: 'INTERLOCK', machineClass: 'interlock' },
    { name: 'SHUTDOWN', machineClass: 'shutdown' },
    { name: 'PANIC', machineClass: 'panic' },
  ],
  // @cite S449 canonical_machine.h:104-110.
  hold: ['OFF', 'REQUESTED', 'SYNC', 'DECEL_CONTINUE', 'DECEL_TO_ZERO', 'PENDING', 'HOLD'],

  // @cite S449 error.h:92, :192, :198-200, :231, :275-276, :313-317, :333-347, :356-363, :367-371
  // (as EN-HIL d449.json). 13 is not classified: stock 449 splices overruns
  // silently instead of rejecting the line (E162 unfixed), so a 13 here means nothing safe.
  status: statusTable([
    [17, 'FUNCTION_IS_STUBBED', 'stubbed'],
    [100, 'UNRECOGNIZED_NAME', 'unrecognizedToken'],
    [106, 'COMMAND_NOT_ACCEPTED', 'notAccepted'],
    [107, 'INPUT_EXCEEDS_MAX_LENGTH', 'overlong'],
    [108, 'INPUT_LESS_THAN_MIN_VALUE', 'belowMinimum'],
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

  // `!`, `%`, `~` and ^X are trapped anywhere (@cite S449 xio/xio_usb.c:142-157). The firmware also traps
  // ENQ (:158), but run never sends ENQ outside `tinyg-en` (PN §2.3, T-S24b), and ^D is not trapped at all
  // (E096), so neither byte is listed.
  realtime: {
    feedhold: { byte: BYTE.FEEDHOLD, scope: 'anywhere' },
    resume: { byte: BYTE.RESUME, scope: 'anywhere' },
    flush: { byte: BYTE.FLUSH, scope: 'anywhere' },
    reset: { byte: BYTE.RESET, scope: 'anywhere' },
    // Only in a feedhold, and it flushes all input, including lines sent after the `%`
    // (@cite S449 canonical_machine.c:1566-1573; E146).
    flushHonoured: 'inHold',
    resetLosesPort: false,
    // hw_request_hard_reset() only requests the reset (@cite S449 xio/xio_usb.c:142-144).
    resetDeferredByMainLoop: true,
  },

  // Nothing on stock 449 is relied on: every behaviour edge-next fixed is assumed broken.
  caps: {
    jobKill: false, // E096
    enq: false,
    tid: false,
    m400: false,
    programStopPauses: false,
    // Conservative: assume a buffered program end can clear an alarm (the E135 hazard),
    // so any future write path would apply the holdback. READ_ONLY never streams.
    m2ClearsAlarm: true,
    arcSoftLimits: false,
    alarmStopsSpindle: false, // E019
    spindlePauseOnHold: 'never',
    lineInSr: true, // @cite S449 settings/settings_default.h:84
    footerRevs: [2, 3], // @cite S449 json_parser.c:683, :686
  },

  limits: {
    maxLineBytes: TINYG_MAX_LINE_BYTES,
    maxJsonLineBytes: 254,
    rxBytes: 250, // @cite S449 xio/xio_usart.h:54
    plannerBlocks: 32, // @cite S449 planner.h:83
    plannerHeadroom: 4, // @cite S449 planner.h:84
    lineHeaders: 12, // @cite S449 xio.h:214
  },

  polls: POLLS,

  // Never used: a READ_ONLY session streams nothing (`selectFlowEngine` returns null).
  flow: {
    engine: {
      kind: 'byteWindow',
      inFlightMax: 180,
      byteCrossCheck: 'none',
      xoff: { high: 0.8, low: 0.1 }, // @cite S449 xio/xio_usart.h:66-67
    },
    queuedMotionCeiling: true,
    flowControl: 'none',
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
    lWords: [2],
    blocked: [
      {
        id: 'text-after-comment',
        kind: 'textAfterComment',
        reason: 'Comments end the block, so text after one is silently dropped (PN §9.3).',
      },
      {
        id: 'g18-arc',
        kind: 'arcInPlane',
        plane: 'G18',
        reason: 'G18 arcs run in the non-standard direction on stock 449 too (E029, PN §9.3).',
      },
    ],
    barrierCodes: ['M0', 'M60', 'M1'],
    holdbackEndCodes: ['M2', 'M30'],
  },

  // SAFETY §4.4, "Stop job, READ_ONLY sessions": `!` only, and "Use your E-stop".
  stopJob: READ_ONLY_STOP_JOB,

  unverified: [
    { field: 'mode', bench: 'B-PROBE-1', note: 'The probe answers of a stock 449.01 board are from source; record them on the bench.' },
  ],
});
