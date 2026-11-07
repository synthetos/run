/**
 * The behaviour register of the firmware models (RUN_PLAN §8.1 honesty rule).
 *
 * One entry per behaviour a safety claim (or a safety test) depends on. Each
 * entry's `id` appears as `@behaviour <id>` in the model source and in the
 * title of at least one test; `test/honesty.test.ts` enforces both, and that
 * STATUS.md (generated from this file) is current.
 *
 * Citations: EN = TinyG edge-next a7489b79, TG = master d0418390 (440.21),
 * EN-HIL = edge-next `tests/hil/` at a7489b79 (vendor/firmware-pins.json).
 * Each carries a `quote` that must appear in the cited lines; the local
 * citation check re-reads the pinned firmware to prove it.
 */
import '../marker.ts';
import type { Behaviour, ModelLimit } from './types.ts';

const EN = 'tinyg-en';
const TG = 'tinyg-440';

export const BEHAVIOURS: readonly Behaviour[] = Object.freeze([
  // ------------------------------------------------------------------ edge-next: receive path
  {
    id: 'EN-RX-RING',
    model: EN,
    summary: '250-byte receive ring (248 usable: slot 0 unused, head == tail is empty); a byte arriving at a full ring is tossed.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usart.h', lines: [53, 54], quote: 'RX_BUFFER_SIZE (buffer_t)250' },
      { src: 'EN', file: 'xio/xio_usb.c', lines: [264, 276], quote: 'buffer-full - toss the incoming character' },
    ],
    bench: 'B-FC-1',
  },
  {
    id: 'EN-RX-XOFF',
    model: EN,
    summary: 'With ex=1 the board sends XOFF when the ring holds more than 30 % (75 bytes) and XON below 15 %.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usart.h', lines: [68, 69], quote: 'RX_BUFFER_SIZE * 0.3' },
      { src: 'EN', file: 'xio/xio_usb.c', lines: [267, 269], quote: 'XOFF_RX_HI_WATER_MARK' },
    ],
    issues: ['E163'],
  },
  {
    id: 'EN-RX-LINEMODE',
    model: EN,
    summary:
      'Line mode (rxm=1, default): lines move from the ring into 12 headers of a 1000-byte pool; control lines (JSON that does not wrap G-code, $ ? ! ~ % H h) are served before data lines and run while the planner is full.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio.h', lines: [215, 217], quote: 'RX_HEADERS                12' },
      { src: 'EN', file: 'xio.c', lines: [735, 771], quote: 'scan the used list for the lowest ctrl header' },
      { src: 'EN', file: 'xio.c', lines: [698, 710], quote: '_classify_line' },
      { src: 'EN', file: 'controller.c', lines: [180, 180], quote: '_dispatch_control' },
    ],
  },
  {
    id: 'EN-FEED-LIMIT-PUSH',
    model: EN,
    summary:
      'Option feedLimit (a7489b79 has it): {"rt":{"fi":N}} sets the summary interval, 0 stops, above 60 is clamped, off to on only at quiescence (106 otherwise); while a cycle runs an fs line every fi seconds and one final fs after the cycle; {"rt":null} lists fi and fs. fs and fl lines have no r and no footer.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'runtime.c', lines: [296, 298], quote: 'Feed-limit push (step 2)' },
      { src: 'EN', file: 'runtime.c', lines: [504, 527], quote: 'STAT_COMMAND_NOT_ACCEPTED' },
      { src: 'EN', file: 'runtime.c', lines: [356, 368], quote: '_fl_send_fs' },
    ],
  },
  {
    id: 'EN-GC-ECHO',
    model: EN,
    summary: 'The gc echo is dropped below jv=5 on success and on error alike: the verbosity filter runs for every error response.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'json_parser.c', lines: [916, 930], quote: 'if (!js.echo_json_gcode_block)' }],
    bench: 'B-PROBE-1',
  },
  {
    id: 'EN-REPLY-OVERFLOW',
    model: EN,
    summary: 'A reply too big for the 512-byte output buffer loses its body: {"r":{},..} with its tid and footer, OK replaced by 13. The command has already run.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'json_parser.c', lines: [973, 979], quote: '(status == STAT_OK) ? STAT_BUFFER_FULL : status' },
      { src: 'EN', file: 'controller.h', lines: [32, 32], quote: 'OUTPUT_BUFFER_LEN 512' },
    ],
    bench: 'B-PROBE-1',
  },
  {
    id: 'EN-FOOTER',
    model: EN,
    summary: 'Footer [3,status,free line headers] in line mode; [2,status,bytes read since the previous reply] in character mode (E164).',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'json_parser.c', lines: [961, 966], quote: '"3,%d,%d"' },
      { src: 'EN', file: 'controller.c', lines: [281, 288], quote: 'cs.linelen += size' },
    ],
    // The free-header count the model reports for one line at a time (10: the line PROCESSING plus a
    // FILLING buffer allocated by readline step 3) is read from xio.c, not yet seen on a board.
    bench: 'B-PROBE-1',
    issues: ['E164'],
  },
  {
    id: 'EN-BANNER',
    model: EN,
    summary: 'Boot prints bare {"sr":{fv,fb,hp,hv,id,msg}} banners with no footer, always strict JSON; the last says SYSTEM READY.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'report.c', lines: [70, 83], quote: 'nv_reset_nv_list("sr")' },
      { src: 'EN', file: 'controller.c', lines: [213, 217], quote: 'rpt_print_system_ready_message' },
    ],
    bench: 'B-PROBE-1',
  },
  {
    id: 'EN-TID',
    model: EN,
    summary: 'A top-level unsigned "tid" is echoed at the top level of the response, on errors too.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'json_parser.c', lines: [107, 157], quote: '_scan_tid' },
      { src: 'EN', file: 'json_parser.c', lines: [947, 957], quote: 'a peer of r{} and f[]' },
    ],
    issues: ['E049'],
  },
  {
    id: 'EN-JSON-PAIRS',
    model: EN,
    summary: 'Every pair of a multi-pair JSON line executes, in order, until the first error.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'json_parser.c', lines: [305, 344], quote: 'one executable NV at a time' }],
  },
  // ------------------------------------------------------------------ edge-next: planner
  {
    id: 'EN-PLANNER',
    model: EN,
    summary: 'Planner pool of 32; a new line is read only with 12 free buffers (headroom, E088). Every block frees its buffer and ends the cycle when the planner empties.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'planner.h', lines: [83, 84], quote: 'PLANNER_BUFFER_HEADROOM 12' },
      { src: 'EN', file: 'controller.c', lines: [620, 626], quote: 'PLANNER_BUFFER_HEADROOM' },
      { src: 'EN', file: 'planner.c', lines: [252, 259], quote: 'cm_cycle_end();' },
    ],
    bench: 'B-QR-1',
    issues: ['E088'],
  },
  {
    id: 'EN-STARTUP-DELAY',
    model: EN,
    summary: 'The first move into an empty, idle planner waits 50 ms (or until a second block is queued); a ! during that delay holds at once.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'planner.c', lines: [78, 78], quote: 'PLANNER_STARTUP_MS 50' },
      { src: 'EN', file: 'planner.c', lines: [456, 472], quote: 'mp_hold_startup' },
      { src: 'EN', file: 'planner.c', lines: [497, 514], quote: 'startup_pending = true' },
    ],
  },
  {
    id: 'EN-STAT',
    model: EN,
    summary: 'stat: machine states 0..4 report as themselves; a cycle reports 5 (run, also with motion stopped) or 6 (hold); 12 SHUTDOWN, 13 PANIC.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'canonical_machine.c', lines: [184, 220], quote: 'cm_get_combined_state' }],
  },
  // ------------------------------------------------------------------ edge-next: realtime bytes
  {
    id: 'EN-RT-TRAP',
    model: EN,
    summary: 'The RX ISR traps ^X, !, ^D and ENQ anywhere and % and ~ only at a line boundary, before the ring-full test.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'xio/xio_usb.c', lines: [205, 234], quote: 'trap async commands' }],
    issues: ['E021', 'E146'],
  },
  {
    id: 'EN-RT-RESET',
    model: EN,
    summary: '^X calls hw_hard_reset() from the ISR: interrupts off, watchdog reset after ~15 ms; a stalled main loop cannot defer it.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usb.c', lines: [206, 209], quote: 'hw_hard_reset();' },
      { src: 'EN', file: 'hardware.c', lines: [155, 162], quote: 'WDTO_15MS' },
    ],
  },
  {
    id: 'EN-RT-FEEDHOLD',
    model: EN,
    summary: '! is honoured while moving (motion_state != STOP). Before 450.02, with no motion or during a dwell that no move started, it changes nothing; from 450.02 a running dwell holds at once, its timer keeps running, and its end does not end the hold.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [1869, 1900], quote: 'cm.motion_state != MOTION_STOP' },
      { src: 'EN', file: 'plan_exec.c', lines: [77, 81], quote: 'BLOCK_TYPE_ALINE' },
    ],
    bench: 'B-FH-1',
  },
  {
    id: 'EN-RT-FLUSH',
    model: EN,
    summary: '% is honoured only at a line boundary and only while a hold or an alarm flush exists (otherwise ignored, not latched); it then drops the host input received before it and keeps what follows.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usb.c', lines: [218, 226], quote: '!rx_in_line && c == CHAR_QUEUE_FLUSH' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1909, 1924], quote: "don't honor request unless you are in a feedhold" },
      { src: 'EN', file: 'xio/xio_usb.c', lines: [370, 402], quote: "drop what arrived before a host '%'" },
    ],
    bench: 'B-QR-1',
    issues: ['E146'],
  },
  {
    id: 'EN-RT-PERCENT-MIDLINE',
    model: EN,
    summary: 'A % inside a line reaches the G-code parser, which keeps it and fails the line as malformed (101); nothing on the line runs.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'gcode_parser.c', lines: [152, 158], quote: "a '%' alone on the line is the program delimiter" },
      { src: 'EN', file: 'gcode_parser.c', lines: [220, 223], quote: 'STAT_INVALID_OR_MALFORMED_COMMAND' },
    ],
    issues: ['E161'],
  },
  {
    id: 'EN-RT-KILL',
    model: EN,
    summary: '^D raises ALARM 207 from the main loop: feedhold (or immediate hold if idle), planner flush, spindle and coolant off immediately.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usb.c', lines: [214, 217], quote: 'cm_request_job_kill' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1995, 2005], quote: 'STAT_KILL_JOB' },
      { src: 'EN', file: 'canonical_machine.c', lines: [880, 881], quote: 'spindle_reset();' },
    ],
    bench: 'B-KILL-1',
    issues: ['E096', 'E019'],
  },
  {
    id: 'EN-RT-ENQ',
    model: EN,
    summary: 'ENQ (0x05) is trapped and answered {"ack":true} from the main loop, ahead of the planner gates.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usb.c', lines: [231, 234], quote: 'controller_request_enquiry' },
      { src: 'EN', file: 'controller.c', lines: [542, 548], quote: 'ack' },
    ],
    bench: 'B-ENQ-1',
    issues: ['E052'],
  },
  // ------------------------------------------------------------------ edge-next: alarms
  {
    id: 'EN-ALARM',
    model: EN,
    summary:
      'cm_alarm: idle (incl. a dwell) holds at once and stops the dwell; moving gets a feedhold and a planner flush; spindle and coolant off immediately; host input is kept and rejected line by line with 204.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [842, 893], quote: 'kept and rejected line by line' },
      { src: 'EN', file: 'gcode_parser.c', lines: [78, 80], quote: 'ritorno(cm_is_alarmed())' },
    ],
    issues: ['E044', 'E019', 'E145'],
  },
  {
    id: 'EN-CYCLE-END-ALARM',
    model: EN,
    summary:
      'An alarm raised while a moving cycle runs its last non-move block (a dwell after a move) is overwritten by the cycle end when the planner empties: stat goes 2 then 3; the er report is the only lasting evidence.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'planner.c', lines: [283, 290], quote: 'cm_cycle_end();' },
      { src: 'EN', file: 'canonical_machine.c', lines: [2255, 2271], quote: '_exec_program_finalize(value, FLAGS_ONE)' },
      { src: 'EN', file: 'canonical_machine.c', lines: [2219, 2222], quote: 'cm.machine_state = (uint8_t)value[0]' },
    ],
    bench: 'B-KILL-1',
  },
  {
    id: 'EN-OUTPUTS-INHIBITED',
    model: EN,
    summary: 'In ALARM, SHUTDOWN and PANIC a queued M3/M4/M7/M8 cannot switch an output back on.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [1676, 1681], quote: 'cm_outputs_inhibited' },
      { src: 'EN', file: 'spindle.c', lines: [192, 192], quote: 'cm_outputs_inhibited() ? SPINDLE_OFF' },
    ],
  },
  {
    id: 'EN-SET-ALARMED',
    model: EN,
    summary: 'While alarmed, SETs are rejected (204/205/206); GETs still answer.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'json_parser.c', lines: [335, 339], quote: 'GETs remain available' }],
    issues: ['E153'],
  },
  {
    id: 'EN-LIMIT',
    model: EN,
    summary: 'A limit switch raises ALARM 203, keeps position and un-homes every axis; limits are ignored while already alarmed.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'controller.c', lines: [493, 514], quote: 'STAT_LIMIT_SWITCH_HIT' }],
    issues: ['E031'],
  },
  {
    id: 'EN-SHUTDOWN',
    model: EN,
    summary: 'SHUTDOWN (stat 12) halts, turns outputs off, flushes and un-homes; {clear} returns it to READY.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [912, 930], quote: 'cm.machine_state = MACHINE_SHUTDOWN' },
      { src: 'EN', file: 'canonical_machine.c', lines: [768, 770], quote: 'cm.machine_state = MACHINE_READY' },
      { src: 'EN', file: 'controller.c', lines: [473, 482], quote: 'so {clear:n} can exit SHUTDOWN' },
    ],
    issues: ['E045'],
  },
  {
    id: 'EN-PANIC',
    model: EN,
    summary: 'PANIC (stat 13) halts and turns outputs off; {clear} does not leave it, only ^X.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'canonical_machine.c', lines: [950, 961], quote: 'Panics are not recoverable' }],
  },
  {
    id: 'EN-E162',
    model: EN,
    summary:
      'Input lost to a ring overrun is marked; every line that lost bytes or follows lost bytes is answered 13 and never runs; the first raises ALARM 13.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usb.c', lines: [177, 193], quote: 'Remember where input was lost' },
      { src: 'EN', file: 'xio/xio_usart.c', lines: [328, 367], quote: 'A line that lost bytes must not run' },
      { src: 'EN', file: 'controller.c', lines: [262, 272], quote: 'input lost' },
      { src: 'EN-HIL', file: 'tests/hil/tests/bugs/test_e162_rx_overrun_splices_lines.py', lines: [1, 9], quote: 'such a line never runs' },
    ],
    bench: 'B-N-1',
    issues: ['E162'],
  },
  {
    id: 'EN-OVERLONG',
    model: EN,
    summary: 'A line of 255 or more characters is answered once with 107 and never runs; its tail is discarded; no alarm.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'controller.c', lines: [240, 254], quote: '_reject_overlong_line' },
      { src: 'EN', file: 'xio/xio_usart.c', lines: [348, 359], quote: 'discard the rest of an overlong line' },
    ],
    issues: ['E087'],
  },
  {
    id: 'EN-SOFT-LIMITS',
    model: EN,
    summary:
      'With sl=1 a straight move beyond the travel of a homed axis raises an ALARM (220) instead of moving. Every homed axis X..C is tested; an axis whose travel ends are fp_EQ (float32, |a-b| < 0.00001) is skipped; an end at or below DISABLE_SOFT_LIMIT (-1000000) is not tested.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [580, 598], quote: 'cm_test_soft_limits' },
      { src: 'EN', file: 'canonical_machine.c', lines: [583, 583], quote: 'axis < AXES' },
      { src: 'EN', file: 'canonical_machine.c', lines: [586, 586], quote: 'fp_EQ(cm.a[axis].travel_min, cm.a[axis].travel_max)' },
      { src: 'EN', file: 'canonical_machine.c', lines: [588, 594], quote: 'travel_max > DISABLE_SOFT_LIMIT' },
      { src: 'EN', file: 'canonical_machine.h', lines: [45, 45], quote: 'DISABLE_SOFT_LIMIT (-1000000)' },
      { src: 'EN', file: 'util.h', lines: [184, 188], quote: 'fp_EQ(a,b) (fabs(a-b) < EPSILON)' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1306, 1309], quote: 'cm_alarm(status, cs.saved_buf)' },
    ],
  },
  {
    id: 'EN-ARC-SOFT-LIMITS',
    model: EN,
    summary:
      'Arcs are soft-limit checked (endpoint and the plane extremes the arc sweeps); a violation is an ALARM. The extent test has the same fp_EQ skip and DISABLE_SOFT_LIMIT ends as cm_test_soft_limits().',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'plan_arc.c', lines: [277, 283], quote: 'arc soft_limits' },
      { src: 'EN', file: 'plan_arc.c', lines: [611, 624], quote: 'same skips as cm_test_soft_limits()' },
      { src: 'EN', file: 'plan_arc.c', lines: [627, 639], quote: '_test_arc_soft_limits' },
    ],
    issues: ['E041'],
  },
  {
    id: 'EN-ARC-COINCIDENT',
    model: EN,
    summary:
      'Center-format G17 arcs as cm_arc_feed()/_compute_arc(): end points fp_EQ to the start on both plane axes (float32) are a full circle in the commanded direction; otherwise the atan2 angle difference is wrapped (G2 positive, G3 negative); fp_ZERO angular travel is ALARM 159; an end radius off by more than 1 mm (or 0.005 mm and 5 %) is ALARM 154. No X/Y word is a full circle; P adds turns (a fractional P is used as given). Every block in G2/G3 mode reaches the arc code: no G2/G3 word and no I/J/K is a no-op; a G2/G3 word with no XYZ, offset or P only sets the mode.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'plan_arc.c', lines: [151, 163], quote: 'only sets the motion' },
      { src: 'EN', file: 'plan_arc.c', lines: [194, 201], quote: 'arc.full_circle = true' },
      { src: 'EN', file: 'plan_arc.c', lines: [219, 232], quote: 'floor(P_word) - (P_word) > 0' },
      { src: 'EN', file: 'plan_arc.c', lines: [329, 335], quote: 'ARC_RADIUS_ERROR_MAX' },
      { src: 'EN', file: 'plan_arc.c', lines: [345, 351], quote: 'fp_EQ(arc.gm.target[arc.plane_axis_0], arc.position[arc.plane_axis_0])' },
      { src: 'EN', file: 'plan_arc.c', lines: [368, 371], quote: 'fp_ZERO(arc.angular_travel)' },
      { src: 'EN', file: 'plan_arc.h', lines: [35, 37], quote: 'ARC_RADIUS_TOLERANCE    ((float)0.05)' },
      { src: 'EN', file: 'gcode_parser.c', lines: [701, 707], quote: 'cm_arc_feed' },
      { src: 'EN', file: 'util.h', lines: [184, 194], quote: 'fp_ZERO(a) (fabs(a) < EPSILON)' },
    ],
  },
  {
    id: 'EN-AXIS-MODES',
    model: EN,
    summary:
      'Axis modes in cm_set_model_target(): a DISABLED axis ignores its word; X/Y/Z STANDARD or INHIBITED are lengths; A/B/C STANDARD or INHIBITED are degrees; A/B/C RADIUS take a length (G20 x 25.4) and convert it to degrees on the axis radius (v*360/(2*pi*ra)), in G90 plus the offset or in G91 added. cm_set_am refuses radius mode on X/Y/Z (109). Defaults: X/Y/Z standard, A radius with ra = 1.25/(2*pi), B and C disabled. Targets are float32: the word, its unit conversion and its sum with the offset or the start each round to float, and cm_finalize_move() keeps the target as the next start, so a run of G91 moves accumulates float32 rounding (the model folds the coordinate, G92 and tool offsets into one float before the sum).',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [515, 522], quote: '360 / (2 * M_PI * cm.a[axis].radius)' },
      { src: 'EN', file: 'canonical_machine.c', lines: [524, 563], quote: 'cm.a[axis].axis_mode == AXIS_DISABLED' },
      { src: 'EN', file: 'canonical_machine.c', lines: [524, 563], quote: 'cm.gm.target[axis] += _to_millimeters(target[axis]);' },
      { src: 'EN', file: 'canonical_machine.c', lines: [426, 427], quote: 'copy_vector(cm.gmx.position, cm.gm.target);' },
      { src: 'EN', file: 'canonical_machine.c', lines: [2756, 2770], quote: 'AXIS_MODE_MAX_LINEAR' },
      { src: 'EN', file: 'canonical_machine.h', lines: [286, 293], quote: 'AXIS_RADIUS' },
      { src: 'EN', file: 'settings/settings_default.h', lines: [201, 209], quote: 'A_AXIS_MODE 			AXIS_RADIUS' },
      { src: 'EN', file: 'settings/settings_default.h', lines: [217, 233], quote: 'C_AXIS_MODE 			AXIS_DISABLED' },
    ],
  },
  {
    id: 'EN-INHIBITED-JOINT',
    model: EN,
    summary:
      'Motor space: each executed segment sets the step target to the joint of its ABSOLUTE target and moves the motor by the difference from the previous step target; the joint of an INHIBITED axis is 0 (the live axis mode, read on every segment). So an axis inhibited while its motor is away from step 0 is driven to step 0 by the first segment of the next move of any axis, and an axis un-inhibited while its position is away from 0 is driven out to it, while the reported position shows neither. A step resync (cm_set_position, from a queue flush, and G28.3) rewrites the step targets from the position and moves nothing. The model tracks one motor per axis and resets motor space at power-up.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'kinematics.c', lines: [59, 59], quote: 'if (cm.a[axis].axis_mode == AXIS_INHIBITED) { joint[axis] = 0;}' },
      { src: 'EN', file: 'plan_exec.c', lines: [742, 751], quote: 'kn_inverse_kinematics(mr.gm.target, mr.target_steps);' },
      { src: 'EN', file: 'plan_exec.c', lines: [742, 751], quote: 'travel_steps[i] = mr.target_steps[i] - mr.position_steps[i];' },
      { src: 'EN', file: 'planner.c', lines: [188, 202], quote: 'kn_inverse_kinematics(mr.position, step_position);' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1139, 1147], quote: 'mp_set_steps_to_runtime_position();' },
      { src: 'EN', file: 'canonical_machine.c', lines: [2144, 2147], quote: 'cm_set_position(axis, mp_get_runtime_absolute_position(axis));' },
    ],
  },
  {
    id: 'EN-FEED-UNITS-ORDER',
    model: EN,
    summary: 'F is set before G20/G21 in the same block and is converted with the units in force before the block: G20 then G21 G1 X1 F100 is 2540 mm/min.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'gcode_parser.c', lines: [632, 637], quote: 'cm_set_feed_rate(cm.gn.feed_rate)' },
      { src: 'EN', file: 'gcode_parser.c', lines: [656, 656], quote: 'cm_set_units_mode' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1438, 1448], quote: '_to_millimeters(feed_rate)' },
      { src: 'EN', file: 'canonical_machine.h', lines: [42, 42], quote: 'cm.gm.units_mode == INCHES' },
    ],
  },
  // ------------------------------------------------------------------ edge-next: program flow
  {
    id: 'EN-M0',
    model: EN,
    summary: 'M0/M60 run in queue order and pause: stat 3 with hold 6, the spindle stays on, ~ resumes.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [2273, 2285], quote: 'cm.program_paused = true' },
      { src: 'EN', file: 'plan_exec.c', lines: [60, 61], quote: 'A program stop also blocks queued dwells' },
    ],
    bench: 'B-M0-1',
    issues: ['E020'],
  },
  {
    id: 'EN-M1-OS',
    model: EN,
    summary: 'M1 stops only when the session-only optional stop os=1.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'canonical_machine.c', lines: [2287, 2290], quote: 'optional_stop_enabled' }],
  },
  {
    id: 'EN-M400',
    model: EN,
    summary: 'M400 must be alone on its line (N allowed); its reply waits until the planner and runtime are drained; control lines still run meanwhile; an alarm answers 204.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'gcode_parser.c', lines: [510, 523], quote: 'M400' },
      { src: 'EN', file: 'controller.c', lines: [587, 618], quote: '_sync_to_motion' },
    ],
    issues: ['E002'],
  },
  {
    id: 'EN-M2-CLEARS-ALARM',
    model: EN,
    summary: 'A standalone M2, M02 or M30 (optionally N<k> M30) clears ALARM before the alarmed check, so a buffered program end silently clears an alarm.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'gcode_parser.c', lines: [78, 80], quote: '_parse_clear(str)' },
      { src: 'EN', file: 'gcode_parser.c', lines: [193, 206], quote: 'Only a standalone program end clears an alarm' },
    ],
    bench: 'B-M30-1',
    issues: ['E135'],
  },
  {
    id: 'EN-PROGRAM-END',
    model: EN,
    summary: 'M2/M30 turn the spindle and coolant off at runtime, in queue order, and end the program (stat 4).',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'canonical_machine.c', lines: [2322, 2333], quote: 'spindle_reset();' }],
  },
  {
    id: 'EN-SPINDLE-QUEUED',
    model: EN,
    summary: 'M3/M4/M5 and coolant M-codes are queued and switch the outputs when the runtime reaches them; an M5 sent during a hold waits behind the held moves.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'spindle.c', lines: [182, 186], quote: 'mp_queue_command(_exec_spindle_control' }],
  },
  {
    id: 'EN-SPINDLE-READOUTS',
    model: EN,
    summary: 'The read-only readouts spe, spc, spd and sps report the spindle output as last driven by the queued executor (spd keeps the last direction while off; sps is the clamped S in use, 0 while off), and cof and com the coolant outputs as last driven.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'spindle.c', lines: [115, 117], quote: 'spindle_out.mode != SPINDLE_OFF' },
      { src: 'EN', file: 'spindle.c', lines: [219, 223], quote: 'spindle_out.ccw = (spindle_mode == SPINDLE_CCW)' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1644, 1645], quote: 'nv->value_int = coolant_out_flood' },
      { src: 'EN', file: 'config_app.c', lines: [692, 698], quote: 'spindle_get_spe, set_nul' },
    ],
  },
  // ------------------------------------------------------------------ edge-next: settings and reads
  {
    id: 'EN-SETTINGS-GATE',
    model: EN,
    summary: 'A persisted SET while a cycle runs sets the RAM value, then the EEPROM write is refused: an {"er"} 106 and the response status 106.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'persistence.c', lines: [88, 92], quote: "Can't save when moving" },
      { src: 'EN', file: 'json_parser.c', lines: [338, 342], quote: 'ritorno(nv_persist(nv))' },
    ],
  },
  {
    id: 'EN-EEPROM-STALL',
    model: EN,
    summary:
      'A persisted SET that changes EEPROM stalls the board while the bytes are written: input received meanwhile is lost and the answer goes out when the write ends. Off by default in the model (eepromWriteMs); the duration is a model value.',
    status: 'UNVERIFIED',
    cites: [{ src: 'EN', file: 'persistence.c', lines: [93, 101], quote: 'EEPROM_WriteBytes' }],
    bench: 'B-EEPROM-1 (proposed: time a persisted write and send a GET during it; firmware maintainer note 2026-11-02)',
  },
  {
    id: 'EN-E138',
    model: EN,
    summary:
      'GETs with side effects: alarm, shutd, panic perform the action; md de-energizes every motor; me energizes; er fakes an exception; clear/clr clear an alarm; adc3 starts a conversion.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'config_app.c', lines: [464, 465], quote: 'st_set_md, st_set_md' },
      { src: 'EN', file: 'config_app.c', lines: [485, 493], quote: 'cm_alrm, cm_alrm' },
      { src: 'EN', file: 'stepper.c', lines: [1609, 1621], quote: 'st_deenergize_motors()' },
    ],
    bench: 'B-MD-1',
    issues: ['E138'],
  },
  {
    id: 'EN-SPPH-STUB',
    model: EN,
    summary: 'GET spph answers status 17 (function stubbed): E060 spindle pause on hold is not present.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'config_app.c', lines: [65, 69], quote: 'STAT_FUNCTION_IS_STUBBED' }],
    bench: 'B-PROBE-1',
    issues: ['E060'],
  },
  {
    id: 'EN-EEPROM',
    model: EN,
    summary: 'Persisted settings survive a reset (EEPROM); an image with another layout marker is replaced by the defaults; non-persisted tokens return to defaults.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'config.c', lines: [296, 311], quote: 'rpt_print_loading_configs_message' },
      { src: 'EN', file: 'persistence.c', lines: [93, 101], quote: 'EEPROM_WriteBytes' },
    ],
    issues: ['E022'],
  },
  {
    id: 'EN-TEXT-MODE',
    model: EN,
    summary: 'A first character of $ ? H h switches to text mode (replies are text, not JSON); { switches back; a stray leading ? before a line is stripped and the line runs (E053).',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'controller.c', lines: [369, 373], quote: "A stray leading '?'" },
      { src: 'EN', file: 'controller.c', lines: [393, 397], quote: '$?Hh' },
    ],
    issues: ['E053'],
  },
  {
    id: 'EN-SR',
    model: EN,
    summary: 'Filtered status reports (sv=1) of the status report list (default list, line first): a change against the values last sent requests a report, which prints si=250 ms after the first request, sampled when it prints, with only the values that changed (timing per report.c, firmware maintainer 2026-11-02; LIM-EN-SR-TIMING).',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'settings/settings_default.h', lines: [79, 84], quote: 'SR_FILTERED' }],
    bench: 'B-POLL-1',
  },

  // ------------------------------------------------------------------ edge-next: G38.2 probing (probing.ts)
  {
    id: 'EN-PROBE-SWITCH',
    model: EN,
    summary: 'G38.2 finds its input as the one X/Y/Z min or max switch in mode 4: none is 252, several 253, one on A 254 (A is tested first). Reply-only: no alarm, no motion.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'switch.c', lines: [296, 325], quote: 'multiple probe switches were found' },
      { src: 'EN', file: 'cycle_probing.c', lines: [92, 97], quote: 'STAT_PROBE_SWITCH_ON_ABC_AXIS' },
      { src: 'EN', file: 'switch.h', lines: [46, 46], quote: 'SW_MODE_PROBE           4' },
    ],
  },
  {
    id: 'EN-PROBE-INPUT',
    model: EN,
    summary:
      'in1..in8 read the switch state (1 active, 0 inactive) of X min, X max, Y min, ... A max; the probe input takes its polarity from prbp (0 normally open, the default; 1 normally closed). Model: a simulated plate (contact while machine Z is at or below its top, or while touched) and lead (off: inactive on prbp 0, active on prbp 1).',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'config_app.c', lines: [510, 517], quote: '"in5"' },
      { src: 'EN', file: 'switch.c', lines: [133, 134], quote: 'sw.s[i].type = sw.probe_type' },
      { src: 'EN', file: 'config_app.c', lines: [657, 657], quote: 'SW_ACTIVE_LO' },
      { src: 'EN', file: 'switch.h', lines: [69, 80], quote: 'SW_MIN_Z' },
    ],
  },
  {
    id: 'EN-PROBE-COMMAND',
    model: EN,
    summary:
      'cm_straight_probe: zero F is 142 (a modal F is fine), an A/B/C word 135, no X/Y/Z word 134, the switch checks, then travel under 0.254 mm (converted to mm under G20) is 251; all reply-only. A G91 target becomes here plus the distance at command time; the distance mode is saved. Accepted, the line is answered 0 at once and the cycle waits for the planner to empty.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'cycle_probing.c', lines: [75, 90], quote: 'STAT_GCODE_AXIS_IS_MISSING' },
      { src: 'EN', file: 'cycle_probing.c', lines: [102, 115], quote: 'here + target[axis]' },
      { src: 'EN', file: 'cycle_probing.c', lines: [126, 137], quote: 'STAT_PROBE_TRAVEL_TOO_SMALL' },
      { src: 'EN', file: 'cycle_probing.c', lines: [45, 45], quote: 'MINIMUM_PROBE_TRAVEL 0.254' },
    ],
  },
  {
    id: 'EN-PROBE-CYCLE',
    model: EN,
    summary:
      'cm_probe_callback runs after feedhold sequencing and returns EAGAIN while the planner is busy and after each stage, so data lines wait and control lines (GETs) are still read; a completed probe hold is not busy. An alarm ends the cycle with no report (^D 207, a limit input 203). A soft limit on the probe move is ALARM 220 from cm_straight_feed, no report, no motion. `!` holds the move and the cycle finishes from the hold (no contact: e=0 and ALARM 250); `~` has nothing to resume.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'cycle_probing.c', lines: [157, 187], quote: 'an alarm ends the probe' },
      { src: 'EN', file: 'controller.c', lines: [191, 194], quote: 'cm_probe_callback' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1522, 1527], quote: 'return (cm_alarm(status, cs.saved_buf))' },
      { src: 'EN', file: 'cycle_probing.c', lines: [326, 337], quote: 'Probe move failed' },
    ],
  },
  {
    id: 'EN-PROBE-CONTACT-HOLD',
    model: EN,
    summary: 'A leading edge on the probe input during the probe cycle requests a normal feedhold (no fast stop); any edge counts, whatever caused it. The machine stays where the hold stops it, past the trip by the stop distance.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'switch.c', lines: [228, 231], quote: 'the probe contact ends the probe move' },
      { src: 'EN', file: 'cycle_probing.c', lines: [241, 245], quote: 'cm_request_feedhold' },
    ],
  },
  {
    id: 'EN-PROBE-ALREADY-TRIPPED',
    model: EN,
    summary: 'An input already active when the move would start (the tool on the plate, a short, a broken lead on a normally closed input) fails the cycle: no motion, report e=0, then ALARM 250 "Probe already tripped".',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'cycle_probing.c', lines: [232, 236], quote: 'pb.already_tripped = (read_switch(pb.probe_switch) != SW_INACTIVE)' },
      { src: 'EN', file: 'cycle_probing.c', lines: [316, 317], quote: 'Probe already tripped' },
    ],
  },
  {
    id: 'EN-PROBE-REPORT',
    model: EN,
    summary:
      'After the stop, e = input active and not already tripped (read then, not latched at the trip); one unsolicited top-level {"prb":{"e":N,"x".."c"}} line (%0.3f) with the work position in current units (450.02; the model prints machine mm for fb 450.03 and later, per the firmware maintainer). Then the planner is flushed, the saved distance mode put back, the motion mode cancelled and the cycle ended (stat 3).',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'cycle_probing.c', lines: [261, 276], quote: 'static void _probe_report()' },
      { src: 'EN', file: 'cycle_probing.c', lines: [278, 290], quote: 'cm.probe_results[axis] = cm_get_work_position(ACTIVE_MODEL, axis)' },
      { src: 'EN', file: 'cycle_probing.c', lines: [296, 313], quote: 'cm_set_motion_mode(MODEL, MOTION_MODE_CANCEL)' },
    ],
  },
  {
    id: 'EN-PROBE-MISS-ALARM',
    model: EN,
    summary: 'A probe that ends without contact (target reached, a lead off on a normally open input, a Pause) reports e=0 and then raises ALARM 250 "Probe did not trip": spindle and coolant off, input rejected until {clear}.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'cycle_probing.c', lines: [315, 320], quote: 'Probe did not trip' }],
  },
  {
    id: 'EN-PROBE-STAT',
    model: EN,
    summary: 'stat is 7 (COMBINED_PROBE) while the machine is in a cycle and the cycle state is PROBE, the hold after contact included; cycs reads 3.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [194, 196], quote: 'CYCLE_PROBE:   { return (COMBINED_PROBE); }' },
      { src: 'EN', file: 'canonical_machine.h', lines: [93, 93], quote: 'CYCLE_PROBE' },
    ],
  },
  // ------------------------------------------------------------------ 440.21
  {
    id: 'TG-RX-RING',
    model: TG,
    summary: '254-byte receive ring (252 usable); a byte arriving at a full ring is tossed silently (no record of the loss).',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'xio/xio_usart.h', lines: [53, 54], quote: 'RX_BUFFER_SIZE (buffer_t)254' },
      { src: 'TG', file: 'xio/xio_usb.c', lines: [178, 191], quote: 'buffer-full - toss the incoming character' },
    ],
  },
  {
    id: 'TG-OVERRUN-SPLICE',
    model: TG,
    summary: 'After an overrun the reader joins the head of one line to the tail of another, and the spliced line runs if it parses.',
    status: 'UNVERIFIED',
    cites: [{ src: 'TG', file: 'xio/xio_usb.c', lines: [186, 191], quote: 'toss the incoming character' }],
    bench: 'B-FC-1',
    issues: ['E162'],
  },
  {
    id: 'TG-RX-XOFF',
    model: TG,
    summary: 'With ex=1 the board sends XOFF above 80 % of the ring and XON below 10 %.',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'xio/xio_usart.h', lines: [68, 69], quote: 'RX_BUFFER_SIZE * 0.8' }],
  },
  {
    id: 'TG-RT-TRAP',
    model: TG,
    summary: 'The RX ISR traps ^X, !, % and ~ anywhere in the stream, even inside a line or a comment.',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'xio/xio_usb.c', lines: [145, 161], quote: 'trap async commands' }],
  },
  {
    id: 'TG-NO-KILL-ENQ',
    model: TG,
    summary: '^D (0x04) and ENQ (0x05) are not trapped: they enter the ring as data and corrupt the next line.',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'xio/xio_usb.c', lines: [145, 161], quote: 'CHAR_CYCLE_START' }],
  },
  {
    id: 'TG-RT-FLUSH-LATCHED',
    model: TG,
    summary:
      '% is latched wherever it appears (a comment like "(50%)" included) and runs once motion stops or a hold completes: it drops all RX input and the planner, and finalizes the program.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'xio/xio_usb.c', lines: [154, 157], quote: 'CHAR_QUEUE_FLUSH' },
      { src: 'TG', file: 'canonical_machine.c', lines: [1272, 1279], quote: 'queue_flush_requested' },
      { src: 'TG', file: 'canonical_machine.c', lines: [1293, 1313], quote: 'xio_reset_usb_rx_buffers' },
    ],
  },
  {
    id: 'TG-RT-FEEDHOLD',
    model: TG,
    summary: '! is honoured only in MOTION_RUN with no hold in progress.',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'canonical_machine.c', lines: [1265, 1271], quote: 'MOTION_RUN' }],
    bench: 'B-FH-1',
  },
  {
    id: 'TG-RESET-DEFERRED',
    model: TG,
    summary: '^X only sets a flag the main loop services; a main loop blocked on a full transmit buffer never resets.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'xio/xio_usb.c', lines: [146, 149], quote: 'hw_request_hard_reset' },
      { src: 'TG', file: 'hardware.c', lines: [169, 175], quote: 'hard_reset_requested' },
    ],
    issues: ['E128'],
  },
  {
    id: 'TG-HOST-XON-DEADLOCK',
    model: TG,
    summary: 'An XON from the host turns the transmit interrupt off: the board stops sending (and, once its TX buffer fills, stops running its main loop).',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'xio/xio_usb.c', lines: [162, 172], quote: 'CTRLA_RXON_TXOFF' }],
    issues: ['E142'],
  },
  {
    id: 'TG-FOOTER',
    model: TG,
    summary: 'Footer [1,status,line length + 1,checksum]; the checksum is a 31x rolling hash mod 9999 of the output up to the last comma.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'json_parser.c', lines: [528, 551], quote: 'compute_checksum' },
      { src: 'TG', file: 'util.c', lines: [255, 266], quote: 'h = 31 * h' },
      { src: 'TG', file: 'controller.c', lines: [251, 251], quote: 'cs.linelen = strlen(cs.in_buf)+1' },
    ],
  },
  {
    id: 'TG-BANNER',
    model: TG,
    summary:
      'Boot prints {"r":{fv,fb,hp,hv,id,msg},"f":[1,...]} responses through json_print_response; "Initializing" (status 15) only after a fresh EEPROM, never "Loading configs" (printed while jv is still 0 in RAM), then SYSTEM READY status 0.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'report.c', lines: [88, 118], quote: 'json_print_response(status)' },
      { src: 'TG', file: 'config.c', lines: [134, 134], quote: 'rpt_print_loading_configs_message()' },
      { src: 'TG', file: 'json_parser.c', lines: [485, 485], quote: 'JV_SILENT) return' },
    ],
    bench: 'B-PROBE-1',
  },
  {
    id: 'TG-BANNER-JV',
    model: TG,
    summary:
      'SYSTEM READY is printed after the machine is READY, so the jv filter applies: at jv=1 the banner has no msg (only fv, fb, hp, hv, id); at jv=0 there is no banner at all.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'main.c', lines: [131, 143], quote: 'rpt_print_system_ready_message()' },
      { src: 'TG', file: 'json_parser.c', lines: [490, 511], quote: 'js.echo_json_messages == false' },
      { src: 'TG', file: 'json_parser.c', lines: [576, 576], quote: 'JV_MESSAGES)	{ js.echo_json_messages = true;}' },
    ],
    bench: 'B-PROBE-1',
  },
  {
    id: 'TG-FLUSH-REPORTS',
    model: TG,
    summary: 'A queue flush (%) requests a queue report (printed only when qv is not 0) and an rx report, printed as {"rx":n} whatever jv, js or qv.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'canonical_machine.c', lines: [1302, 1303], quote: 'rx_request_rx_report();' },
      { src: 'TG', file: 'report.c', lines: [541, 548], quote: 'fprintf(stderr, "{\\"rx\\":%d}\\n", rx.space_available);' },
      { src: 'TG', file: 'controller.c', lines: [173, 174], quote: 'DISPATCH(rx_report_callback());' },
    ],
    bench: 'B-FH-1',
  },
  {
    id: 'TG-PLANNER',
    model: TG,
    summary: 'Planner pool of 32 with a headroom of 4; no line (JSON included) is read without it.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'planner.h', lines: [103, 104], quote: 'PLANNER_BUFFER_HEADROOM 4' },
      { src: 'TG', file: 'controller.c', lines: [183, 188], quote: '_sync_to_planner' },
    ],
    bench: 'B-QR-1',
  },
  {
    id: 'TG-STAT',
    model: TG,
    summary: 'stat: with no cycle the machine state (2 = soft alarm); in a cycle 5 or 6, and the previous value while motion is stopped; 11 SHUTDOWN.',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'canonical_machine.c', lines: [150, 163], quote: 'cm.combined_state' }],
  },
  {
    id: 'TG-M0-NO-PAUSE',
    model: TG,
    summary: 'M0/M1/M60 only queue a program finalize; the next queued move runs without ~.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'canonical_machine.c', lines: [1396, 1406], quote: 'mp_queue_command(_exec_program_finalize' },
      { src: 'EN-HIL', file: 'tests/hil/tests/bugs/test_e020_m0_does_not_pause.py', lines: [1, 40], quote: 'd440' },
    ],
    bench: 'B-M0-1',
    issues: ['E020'],
  },
  {
    id: 'TG-ARC-ANGULAR',
    model: TG,
    summary:
      'G17 center-format arcs as cm_arc_feed()/_compute_arc(): start and end ANGLES fp_EQ (float32) are zero angular travel (not a full circle as on edge-next); otherwise the end angle is wrapped above the start and G3 subtracts a turn; floor(|P|) turns are added by direction; no X/Y word is a full circle (one turn when P is 0); a zero-length result is refused with 201 and nothing moves. Every block in G2/G3 mode with no next action reaches the arc code, so an M5 alone in G2 mode is answered 201.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'plan_arc.c', lines: [158, 161], quote: 'arc.rotations = floor(fabs(cm.gn.parameter))' },
      { src: 'TG', file: 'plan_arc.c', lines: [166, 168], quote: 'STAT_MINIMUM_LENGTH_MOVE' },
      { src: 'TG', file: 'plan_arc.c', lines: [276, 280], quote: 'fp_ZERO(arc.rotations)' },
      { src: 'TG', file: 'plan_arc.c', lines: [285, 286], quote: 'fp_EQ(arc.theta_end, arc.theta)' },
      { src: 'TG', file: 'plan_arc.c', lines: [288, 294], quote: 'arc.theta_end < arc.theta' },
      { src: 'TG', file: 'plan_arc.c', lines: [298, 303], quote: 'arc.rotations * g18_correction' },
      { src: 'TG', file: 'gcode_parser.c', lines: [253, 253], quote: 'cm_get_motion_mode(MODEL)' },
      { src: 'TG', file: 'gcode_parser.c', lines: [504, 514], quote: 'cm_arc_feed' },
      { src: 'TG', file: 'util.h', lines: [114, 125], quote: 'fp_EQ(a,b) (fabs(a-b) < EPSILON)' },
    ],
  },
  {
    id: 'TG-AXIS-MODES',
    model: TG,
    summary:
      'Axis modes in cm_set_model_target(): a DISABLED axis ignores its word; X/Y/Z STANDARD or INHIBITED are lengths; A/B/C STANDARD or INHIBITED are degrees; A/B/C RADIUS take a length (G20 x 25.4) and convert it to degrees on the axis radius, in G90 plus the offset or in G91 added. cm_set_am refuses radius mode on X/Y/Z (109). Defaults: X/Y/Z standard, A radius with ra = 1.25/(2*3.14159628), B and C disabled. Targets are float32: the word, its unit conversion and its sum with the offset or the start each round to float, and cm_finalize_move() keeps the target as the next start, so a run of G91 moves accumulates float32 rounding (the model folds the coordinate, G92 and tool offsets into one float before the sum).',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'canonical_machine.c', lines: [430, 436], quote: '360 / (2 * M_PI * cm.a[axis].radius)' },
      { src: 'TG', file: 'canonical_machine.c', lines: [437, 465], quote: 'cm.a[axis].axis_mode == AXIS_DISABLED' },
      { src: 'TG', file: 'canonical_machine.c', lines: [437, 465], quote: 'cm.gm.target[axis] += _to_millimeters(target[axis]);' },
      { src: 'TG', file: 'canonical_machine.c', lines: [368, 369], quote: 'copy_vector(cm.gmx.position, cm.gm.target);' },
      { src: 'TG', file: 'canonical_machine.c', lines: [1723, 1732], quote: 'AXIS_MODE_MAX_LINEAR' },
      { src: 'TG', file: 'canonical_machine.h', lines: [510, 517], quote: 'AXIS_RADIUS' },
      { src: 'TG', file: 'settings/settings_default.h', lines: [148, 156], quote: 'A_AXIS_MODE 			AXIS_RADIUS' },
      { src: 'TG', file: 'settings/settings_default.h', lines: [164, 180], quote: 'C_AXIS_MODE 			AXIS_DISABLED' },
    ],
  },
  {
    id: 'TG-INHIBITED-JOINT',
    model: TG,
    summary:
      'Motor space, as on edge-next: each executed segment sets the step target to the joint of its ABSOLUTE target and moves the motor by the difference from the previous step target; the joint of an INHIBITED axis is 0. An axis inhibited while its motor is away from step 0 is driven to step 0 by the next move of any axis; an axis un-inhibited while its position is away from 0 is driven out to it. A step resync (cm_set_position, from a queue flush) moves nothing. The model tracks one motor per axis and resets motor space at power-up.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'kinematics.c', lines: [63, 63], quote: 'if (cm.a[axis].axis_mode == AXIS_INHIBITED) { joint[axis] = 0;}' },
      { src: 'TG', file: 'plan_exec.c', lines: [718, 727], quote: 'ik_kinematics(mr.gm.target, mr.target_steps);' },
      { src: 'TG', file: 'plan_exec.c', lines: [718, 727], quote: 'travel_steps[i] = mr.target_steps[i] - mr.position_steps[i];' },
      { src: 'TG', file: 'planner.c', lines: [160, 170], quote: 'ik_kinematics(mr.position, step_position);' },
      { src: 'TG', file: 'canonical_machine.c', lines: [722, 730], quote: 'mp_set_steps_to_runtime_position();' },
      { src: 'TG', file: 'canonical_machine.c', lines: [1307, 1309], quote: 'cm_set_position(axis, mp_get_runtime_absolute_position(axis));' },
    ],
  },
  {
    id: 'TG-FEED-UNITS-ORDER',
    model: TG,
    summary: 'F is set before G20/G21 in the same block and is converted with the units in force before the block: G20 then G21 G1 X1 F100 is 2540 mm/min.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'gcode_parser.c', lines: [455, 455], quote: 'EXEC_FUNC(cm_set_feed_rate, feed_rate)' },
      { src: 'TG', file: 'gcode_parser.c', lines: [474, 474], quote: 'EXEC_FUNC(cm_set_units_mode, units_mode)' },
      { src: 'TG', file: 'canonical_machine.c', lines: [940, 948], quote: '_to_millimeters(feed_rate)' },
      { src: 'TG', file: 'canonical_machine.h', lines: [47, 47], quote: 'cm.gm.units_mode == INCHES' },
    ],
  },
  {
    id: 'TG-SOFT-LIMITS',
    model: TG,
    summary:
      'With sl=1 every homed axis X..C is tested; an axis whose travel ends are fp_EQ (float32, |a-b| < 0.00001) is skipped; an end at or below DISABLE_SOFT_LIMIT (-1000000) is not tested.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'canonical_machine.c', lines: [480, 498], quote: 'cm_test_soft_limits' },
      { src: 'TG', file: 'canonical_machine.c', lines: [483, 483], quote: 'axis < AXES' },
      { src: 'TG', file: 'canonical_machine.c', lines: [486, 486], quote: 'fp_EQ(cm.a[axis].travel_min, cm.a[axis].travel_max)' },
      { src: 'TG', file: 'canonical_machine.c', lines: [488, 494], quote: 'travel_max > DISABLE_SOFT_LIMIT' },
      { src: 'TG', file: 'canonical_machine.h', lines: [50, 50], quote: 'DISABLE_SOFT_LIMIT (-1000000)' },
      { src: 'TG', file: 'util.h', lines: [114, 119], quote: 'fp_EQ(a,b) (fabs(a-b) < EPSILON)' },
    ],
  },
  {
    id: 'TG-ARC-NO-SOFT-LIMIT',
    model: TG,
    summary: 'Arcs are never soft-limit checked: the test is commented out.',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'plan_arc.c', lines: [170, 177], quote: 'test arc soft limits' }],
    issues: ['E041'],
  },
  {
    id: 'TG-SOFT-ALARM',
    model: TG,
    summary: 'A straight move beyond a soft limit is a soft alarm: an {"er"}, ALARM state, new blocks refused with 203, while queued moves and the spindle keep running.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'canonical_machine.c', lines: [583, 588], quote: 'cm.machine_state = MACHINE_ALARM' },
      { src: 'TG', file: 'canonical_machine.c', lines: [882, 884], quote: 'cm_soft_alarm(status)' },
      { src: 'TG', file: 'gcode_parser.c', lines: [61, 62], quote: 'STAT_MACHINE_ALARMED' },
    ],
  },
  {
    id: 'TG-QUEUED-END-CLEARS',
    model: TG,
    summary: 'A queued program finalize (M0/M1/M2/M30/M60, or the cycle end at planner drain) overwrites the soft alarm state.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'canonical_machine.c', lines: [1351, 1353], quote: 'cm.machine_state = (uint8_t)value[0]' },
      { src: 'TG', file: 'canonical_machine.c', lines: [1388, 1394], quote: 'cm_cycle_end' },
    ],
  },
  {
    id: 'TG-HARD-ALARM',
    model: TG,
    summary: 'A limit switch is a hard alarm: stepper hard stop, SHUTDOWN (stat 11), every later command unanswered until ^X.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'controller.c', lines: [427, 434], quote: 'cm_hard_alarm(STAT_LIMIT_SWITCH_HIT)' },
      { src: 'TG', file: 'canonical_machine.c', lines: [600, 616], quote: 'MACHINE_SHUTDOWN' },
      { src: 'TG', file: 'controller.c', lines: [303, 312], quote: 'EAGAIN prevents any lower-priority actions' },
    ],
  },
  {
    id: 'TG-HARD-ALARM-SPINDLE',
    model: TG,
    summary:
      'The hard alarm\'s spindle off is itself a queued command behind a stopped runtime; the model keeps the spindle on (the conservative reading). Whether it actually turns off is not known.',
    status: 'UNVERIFIED',
    cites: [
      { src: 'TG', file: 'canonical_machine.c', lines: [603, 604], quote: 'cm_spindle_control(SPINDLE_OFF)' },
      { src: 'TG', file: 'spindle.c', lines: [91, 96], quote: 'mp_queue_command(_exec_spindle_control' },
    ],
    bench: 'B-TG-ALARM-1 (proposed; not yet in PROTOCOL_NOTES §15)',
  },
  {
    id: 'TG-PROGRAM-END-SPINDLE',
    model: TG,
    summary: 'At program end the finalize queues spindle off and coolant off as further commands; the model runs them in queue order.',
    status: 'UNVERIFIED',
    cites: [{ src: 'TG', file: 'canonical_machine.c', lines: [1363, 1371], quote: 'cm_spindle_control(SPINDLE_OFF)' }],
    bench: 'B-M2-1',
  },
  {
    id: 'TG-SETTINGS-GATE',
    model: TG,
    summary: 'A persisted SET while a cycle runs emits {"er"} with status 9 but the response status is 0 (nv_persist\'s result is ignored); the RAM value changes.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'persistence.c', lines: [89, 90], quote: 'STAT_FILE_NOT_OPEN' },
      { src: 'TG', file: 'json_parser.c', lines: [141, 142], quote: 'nv_persist(nv);' },
    ],
  },
  {
    id: 'TG-EEPROM',
    model: TG,
    summary: 'Persisted settings survive a reset; an EEPROM written by another build is reset to the defaults (record 0 holds the build).',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'config.c', lines: [129, 134], quote: 'nv->value != cs.fw_build' }],
  },
  {
    id: 'TG-JSON-FIRST-PAIR',
    model: TG,
    summary: 'Only the first pair of a multi-pair JSON line executes; the others echo null. No tid.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'json_parser.c', lines: [134, 144], quote: 'execute the command' },
      { src: 'EN-HIL', file: 'tests/hil/tests/test_identity.py', lines: [45, 48], quote: 'test_multi_pair_runs_first_pair_only_440' },
    ],
  },
  {
    id: 'TG-GC-WRAP-QUOTE',
    model: TG,
    summary: 'In JSON mode a G-code line is wrapped as {"gc":"..."}; the string ends at the line\'s first double quote and the rest is skipped without an error, so the text before that quote runs as G-code.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'controller.c', lines: [277, 282], quote: '%.244s' },
      { src: 'TG', file: 'json_parser.c', lines: [273, 277], quote: 'find the end of the string' },
      { src: 'TG', file: 'json_parser.c', lines: [309, 321], quote: 'strpbrk(*pstr, terminators)' },
    ],
  },
  {
    id: 'TG-E138',
    model: TG,
    summary: 'GET md de-energizes the motors; GET me energizes them; GET clear clears a soft alarm; GET er fakes an exception.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'config_app.c', lines: [468, 469], quote: 'st_set_md, st_set_md' },
      { src: 'TG', file: 'config_app.c', lines: [191, 196], quote: 'cm_clear,cm_clear' },
    ],
    bench: 'B-MD-1',
    issues: ['E138'],
  },
  {
    id: 'TG-GCODE-DROP-INVALID',
    model: TG,
    summary: 'The normalizer deletes every character other than letters, digits, - and . so X0.001*9 runs as X0.0019.',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'gcode_parser.c', lines: [131, 138], quote: 'all valid characters' }],
    issues: ['E161'],
  },
  {
    id: 'TG-DOTTED-CODES',
    model: TG,
    summary: 'G and M words are switched on their integer part: G59.1 runs as G59 and M3.1 as M3; T wraps at 256.',
    status: 'verified-source',
    cites: [
      { src: 'TG', file: 'gcode_parser.c', lines: [258, 259], quote: 'switch((uint8_t)value)' },
      { src: 'TG', file: 'gcode_parser.c', lines: [351, 352], quote: 'switch((uint16_t)value)' },
      { src: 'TG', file: 'gcode_parser.c', lines: [382, 382], quote: '(uint8_t)trunc(value)' },
    ],
    issues: ['E150', 'E154'],
  },
  {
    id: 'TG-SPINDLE-NOT-INHIBITED',
    model: TG,
    summary: 'No output inhibit: a queued M3 runs and switches the spindle on whatever the alarm state.',
    status: 'verified-source',
    cites: [{ src: 'TG', file: 'spindle.c', lines: [99, 102], quote: 'cm_set_spindle_mode(MODEL, spindle_mode)' }],
  },
]);

/** Simplifications no safety claim may rest on (STATUS.md, "Model limits"). */
export const MODEL_LIMITS: readonly ModelLimit[] = Object.freeze([
  { id: 'LIM-KINEMATICS', scope: 'both', summary: 'Moves run at cruise speed with no acceleration ramps; a feedhold decelerates linearly over a fixed time (holdDecelMs, default 100 ms). Positions and durations are coarse.' },
  { id: 'LIM-ARCS', scope: 'both', summary: 'Arcs only in G17 with incremental I/J; one planner block per arc (EN queues arc segments from a callback); the end position is the commanded target, not the last computed segment. R-format, G18/G19, G90.1 and (440.21) K-word arcs, and zero-radius helices, throw ModelGapError. atan2/sin/hypot are double rounded once to float32, so a case exactly on a libm ulp boundary may differ.' },
  { id: 'LIM-HOLD-DWELL', scope: 'both', summary: 'Before EN 450.02, and on TG, a feedhold requested while a dwell runs in a moving cycle takes effect when the dwell ends (B-FH-1).' },
  { id: 'LIM-UNMODELLED', scope: 'both', summary: 'On 440.21 homing (G28.x); on edge-next G28.1/G28.4 (edge-next G28.2 and G28.3: LIM-EN-HOMING). G10 (except edge-next L2/L20, LIM-EN-G10), G28/G30, G43.1, G92.2/G92.3, G93, M105/M114/M115, M201.3, group SETs (except the edge-next sr list, LIM-EN-SR-LIST), baud/boot/defaults/test SETs throw ModelGapError. Use setHomed() for a homed machine.' },
  { id: 'LIM-EN-G10', scope: 'tinyg-en', summary: 'Edge-next G10 L2 and L20 with P1..P6 set the G54..G59 offset and persist it, uncited (added for the Phase 2 fake board: set work zero). L20 uses the end of the last queued move as the current position; other L values are refused with status 130 as an unsupported command, other P values with P_WORD_IS_INVALID. 440.21 G10 still throws ModelGapError.' },
  { id: 'LIM-EN-SR-LIST', scope: 'tinyg-en', summary: 'Edge-next {"sr":{...}} replaces the status report list with the keys set to true, in order (TinyG report.c sr_set as remembered, uncited at the pin): a non-true value or unknown token is 100, an empty list 101, more than 30 entries 107 (INPUT_EXCEEDS_MAX_LENGTH, the closest status); it is persisted (one EEPROM write) and answered with the values of the new list. Kept in the EEPROM image as token indexes.' },
  { id: 'LIM-EN-SR-TIMING', scope: 'tinyg-en', summary: 'Status report requests are modelled as one timed request recorded at the first change against the values last sent; the report prints si ms later sampling the values then (report.c facts from the firmware maintainer, 2026-11-02, not cited at the pin). Which firmware events request a report is not modelled: any change of a listed value does.' },
  { id: 'LIM-EN-RT-HB', scope: 'tinyg-en', summary: 'The rt family as the single pair of a line: {"rt":null} reads hb, qt and up (whole seconds since power-up, runtime.c:179-185); {"rt":{"hb":N}} sets the RAM heartbeat in whole seconds, 0 off, 1..60 (RT_HB_MAX, runtime.h:6, :15); an integer above 60 or a negative is 110 and changes nothing, never clamped (runtime.c:107-118; util.c:224); a non-integer (1.5, a string) is 110 as the firmware maintainer stated (2026-11-02), though the typesafe parser read at 93a723b8 looks to answer 116 for those (json_parser.c:678-684; util.c:270), unverified on hardware (a JSON true is converted to 1 by that parser, json_parser.c:679-681; the model refuses it with 110); any other member 100; option rt:false answers 100. While hb > 0 a {"hb":{"stat","hold","up","qt"}} line prints every hb seconds while the link and the machine are quiet (JSON mode, no byte in or out, nothing unread; nothing moving, held, flushing or queued, runtime.c:33-93); any activity restarts the interval. hb is 0 after boot and ^X. Not modelled: qt (always ""), a beat skipped when it cannot go out whole, and the full planner-and-stepper quiet test (the model uses its motion queue).' },
  { id: 'LIM-EN-HOMING', scope: 'tinyg-en', summary: 'G28.2: each named axis needs exactly one homing switch (sn or sx mode 1 or 3), sv > 0 and am != 0, else the block fails with 246 (241 with no axis) and nothing moves. Axes home Z, X, Y, A as straight moves toward the switch end at sv mm/min (at most |tm-tn|+lb), then the axis position is set to tn or tm and marked homed; no latch, backoff or switch input is modelled. stat 9 while the cycle runs; a flush, an alarm, ^D or a reset ends it with the remaining axes unhomed. G28.3 queues a set of the named axes positions (unit-converted) and marks them homed. Uncited.' },
  { id: 'LIM-EN-PROBE', scope: 'tinyg-en', summary: 'Edge-next G38.2: the probe input has no 50 ms lockout and is sampled once per main-loop pass (1 ms); the stop after contact is the model hold (LIM-KINEMATICS), not a jerk-limited stop at zjh, so the overshoot is not the firmware stop distance; jerk and inverse-time mode are not modelled; the plate and lead are test controls (setProbePlate, setProbeTouch, setProbeLead); no status report is requested on a switch edge.' },
  { id: 'LIM-EN-RAM-WRITES', scope: 'tinyg-en', summary: 'Option ramWrites (default off) models a proposed firmware capability, not in any build: {"rt":{"unsaved":null}} answers unsaved 0, and a line whose first pair is ram:1 applies the rest in RAM without persisting. Without it any ram key answers 100 after the pairs before it have run.' },
  { id: 'LIM-TEXT', scope: 'both', summary: 'Text mode replies only with a prompt line; text-mode commands are not executed.' },
  { id: 'LIM-MESSAGES', scope: 'both', summary: 'Exception "msg" texts are the status names, not the firmware strings; (MSG ...) comments are ignored.' },
  { id: 'LIM-DEFAULTS', scope: 'both', summary: 'Settings defaults not marked with a settings file line are placeholders.' },
  { id: 'LIM-BOOT', scope: 'both', summary: 'Boot takes bootMs (default 1000 ms) before the banners; bytes received while booting are lost.' },
  { id: 'LIM-TX', scope: 'both', summary: 'No transmit-buffer backpressure on the main loop except the 440.21 host-XON stall; EN never blocks on TX (the E128 class on EN, B-KILL-2, is not modelled).' },
  { id: 'LIM-LINEPOOL', scope: 'tinyg-en', summary: 'Line-mode pool RAM is counted, not laid out: a new buffer needs more than 255 free bytes of the 1000.' },
  { id: 'LIM-FORCED-OVERRUN', scope: 'link', summary: 'A ringOverrun fault drops bytes even when the ring is not full; on EN a loss with an empty ring is reported at the reader at once.' },
  { id: 'LIM-BAUD', scope: 'link', summary: 'A baud-rate mismatch XORs every byte with 0xA5 instead of producing real framing errors.' },
  { id: 'LIM-TG-STATE-READS', scope: 'tinyg-440', summary: 'The 440.21 connect-time state reads are modelled, uncited: home reads 1 when X, Y and Z are homed, tool reads 0, ofs is the active G54..G59 offset (the model has no G92), and the g92, g28 and g30 groups read 0.' },
  { id: 'LIM-TG-OVERLONG', scope: 'tinyg-440', summary: 'Overlong lines on 440.21 throw ModelGapError.' },
  { id: 'LIM-REPORTS', scope: 'both', summary: 'Enumerated report values (momo, admo, frmo, macs, cycs, mots) use model numbering; qv=2 reports qr without qi/qo; status reports in text mode are still JSON.' },
  { id: 'LIM-MODAL-TG', scope: 'tinyg-440', summary: 'Two codes of one modal group on a 440.21 line: the last one wins; no modal-group error is modelled.' },
  { id: 'LIM-EN-FEED-LIMIT', scope: 'tinyg-en', summary: 'The feed-limit push (option feedLimit, EN-FEED-LIMIT-PUSH) models the window, the interval and when fs lines are pushed; its counters do not model the firmware: ct is the time a cycle ran, cd is 0 and every per-cause counter in c is 0. No fl lines are pushed, x is never set, and {"rt":{"fs":null}} is not modelled.' },
  { id: 'LIM-EN-JOB-FLAG', scope: 'tinyg-en', summary: 'Option jobFlag models {"rt":{"job":0|1}} (feed-limit step 3), which is designed and NOT in any firmware: it only stores the value and lists job in {"rt":null}, so run\'s capability seam can be tested. Default off, as on every real board.' },
  { id: 'LIM-EN-REPIN', scope: 'tinyg-en', summary: 'The model was built at edge-next ead63997; the 97321391, 6ec70652 and 93a723b8 re-pins (2026-11-02) and the a7489b79 re-pin (450.02, 2026-11-06) are modelled only for the spindle and coolant readouts spe, spc, spd, sps, cof and com (EN-SPINDLE-READOUTS; the model applies S when parsed, not queued, so sps follows a new S at once) and beyond that only as moved citations. Not modelled: the rt family beyond LIM-EN-RT-HB (at 93a723b8 the feed-limit report leaves flk, flm, flp and flf, the fl lines and the fs summary request, which the model answers 100 for; the push interval fi and its fs lines are modelled only with option feedLimit, EN-FEED-LIMIT-PUSH), E195 (a partial line quiet for about 1 s is dropped when a { arrives; the model always joins it to the next line), the stricter input errors E168-E177, E191 and E193, the timing fixes E165-E167, E180-E184, E190 and E192, and the planner fixes E196 (the junction limit read from the runtime direction when the previous block is freed) and E197 (a runtime halt clears the runtime exit velocity). Not modelled from the 450.02 re-pin: fb 450.02 itself (the model reports 450.01 unless a caller passes build; the fake-serial board passes 450.02 so the committed bench manifest approves it), a feedhold while a cycle is stopped between moves entering HOLD at once (a feedhold during a dwell is modelled for a build of 450.02 or later, without the stale vel that hold reports), a queue flush or job kill also ending a dwell, status 117 for a persisted setting written during a cycle and status 118 after the banner for stored settings that would not load, the range-checked setters (axis rates, junction deviation, radius, chordal tolerance, ja, work offsets, PWM frequency), microsteps other than 1, 2, 4 and 8 refused, switch settings refused unless idle, targets above 1e18 refused, a resume whose held move cannot be replanned staying in HOLD with an exception, and the N66 hold endpoint fix.' },
]);
