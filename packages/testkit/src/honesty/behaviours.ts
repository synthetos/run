/**
 * The behaviour register of the firmware models (RUN_PLAN §8.1 honesty rule).
 *
 * One entry per behaviour a safety claim (or a safety test) depends on. Each
 * entry's `id` appears as `@behaviour <id>` in the model source and in the
 * title of at least one test; `test/honesty.test.ts` enforces both, and that
 * STATUS.md (generated from this file) is current.
 *
 * Citations: EN = TinyG edge-next ead63997, TG = master d0418390 (440.21),
 * EN-HIL = edge-next `tests/hil/` at ead63997 (vendor/firmware-pins.json).
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
      { src: 'EN', file: 'xio/xio_usb.c', lines: [208, 216], quote: 'buffer-full - toss the incoming character' },
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
      { src: 'EN', file: 'xio/xio_usb.c', lines: [213, 215], quote: 'XOFF_RX_HI_WATER_MARK' },
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
      { src: 'EN', file: 'xio.c', lines: [716, 752], quote: 'scan the used list for the lowest ctrl header' },
      { src: 'EN', file: 'xio.c', lines: [679, 691], quote: '_classify_line' },
      { src: 'EN', file: 'controller.c', lines: [178, 178], quote: '_dispatch_control' },
    ],
  },
  {
    id: 'EN-GC-ECHO',
    model: EN,
    summary: 'The gc echo is dropped below jv=5 on success and on error alike: the verbosity filter runs for every error response.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'json_parser.c', lines: [803, 817], quote: 'if (!js.echo_json_gcode_block)' }],
    bench: 'B-PROBE-1',
  },
  {
    id: 'EN-REPLY-OVERFLOW',
    model: EN,
    summary: 'A reply too big for the 512-byte output buffer loses its body: {"r":{},..} with its tid and footer, OK replaced by 13. The command has already run.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'json_parser.c', lines: [860, 866], quote: '(status == STAT_OK) ? STAT_BUFFER_FULL : status' },
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
      { src: 'EN', file: 'json_parser.c', lines: [848, 853], quote: '"3,%d,%d"' },
      { src: 'EN', file: 'controller.c', lines: [277, 284], quote: 'cs.linelen += size' },
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
      { src: 'EN', file: 'report.c', lines: [65, 78], quote: 'nv_reset_nv_list("sr")' },
      { src: 'EN', file: 'controller.c', lines: [209, 213], quote: 'rpt_print_system_ready_message' },
    ],
    bench: 'B-PROBE-1',
  },
  {
    id: 'EN-TID',
    model: EN,
    summary: 'A top-level unsigned "tid" is echoed at the top level of the response, on errors too.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'json_parser.c', lines: [106, 156], quote: '_scan_tid' },
      { src: 'EN', file: 'json_parser.c', lines: [834, 844], quote: 'a peer of r{} and f[]' },
    ],
    issues: ['E049'],
  },
  {
    id: 'EN-JSON-PAIRS',
    model: EN,
    summary: 'Every pair of a multi-pair JSON line executes, in order, until the first error.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'json_parser.c', lines: [220, 258], quote: 'one executable NV at a time' }],
  },
  // ------------------------------------------------------------------ edge-next: planner
  {
    id: 'EN-PLANNER',
    model: EN,
    summary: 'Planner pool of 32; a new line is read only with 12 free buffers (headroom, E088). Every block frees its buffer and ends the cycle when the planner empties.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'planner.h', lines: [83, 84], quote: 'PLANNER_BUFFER_HEADROOM 12' },
      { src: 'EN', file: 'controller.c', lines: [606, 612], quote: 'PLANNER_BUFFER_HEADROOM' },
      { src: 'EN', file: 'planner.c', lines: [251, 258], quote: 'cm_cycle_end();' },
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
      { src: 'EN', file: 'planner.c', lines: [438, 454], quote: 'mp_hold_startup' },
      { src: 'EN', file: 'planner.c', lines: [479, 496], quote: 'startup_pending = true' },
    ],
  },
  {
    id: 'EN-STAT',
    model: EN,
    summary: 'stat: machine states 0..4 report as themselves; a cycle reports 5 (run, also with motion stopped) or 6 (hold); 12 SHUTDOWN, 13 PANIC.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'canonical_machine.c', lines: [177, 213], quote: 'cm_get_combined_state' }],
  },
  // ------------------------------------------------------------------ edge-next: realtime bytes
  {
    id: 'EN-RT-TRAP',
    model: EN,
    summary: 'The RX ISR traps ^X, !, ^D and ENQ anywhere and % and ~ only at a line boundary, before the ring-full test.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'xio/xio_usb.c', lines: [159, 188], quote: 'trap async commands' }],
    issues: ['E021', 'E146'],
  },
  {
    id: 'EN-RT-RESET',
    model: EN,
    summary: '^X calls hw_hard_reset() from the ISR: interrupts off, watchdog reset after ~15 ms; a stalled main loop cannot defer it.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usb.c', lines: [160, 163], quote: 'hw_hard_reset();' },
      { src: 'EN', file: 'hardware.c', lines: [155, 162], quote: 'WDTO_15MS' },
    ],
  },
  {
    id: 'EN-RT-FEEDHOLD',
    model: EN,
    summary: '! is honoured only while moving (motion_state != STOP); with no motion, or during a dwell that no move started, it changes nothing.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [1761, 1767], quote: 'cm.motion_state != MOTION_STOP' },
      { src: 'EN', file: 'plan_exec.c', lines: [68, 72], quote: 'BLOCK_TYPE_ALINE' },
    ],
    bench: 'B-FH-1',
  },
  {
    id: 'EN-RT-FLUSH',
    model: EN,
    summary: '% is honoured only at a line boundary and only while a hold or an alarm flush exists (otherwise ignored, not latched); it then drops the host input received before it and keeps what follows.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usb.c', lines: [172, 180], quote: '!rx_in_line && c == CHAR_QUEUE_FLUSH' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1776, 1790], quote: "don't honor request unless you are in a feedhold" },
      { src: 'EN', file: 'xio/xio_usb.c', lines: [266, 298], quote: "drop what arrived before a host '%'" },
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
      { src: 'EN', file: 'gcode_parser.c', lines: [150, 156], quote: "a '%' alone on the line is the program delimiter" },
      { src: 'EN', file: 'gcode_parser.c', lines: [218, 221], quote: 'STAT_INVALID_OR_MALFORMED_COMMAND' },
    ],
    issues: ['E161'],
  },
  {
    id: 'EN-RT-KILL',
    model: EN,
    summary: '^D raises ALARM 207 from the main loop: feedhold (or immediate hold if idle), planner flush, spindle and coolant off immediately.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usb.c', lines: [168, 171], quote: 'cm_request_job_kill' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1848, 1853], quote: 'STAT_KILL_JOB' },
      { src: 'EN', file: 'canonical_machine.c', lines: [835, 836], quote: 'spindle_reset();' },
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
      { src: 'EN', file: 'xio/xio_usb.c', lines: [185, 188], quote: 'controller_request_enquiry' },
      { src: 'EN', file: 'controller.c', lines: [528, 534], quote: 'ack' },
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
      { src: 'EN', file: 'canonical_machine.c', lines: [797, 842], quote: 'kept and rejected line by line' },
      { src: 'EN', file: 'gcode_parser.c', lines: [76, 78], quote: 'ritorno(cm_is_alarmed())' },
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
      { src: 'EN', file: 'planner.c', lines: [282, 289], quote: 'cm_cycle_end();' },
      { src: 'EN', file: 'canonical_machine.c', lines: [2084, 2100], quote: '_exec_program_finalize(value, FLAGS_ONE)' },
      { src: 'EN', file: 'canonical_machine.c', lines: [2048, 2051], quote: 'cm.machine_state = (uint8_t)value[0]' },
    ],
    bench: 'B-KILL-1',
  },
  {
    id: 'EN-OUTPUTS-INHIBITED',
    model: EN,
    summary: 'In ALARM, SHUTDOWN and PANIC a queued M3/M4/M7/M8 cannot switch an output back on.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [1570, 1575], quote: 'cm_outputs_inhibited' },
      { src: 'EN', file: 'spindle.c', lines: [149, 149], quote: 'cm_outputs_inhibited() ? SPINDLE_OFF' },
    ],
  },
  {
    id: 'EN-SET-ALARMED',
    model: EN,
    summary: 'While alarmed, SETs are rejected (204/205/206); GETs still answer.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'json_parser.c', lines: [249, 253], quote: 'GETs remain available' }],
    issues: ['E153'],
  },
  {
    id: 'EN-LIMIT',
    model: EN,
    summary: 'A limit switch raises ALARM 203, keeps position and un-homes every axis; limits are ignored while already alarmed.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'controller.c', lines: [479, 500], quote: 'STAT_LIMIT_SWITCH_HIT' }],
    issues: ['E031'],
  },
  {
    id: 'EN-SHUTDOWN',
    model: EN,
    summary: 'SHUTDOWN (stat 12) halts, turns outputs off, flushes and un-homes; {clear} returns it to READY.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [861, 879], quote: 'cm.machine_state = MACHINE_SHUTDOWN' },
      { src: 'EN', file: 'canonical_machine.c', lines: [724, 726], quote: 'cm.machine_state = MACHINE_READY' },
      { src: 'EN', file: 'controller.c', lines: [459, 468], quote: 'so {clear:n} can exit SHUTDOWN' },
    ],
    issues: ['E045'],
  },
  {
    id: 'EN-PANIC',
    model: EN,
    summary: 'PANIC (stat 13) halts and turns outputs off; {clear} does not leave it, only ^X.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'canonical_machine.c', lines: [899, 910], quote: 'Panics are not recoverable' }],
  },
  {
    id: 'EN-E162',
    model: EN,
    summary:
      'Input lost to a ring overrun is marked; every line that lost bytes or follows lost bytes is answered 13 and never runs; the first raises ALARM 13.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'xio/xio_usb.c', lines: [221, 231], quote: 'Remember where input was lost' },
      { src: 'EN', file: 'xio/xio_usart.c', lines: [313, 348], quote: 'A line that lost bytes must not run' },
      { src: 'EN', file: 'controller.c', lines: [258, 268], quote: 'input lost' },
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
      { src: 'EN', file: 'controller.c', lines: [236, 250], quote: '_reject_overlong_line' },
      { src: 'EN', file: 'xio/xio_usart.c', lines: [329, 340], quote: 'discard the rest of an overlong line' },
    ],
    issues: ['E087'],
  },
  {
    id: 'EN-SOFT-LIMITS',
    model: EN,
    summary: 'With sl=1 a straight move beyond the travel of a homed axis raises an ALARM (220) instead of moving.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [536, 554], quote: 'cm_test_soft_limits' },
      { src: 'EN', file: 'canonical_machine.c', lines: [1227, 1230], quote: 'cm_alarm(status, cs.saved_buf)' },
    ],
  },
  {
    id: 'EN-ARC-SOFT-LIMITS',
    model: EN,
    summary: 'Arcs are soft-limit checked (endpoint and the plane extremes the arc sweeps); a violation is an ALARM.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'plan_arc.c', lines: [259, 265], quote: 'arc soft_limits' },
      { src: 'EN', file: 'plan_arc.c', lines: [606, 618], quote: '_test_arc_soft_limits' },
    ],
    issues: ['E041'],
  },
  // ------------------------------------------------------------------ edge-next: program flow
  {
    id: 'EN-M0',
    model: EN,
    summary: 'M0/M60 run in queue order and pause: stat 3 with hold 6, the spindle stays on, ~ resumes.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'canonical_machine.c', lines: [2102, 2114], quote: 'cm.program_paused = true' },
      { src: 'EN', file: 'plan_exec.c', lines: [58, 59], quote: 'A program stop also blocks queued dwells' },
    ],
    bench: 'B-M0-1',
    issues: ['E020'],
  },
  {
    id: 'EN-M1-OS',
    model: EN,
    summary: 'M1 stops only when the session-only optional stop os=1.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'canonical_machine.c', lines: [2116, 2119], quote: 'optional_stop_enabled' }],
  },
  {
    id: 'EN-M400',
    model: EN,
    summary: 'M400 must be alone on its line (N allowed); its reply waits until the planner and runtime are drained; control lines still run meanwhile; an alarm answers 204.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'gcode_parser.c', lines: [499, 512], quote: 'M400' },
      { src: 'EN', file: 'controller.c', lines: [573, 604], quote: '_sync_to_motion' },
    ],
    issues: ['E002'],
  },
  {
    id: 'EN-M2-CLEARS-ALARM',
    model: EN,
    summary: 'A standalone M2, M02 or M30 (optionally N<k> M30) clears ALARM before the alarmed check, so a buffered program end silently clears an alarm.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'gcode_parser.c', lines: [76, 78], quote: '_parse_clear(str)' },
      { src: 'EN', file: 'gcode_parser.c', lines: [191, 204], quote: 'Only a standalone program end clears an alarm' },
    ],
    bench: 'B-M30-1',
    issues: ['E135'],
  },
  {
    id: 'EN-PROGRAM-END',
    model: EN,
    summary: 'M2/M30 turn the spindle and coolant off at runtime, in queue order, and end the program (stat 4).',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'canonical_machine.c', lines: [2151, 2162], quote: 'spindle_reset();' }],
  },
  {
    id: 'EN-SPINDLE-QUEUED',
    model: EN,
    summary: 'M3/M4/M5 and coolant M-codes are queued and switch the outputs when the runtime reaches them; an M5 sent during a hold waits behind the held moves.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'spindle.c', lines: [139, 143], quote: 'mp_queue_command(_exec_spindle_control' }],
  },
  // ------------------------------------------------------------------ edge-next: settings and reads
  {
    id: 'EN-SETTINGS-GATE',
    model: EN,
    summary: 'A persisted SET while a cycle runs sets the RAM value, then the EEPROM write is refused: an {"er"} 106 and the response status 106.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'persistence.c', lines: [88, 92], quote: "Can't save when moving" },
      { src: 'EN', file: 'json_parser.c', lines: [252, 256], quote: 'ritorno(nv_persist(nv))' },
    ],
  },
  {
    id: 'EN-E138',
    model: EN,
    summary:
      'GETs with side effects: alarm, shutd, panic perform the action; md de-energizes every motor; me energizes; er fakes an exception; clear/clr clear an alarm; adc3 starts a conversion.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'config_app.c', lines: [463, 464], quote: 'st_set_md, st_set_md' },
      { src: 'EN', file: 'config_app.c', lines: [484, 492], quote: 'cm_alrm, cm_alrm' },
      { src: 'EN', file: 'stepper.c', lines: [1385, 1397], quote: 'st_deenergize_motors()' },
    ],
    bench: 'B-MD-1',
    issues: ['E138'],
  },
  {
    id: 'EN-SPPH-STUB',
    model: EN,
    summary: 'GET spph answers status 17 (function stubbed): E060 spindle pause on hold is not present.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'config_app.c', lines: [64, 68], quote: 'STAT_FUNCTION_IS_STUBBED' }],
    bench: 'B-PROBE-1',
    issues: ['E060'],
  },
  {
    id: 'EN-EEPROM',
    model: EN,
    summary: 'Persisted settings survive a reset (EEPROM); an image with another layout marker is replaced by the defaults; non-persisted tokens return to defaults.',
    status: 'verified-source',
    cites: [
      { src: 'EN', file: 'config.c', lines: [208, 223], quote: 'rpt_print_loading_configs_message' },
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
      { src: 'EN', file: 'controller.c', lines: [359, 363], quote: "A stray leading '?'" },
      { src: 'EN', file: 'controller.c', lines: [382, 386], quote: '$?Hh' },
    ],
    issues: ['E053'],
  },
  {
    id: 'EN-SR',
    model: EN,
    summary: 'Filtered status reports (sv=1) of the default list (line first) at most every si=250 ms, only values that changed.',
    status: 'verified-source',
    cites: [{ src: 'EN', file: 'settings/settings_default.h', lines: [79, 84], quote: 'SR_FILTERED' }],
    bench: 'B-POLL-1',
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
      { src: 'EN-HIL', file: 'tests/hil/tests/test_identity.py', lines: [44, 47], quote: 'test_multi_pair_runs_first_pair_only_440' },
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
  { id: 'LIM-ARCS', scope: 'both', summary: 'Arcs only in G17 with incremental I/J; one planner block per arc (EN queues arc segments from a callback). R-format, G18/G19 and G90.1 arcs throw ModelGapError.' },
  { id: 'LIM-HOLD-DWELL', scope: 'both', summary: 'A feedhold requested while a dwell runs in a moving cycle takes effect when the dwell ends (B-FH-1).' },
  { id: 'LIM-UNMODELLED', scope: 'both', summary: 'Homing (G28.x), probing (G38.2), G10, G28/G30, G43.1, G92.2/G92.3, G93, M105/M114/M115, M201.3, group SETs, baud/boot/defaults/test SETs throw ModelGapError. Use setHomed() for a homed machine.' },
  { id: 'LIM-TEXT', scope: 'both', summary: 'Text mode replies only with a prompt line; text-mode commands are not executed.' },
  { id: 'LIM-MESSAGES', scope: 'both', summary: 'Exception "msg" texts are the status names, not the firmware strings; (MSG ...) comments are ignored.' },
  { id: 'LIM-DEFAULTS', scope: 'both', summary: 'Settings defaults not marked with a settings file line are placeholders.' },
  { id: 'LIM-BOOT', scope: 'both', summary: 'Boot takes bootMs (default 1000 ms) before the banners; bytes received while booting are lost.' },
  { id: 'LIM-TX', scope: 'both', summary: 'No transmit-buffer backpressure on the main loop except the 440.21 host-XON stall; EN never blocks on TX (the E128 class on EN, B-KILL-2, is not modelled).' },
  { id: 'LIM-LINEPOOL', scope: 'tinyg-en', summary: 'Line-mode pool RAM is counted, not laid out: a new buffer needs more than 255 free bytes of the 1000.' },
  { id: 'LIM-FORCED-OVERRUN', scope: 'link', summary: 'A ringOverrun fault drops bytes even when the ring is not full; on EN a loss with an empty ring is reported at the reader at once.' },
  { id: 'LIM-BAUD', scope: 'link', summary: 'A baud-rate mismatch XORs every byte with 0xA5 instead of producing real framing errors.' },
  { id: 'LIM-TG-OVERLONG', scope: 'tinyg-440', summary: 'Overlong lines on 440.21 throw ModelGapError.' },
  { id: 'LIM-REPORTS', scope: 'both', summary: 'Enumerated report values (momo, admo, frmo, macs, cycs, mots) use model numbering; qv=2 reports qr without qi/qo; status reports in text mode are still JSON.' },
  { id: 'LIM-MODAL-TG', scope: 'tinyg-440', summary: 'Two codes of one modal group on a 440.21 line: the last one wins; no modal-group error is modelled.' },
]);
