/**
 * The `Dialect` contract (ROADMAP P0-08; RUN_PLAN §5.5, OLD-TP §4.1).
 *
 * A dialect is DATA: everything run needs to know about one firmware family
 * and build line, as plain frozen values. There are no `if (edge)` or
 * `if (g2)` branches outside `protocol/src/dialects/` (RUN_PLAN §5.1 rule 4).
 * The machine path reads these values; it never re-derives them.
 *
 * The contract is controller-neutral (RUN_PLAN §5.1 rule 5): the flow engine,
 * realtime bytes, stop sequence, status table and transport identity are all
 * expressed so that g2core (line mode, native USB CDC, start-of-line control
 * characters) fits without a TinyG-only assumption. The shared contract tests
 * in `test/dialect-contract.test.ts` run every rule against every dialect.
 *
 * Fact sources follow PROTOCOL_NOTES §1 tags, pinned in
 * `vendor/firmware-pins.json` (PIN-1). Facts that no source or bench run has
 * confirmed are listed in each dialect's `unverified` with their bench task.
 */

/** Every dialect id the design names (RUN_PLAN §5.5). `g2core-101.03` has no data yet (see g2core.ts). */
export type DialectId = 'tinyg-en' | 'tinyg-440' | 'tinyg-449-stock' | 'g2core-101.03' | 'g2core-edge';

export type Family = 'tinyg' | 'g2core';

/** Footer revisions (PN §5.2). */
export type FooterRev = 1 | 2 | 3;

/**
 * What a `stat` value means to run (PN §8; OLD-TP §4.1). `unknown` is never
 * in a table: it is what `mapStat` returns for a value the dialect does not
 * define, and every consumer treats it as "not idle, not safe".
 */
export type MachineClass =
  | 'initializing'
  | 'idle'
  | 'programStop'
  | 'end'
  | 'running'
  | 'held'
  | 'probing'
  | 'homing'
  | 'jogging'
  | 'softAlarm'
  | 'alarm'
  | 'shutdown'
  | 'panic'
  | 'interlock'
  | 'unknown';

export interface StatEntry {
  /** The firmware's own name for the state (cmCombinedState). */
  readonly name: string;
  readonly machineClass: Exclude<MachineClass, 'unknown'>;
}

/**
 * What a response or exception status code means to run. Only the codes the
 * protocol and the machine act on are classified here; the full tables are
 * generated from the vendored HIL tables (P0-09). Any other non-zero code is
 * `error`, which is a FAULT during a job (SAFETY §3).
 */
export type StatusClass =
  | 'ok'
  /** A limit switch was hit (EN 203, TG 204: the tables differ, T-S4). */
  | 'limitHit'
  /** ^D job kill (EN 207). */
  | 'jobKilled'
  /** Rejected because the machine is alarmed (EN 204, TG 203). */
  | 'rejectedAlarm'
  | 'rejectedShutdown'
  | 'rejectedPanic'
  /**
   * EN status 13 (STAT_BUFFER_FULL), which has two sources and is never acted
   * on as is: `resolveBufferFull` decides between `damagedLine` and
   * `responseLost` from the evidence around it.
   */
  | 'bufferFull'
  /**
   * A damaged line that never ran (EN E162, @cite EN controller.c:253-266):
   * it comes with an `er` 13 and ALARM 13 (the first one raises it; later
   * ones arrive while that alarm stands).
   */
  | 'damagedLine'
  /**
   * The line RAN, but its reply did not fit the output buffer, so the body
   * was replaced by `{}` and an OK became 13 (EN E102, json_parser.c
   * `json_print_response`, `size < 0`). Never resend; re-read state.
   */
  | 'responseLost'
  /** The token exists but is stubbed (EN `spph`, status 17). */
  | 'stubbed'
  /** Unrecognised token (status 100): how TG and stock 449 answer the capability tokens. */
  | 'unrecognizedToken'
  /** Not accepted now: a settings write during a cycle (EN 106, TG 9), a refused jog, a misused M400. */
  | 'notAccepted'
  /** Overlong line (EN 107, E087). */
  | 'overlong'
  /** Value below minimum (EN 108, E158). */
  | 'belowMinimum'
  | 'softLimit'
  | 'homingFailed'
  | 'probeFailed'
  | 'lWordMissing'
  | 'lWordInvalid'
  | 'mcodeUnsupported'
  /** g2core: input from a muted channel was ignored (status 117, S H25). */
  | 'mutedChannel'
  /** g2core: line checksum mismatch (status 118). */
  | 'checksumFailed'
  /** Any other non-zero status. */
  | 'error';

export interface StatusEntry {
  readonly name: string;
  readonly statusClass: Exclude<StatusClass, 'ok' | 'error'>;
}

/**
 * Where in the byte stream the firmware honours a realtime byte:
 * - `anywhere`: trapped by the RX ISR even mid-line (TinyG `!`, ^X, ^D).
 * - `lineBoundary`: honoured only between lines; mid-line it reaches the
 *   parser (EN `%` and `~`, E021).
 * - `lineStart`: recognised only as the first byte of a line (g2core control
 *   characters, G2 xio.cpp:747-754).
 */
export type RealtimeScope = 'anywhere' | 'lineBoundary' | 'lineStart';

export interface RealtimeByte {
  readonly byte: number;
  readonly scope: RealtimeScope;
}

/**
 * The realtime bytes run MAY write to this dialect, once classified. A byte
 * that is absent is never written (T-S24a/b): TinyG 440.21 and stock 449 have
 * no `kill` and no `enq`. Whether a session may write even the bytes listed
 * is decided by the session mode and the allow-matrix, not here.
 */
export interface RealtimeBytes {
  readonly feedhold: RealtimeByte;
  readonly resume: RealtimeByte;
  readonly flush?: RealtimeByte;
  /** ^X. Written only by the `resetController` intent with C15 (SAFETY §3, T-S26). */
  readonly reset: RealtimeByte;
  /** ^D job kill. Present only where `caps.jobKill` is true. */
  readonly kill?: RealtimeByte;
  /** ENQ liveness probe. Present only where `caps.enq` is true. */
  readonly enq?: RealtimeByte;
  /**
   * When the firmware honours `flush`:
   * - `latched`: always, run later (TG canonical_machine.c:1259-1288);
   * - `holdOrAlarmFlush`: only while a hold or an alarm flush exists, otherwise ignored (EN);
   * - `inHold`: only in a feedhold, and it drops ALL buffered input (stock 449, E146 unfixed);
   * - `afterFeedhold`: only in a hold or right after `!` (g2core).
   */
  readonly flushHonoured?: 'latched' | 'holdOrAlarmFlush' | 'inHold' | 'afterFeedhold';
  /** True when ^X re-enumerates USB and the port object becomes invalid (g2core). */
  readonly resetLosesPort: boolean;
  /** True when ^X only sets a flag the main loop services, so a stalled loop cannot reset (TG, E128). */
  readonly resetDeferredByMainLoop: boolean;
}

/** RUN_PLAN §5.5 `caps`: firmware behaviour run may rely on. */
export interface DialectCaps {
  readonly jobKill: boolean;
  readonly enq: boolean;
  readonly tid: boolean;
  readonly m400: boolean;
  readonly programStopPauses: boolean;
  readonly m2ClearsAlarm: boolean;
  readonly arcSoftLimits: boolean;
  readonly alarmStopsSpindle: boolean;
  readonly spindlePauseOnHold: 'never' | 'probe';
  readonly lineInSr: boolean;
  readonly footerRevs: readonly FooterRev[];
  /**
   * Whether a revision-1 footer carries the fourth, checksum field. 440.21
   * always prints it (`"%d,%d,%d,0"` with the checksum spliced in, @cite TG
   * json_parser.c:529, :543-550); a g2core rev-1 footer has three fields;
   * revisions 2 and 3 never have one. `checkFooterForDialect` turns a
   * mismatch into `Garbled{bad-footer}`, so a damaged TG line that lost its
   * checksum is never trusted.
   */
  readonly footerChecksum: 'required' | 'absent';
}

export interface DialectLimits {
  /** Longest line run sends (after sanitising, including the N prefix). */
  readonly maxLineBytes: number;
  /** Longest JSON line the firmware accepts. */
  readonly maxJsonLineBytes: number;
  /** Receive ring (TinyG) or per-device RX buffer (g2core). */
  readonly rxBytes: number;
  /**
   * Free planner buffers when the planner is empty. A bench-verified dialect
   * constant (B-QR-1), never learned at the handshake (SAFETY H14).
   */
  readonly plannerBlocks: number;
  /** Free buffers the firmware requires before it reads a new line. */
  readonly plannerHeadroom: number;
  /** Line-mode headers (EN `rxm=1`). */
  readonly lineHeaders?: number;
}

/** Polled-read cadence for stop verification and drain (SAFETY §4.2). */
export interface DialectPolls {
  readonly stopVerifyMs: 250;
  readonly mpoRunMs: 500;
  readonly heldMs: 1000;
}

/** TinyG byte-window streaming (PN §7.4). */
export interface ByteWindowFlow {
  readonly kind: 'byteWindow';
  readonly inFlightMax: 180;
  /** EN line mode: 12 headers minus a margin of 2. */
  readonly linesInFlightMax?: number;
  /** EN footer rev 3: pause feeding when free headers fall to this. */
  readonly freeHeaderPause?: number;
  /**
   * Footer field-3 byte cross-check: `rev1` (TG: sent length + 1, a mismatch
   * is FAULT), `rev2` (EN at `rxm=0` only), or `none`.
   */
  readonly byteCrossCheck: 'rev1' | 'rev2' | 'none';
  /** The firmware's XOFF/XON thresholds as fractions of the ring. */
  readonly xoff: { readonly high: number; readonly low: number };
}

/** g2core line-mode streaming (G2W g2core-Communications.md, "Line Mode Protocol"). */
export interface LineWindowFlow {
  readonly kind: 'lineWindow';
  /** Lines primed, then one more per `r` received. */
  readonly linesInFlightMax: number;
  /** JSON lines produce an `r` and take a slot; single-character controls do not. */
  readonly jsonTakesSlot: true;
  readonly realtimeTakesSlot: false;
  /** JSON lines jump ahead of queued data lines in RX (G2 xio.cpp:785-797). */
  readonly jsonJumpsQueue: true;
}

export type DialectFlow = ByteWindowFlow | LineWindowFlow;

/** Common to every flow engine (PN §7.4; SAFETY §4.3). */
export interface FlowRules {
  readonly engine: DialectFlow;
  /** The queued-motion ceiling bounds every engine, not footer or qr gating. */
  readonly queuedMotionCeiling: true;
  /** Web Serial `flowControl`. `hardware` is refused until B-FC-1. */
  readonly flowControl: 'none';
  /** Bytes the host never writes on this dialect, in data or as realtime. */
  readonly neverSend: readonly number[];
}

export interface UsbIdentity {
  readonly vendorId: number;
  readonly productId: number;
  /**
   * - `control`: the application's serial port;
   * - `bootloader`: only the flasher talks to it;
   * - `refuse`: never opened (Due programming port: DTR edges reset the chip, 1200 baud erases it).
   */
  readonly role: 'control' | 'bootloader' | 'refuse';
  readonly label: string;
}

/** Per-family transport identity (RUN_PLAN §5.1 rule 5). */
export interface DialectTransport {
  readonly usb: readonly UsbIdentity[];
  readonly baudRate: number;
  /** Baud rates run never opens (1200 is the SAM-BA touch). */
  readonly refuseBaudRates: readonly number[];
  /**
   * How the control port is chosen:
   * - `single`: one serial interface (TinyG FT230X);
   * - `firstConnectedCdc`: the first CDC interface to connect becomes control
   *   and primary; a second one may also command the board (S H25).
   */
  readonly controlPort: 'single' | 'firstConnectedCdc';
  /** Serial interfaces the device can expose. */
  readonly maxSerialInterfaces: 1 | 2;
}

/**
 * A preflight block rule, as data for the sanitiser (P0-10, SAFETY §4.7).
 * Every rule has a stable id for reports and a reason with its source.
 */
export type GcodeRule =
  /** Non-whitespace after a comment opener, or an unclosed `(`: TinyG drops it silently. */
  | { readonly id: string; readonly kind: 'textAfterComment'; readonly reason: string }
  /** Any block containing this code (`G28.4`, `G93`, `M201.3`, `M100`). */
  | { readonly id: string; readonly kind: 'code'; readonly code: string; readonly reason: string }
  /** G2/G3 while this plane is active. */
  | { readonly id: string; readonly kind: 'arcInPlane'; readonly plane: 'G17' | 'G18' | 'G19'; readonly reason: string }
  /** Any of `codes` while any of `modes` is active. */
  | {
      readonly id: string;
      readonly kind: 'codeUnderModal';
      readonly codes: readonly string[];
      readonly modes: readonly string[];
      readonly reason: string;
    }
  /** Any word with this letter. */
  | { readonly id: string; readonly kind: 'word'; readonly letter: string; readonly reason: string }
  /** More than `max` queued commands of the listed kinds on one line, motion not counted (E088). */
  | {
      readonly id: string;
      readonly kind: 'queuedCommandsPerLine';
      readonly max: number;
      readonly counted: readonly string[];
      readonly reason: string;
    };

export interface DialectGcode {
  /** G10 L values allowed; any other L is blocked. */
  readonly lWords: readonly number[];
  readonly blocked: readonly GcodeRule[];
  /** Host barriers on every TinyG dialect (PN §9.2). M1 only when optional stop is enabled. */
  readonly barrierCodes: readonly string[];
  /** Program-end codes held back until every earlier line is acknowledged and no alarm (EN E135, H35). */
  readonly holdbackEndCodes: readonly string[];
  /**
   * What a job may contain (ROADMAP P0-10, SAFETY §4.7 step 6). `null` on a
   * dialect that never streams a job (`mode: 'readOnly'`): the sanitiser
   * refuses every job for it.
   */
  readonly job: DialectJobGcode | null;
}

/**
 * The job subset of a dialect's G-code (SAFETY §4.7). The sanitiser reads
 * only this data: it has no `if (dialect)` branches (RUN_PLAN §5.1 rule 4).
 */
export interface DialectJobGcode {
  /**
   * G and M codes a job may contain, in canonical form: the letter, the
   * integer without leading zeros and, for a sub-code, the decimal without
   * trailing zeros (`G0`, `G28.1`, `M3`). Every other code is blocked as
   * unsupported, so a dotted code the firmware would run as its integer code
   * (`G59.1` as G59 on TG) never reaches it. Firmware codes that only the
   * host may use (reports, homing, set-position, probing) are left out on
   * purpose; each data file says which and why.
   */
  readonly codes: readonly string[];
  /** Codes the firmware accepts and ignores: kept, with a warning in the report (PN §9.3). */
  readonly ignoredCodes: readonly string[];
  /** Word letters other than G, M and N that a job may contain. */
  readonly words: readonly string[];
  /** The largest T the firmware stores as written; larger values wrap to another tool (E154). */
  readonly maxTool: number;
  /** A program end (M2/M30) that is not the last line: `block` (EN) or `warn` (TG) (SAFETY §4.7 step 8). */
  readonly midFileProgramEnd: 'block' | 'warn';
  /** M1 with optional stop off: `drop` it host-side (TG), or `send` it for the firmware to skip (EN, `os`=0) (S §4.7 step 7). */
  readonly optionalStopOff: 'drop' | 'send';
  /**
   * True when program end (M2/M30) turns the spindle and coolant off, so a
   * final M2/M30 counts as "off" for the end-state rule (SAFETY H48, §4.7
   * step 8a). False where that is not confirmed (TG, B-M2-1).
   */
  readonly programEndStopsOutputs: boolean;
  /**
   * The frame of the G28/G30 intermediate point (the axis words on the
   * line). `work`: work coordinates, as for G0 (EN clears the absolute
   * override for that leg, @cite EN canonical_machine.c:1302-1317).
   * `machine`: machine coordinates, as under G53 (440.21 sets the absolute
   * override before the intermediate traverse, @cite TG canonical_machine.c:907-914).
   */
  readonly storedMoveIntermediate: 'work' | 'machine';
  /**
   * True when G10 and G92 convert rotary (A/B/C) offset words with the
   * program units, so a rotary offset under G20 is scaled by 25.4. 440.21
   * applies `_to_millimeters` to every axis (@cite TG canonical_machine.c:669,
   * :788-789); EN stores rotary offsets as written, in degrees (@cite EN
   * canonical_machine.c:989, :1127).
   */
  readonly rotaryOffsetsUseUnits: boolean;
  /**
   * What the firmware compares, with fp_EQ in float32, to decide a
   * centre-format arc whose end point meets its start. `position`: the end
   * point against the start on both plane axes; equal is a full circle
   * (@cite EN plan_arc.c:320-329). `angle`: the end angle against the start
   * angle; equal is zero angular travel plus P turns (@cite TG
   * plan_arc.c:285-303).
   */
  readonly arcCoincidence: 'position' | 'angle';
}

/**
 * One step of a stop sequence (SAFETY §4.4), as data. The machine executes
 * these in order; any step that times out shows W12 and latches FAULT.
 */
export type StopStep =
  /** Wait for the in-flight single-line write (at most ~120 B). */
  | { readonly kind: 'awaitInFlightWrite' }
  | { readonly kind: 'stopFeeding' }
  /** Write one realtime byte. It must be one of the dialect's `realtime` bytes. */
  | { readonly kind: 'writeRealtime'; readonly byte: number }
  /** Wait for a report of the held class; skipped when nothing was moving. */
  | { readonly kind: 'awaitHeld'; readonly timeoutMs: number; readonly skipIfNotMoving: true }
  /**
   * Decided from the last known `stat` before anything is written: when it is
   * one of `stat` (SHUTDOWN or PANIC, which `{clear}` cannot leave), the
   * sequence ends here with "Use your E-stop" (`adviseEstop`), the reset path
   * (C15) offered, and `done` with `spindle`. Otherwise the next step runs.
   */
  | { readonly kind: 'haltIfStat'; readonly stat: readonly number[]; readonly spindle: 'unknown' }
  /**
   * Wait for ALARM with this status (stat 2 and an `er` with it). When the
   * machine is ALREADY in an alarm state (`alreadyAlarmedStat`, from the last
   * known `stat` before the kill byte or any report while waiting), the
   * firmware prints nothing new (EN `cm_alarm` returns early, @cite EN
   * canonical_machine.c:797-803): the existing alarm stands in for this one
   * and the step succeeds.
   */
  | { readonly kind: 'awaitAlarm'; readonly status: number; readonly alreadyAlarmedStat: readonly number[]; readonly timeoutMs: number }
  /** The user confirms (C13 before `{clear}`). */
  | { readonly kind: 'confirm'; readonly confirmation: 'C13' }
  /** `{"clear":null}`, with `tid` where the dialect has it. The only JSON a stop writes. */
  | { readonly kind: 'clearAlarm' }
  /** A G-code line, waiting for its `r`. */
  | { readonly kind: 'writeLine'; readonly line: 'M5' | 'M9'; readonly awaitResponse: true }
  /**
   * Polled reads (`stat`, `hold`, `qr`, `vel`) until every listed condition
   * holds in `consecutive` reads `intervalMs` apart (the E114 check).
   */
  | {
      readonly kind: 'verifyDrained';
      readonly stat: readonly number[];
      readonly holdZero: boolean;
      /** `qr == limits.plannerBlocks`. */
      readonly plannerEmpty: boolean;
      readonly velZero: boolean;
      readonly consecutive: 2;
      readonly intervalMs: 250;
      readonly timeoutMs: number;
    }
  /** Read `homx..` and require re-homing where any is 0. */
  | { readonly kind: 'requireRehomeIfUnhomed' }
  | { readonly kind: 'resetCounters' }
  /** "Use your E-stop or the controller's own stop." */
  | { readonly kind: 'adviseEstop' }
  /** End of the sequence, with what the UI may say about the spindle. */
  | { readonly kind: 'done'; readonly spindle: 'offControllerAlarm' | 'unconfirmed' | 'unknown' };

export interface StopSequence {
  readonly steps: readonly StopStep[];
  /** Any step that times out: W12 and a latched FAULT (SAFETY §4.4 "Escalation"). */
  readonly onTimeout: 'faultW12';
}

/** A fact no source or bench run has confirmed yet (RUN_PLAN §8.1 honesty rule). */
export interface UnverifiedFact {
  /** Dotted path of the field, e.g. `limits.plannerBlocks`. */
  readonly field: string;
  /** The PROTOCOL_NOTES §15 bench task that closes it. */
  readonly bench: string;
  readonly note: string;
}

/** The boot banner shape a dialect prints (PN §2.2). */
export type BannerShape = 'r-footer' | 'bare-sr';

export interface Dialect {
  readonly id: DialectId;
  readonly family: Family;
  readonly label: string;
  /**
   * - `manifest`: full support only for builds in the signed approved-builds
   *   manifest; READ_ONLY otherwise.
   * - `readOnly`: always READ_ONLY, whatever the manifest says.
   */
  readonly mode: 'manifest' | 'readOnly';
  /** Offer a firmware upgrade when this dialect is detected (D23). */
  readonly upgradeOffer: boolean;
  readonly bannerShape: BannerShape;
  /** `stat` values, indexed by value. */
  readonly stat: readonly StatEntry[];
  /** Feedhold `hold` state names, indexed by value. */
  readonly hold: readonly string[];
  /** Classified status codes; anything else non-zero is `error`. */
  readonly status: ReadonlyMap<number, StatusEntry>;
  readonly realtime: RealtimeBytes;
  readonly caps: DialectCaps;
  readonly limits: DialectLimits;
  readonly polls: DialectPolls;
  readonly flow: FlowRules;
  readonly transport: DialectTransport;
  readonly gcode: DialectGcode;
  readonly stopJob: StopSequence;
  readonly unverified: readonly UnverifiedFact[];
}
