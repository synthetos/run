/**
 * The edge-next G38.2 probing cycle (`cycle_probing.c`) and the probe input
 * (`switch.c`), with a simulated touch plate and lead, for
 * `TinyGEdgeNextModel`. Citations are edge-next a7489b79; the register
 * entries are in honesty/behaviours.ts.
 *
 * The model owns the machine (planner, holds, alarms, output); this module
 * owns the cycle's own state and talks to the model through `ProbeHost`, as
 * the firmware's probe callback talks to the canonical machine. Structure
 * follows the source: `command()` is `cm_straight_probe()`, `callback()` is
 * `cm_probe_callback()` with the staged `_probing_init` / `_probing_start` /
 * `_probing_finish` / `_probing_finalize_exit`, and `sense()` is the probe
 * branch of `_dispatch_switch()`.
 *
 * DEV ONLY. Nothing in a production bundle may import this (T-S40).
 */
import '../marker.ts';
import type { Vec } from './motion.ts';

/** MINIMUM_PROBE_TRAVEL, mm (@cite EN cycle_probing.c:45). */
export const MINIMUM_PROBE_TRAVEL = 0.254;

/** Switch mode tokens in switch order: in1..in8 are X min, X max, Y min, ... A max (@cite EN switch.h:69-80). */
const SWITCH_KEYS = ['xsn', 'xsx', 'ysn', 'ysx', 'zsn', 'zsx', 'asn', 'asx'] as const;
/** SW_MODE_PROBE (@cite EN switch.h:46). */
const SW_MODE_PROBE = 4;

/** What the probe cycle needs from the canonical machine. */
export interface ProbeHost {
  setting(key: string): number;
  /** Machine position now, mm. */
  machinePosition(): Vec;
  /** `!mp_runtime_is_idle() || (!heldProbe && mp_has_runnable_buffer())` (@cite EN cycle_probing.c:167-170). */
  busy(heldProbe: boolean): boolean;
  /** The hold is complete (`FEEDHOLD_HOLD`). */
  held(): boolean;
  alarmed(): boolean;
  /** `_probing_init()`: cycle state PROBE, absolute distance mode (@cite EN cycle_probing.c:212-220). */
  enterCycle(): void;
  /** `cm_straight_feed()` to a machine target: a soft limit alarms there and returns its status (@cite EN canonical_machine.c:1522-1527). */
  feed(target: Vec): number;
  requestFeedhold(): void;
  /**
   * `_probing_finalize_exit()` (@cite EN cycle_probing.c:296-313): flush the planner, put the distance mode back,
   * cancel the motion mode, end the cycle unless alarmed, cycle state off.
   */
  finalize(incremental: boolean): void;
  /** The probe result frame: work position in current units before 450.03, machine mm from 450.03. */
  resultPosition(): Vec;
  /** Print one unsolicited line. */
  print(result: { readonly e: 0 | 1; readonly position: Vec }): void;
  alarm(status: number, msg: string): void;
  status(name: string): number;
}

/** What `command()` needs from the parsed block. */
export interface ProbeCommand {
  /** Feed rate in force after the block's F, mm/min. */
  readonly feed: number;
  /** Axis words present, X..C. */
  readonly flags: readonly boolean[];
  /** The resolved machine target (G91: here plus the distance, at command time). */
  readonly target: Vec;
  /** XYZ travel from here to the target, mm. */
  readonly travelMm: number;
  /** The distance mode in force at command time is G91 (saved and restored, @cite EN cycle_probing.c:135, :305). */
  readonly incremental: boolean;
}

type Stage = 'idle' | 'waiting' | 'start' | 'finish' | 'finalize';

export class ProbeCycle {
  readonly #host: ProbeHost;
  #stage: Stage = 'idle';
  #inCycle = false;
  #target: Vec = [0, 0, 0, 0, 0, 0];
  #incremental = false;
  #alreadyTripped = false;
  #e: 0 | 1 = 0;
  #last = false;
  // The simulated plate and lead (test controls, not firmware state).
  #plateZ: number | null = null;
  #touching = false;
  #lead = true;

  constructor(host: ProbeHost) {
    this.#host = host;
  }

  // ---- test controls

  setPlate(z: number | null): void {
    this.#plateZ = z;
  }

  setTouch(touching: boolean): void {
    this.#touching = touching;
  }

  setLead(connected: boolean): void {
    this.#lead = connected;
  }

  /** Power-up or reset: no cycle in progress (the plate and lead are physical and stay). */
  reset(): void {
    this.#stage = 'idle';
    this.#inCycle = false;
    this.#last = false;
  }

  // ---- the probe input

  /**
   * `find_probe_switch()` (@cite EN switch.c:296-325): -1 none, -2 several, -3 on A; else the switch index.
   * @behaviour EN-PROBE-SWITCH
   */
  findProbeSwitch(): number {
    const mode = (i: number): number => this.#host.setting(SWITCH_KEYS[i] as string);
    if (mode(6) === SW_MODE_PROBE || mode(7) === SW_MODE_PROBE) return -3;
    let probe = -1;
    for (let i = 0; i < 6; i++) {
      if (mode(i) !== SW_MODE_PROBE) continue;
      if (probe !== -1) return -2;
      probe = i;
    }
    return probe;
  }

  /**
   * The probe input, logical (after `prbp`, @cite EN switch.c:133-134, :178): a lead that is off reads inactive on a
   * normally open input (`prbp` 0) and active on a normally closed one (`prbp` 1); otherwise the plate's contact.
   * @behaviour EN-PROBE-INPUT
   */
  active(): boolean {
    if (!this.#lead) return this.#host.setting('prbp') === 1;
    if (this.#touching) return true;
    return this.#plateZ !== null && (this.#host.machinePosition()[2] as number) <= this.#plateZ + 1e-9;
  }

  /** `in<n>` for an input in probe mode: 1 active, 0 inactive (@cite EN config_app.c:510-517); undefined otherwise. */
  read(input: number): number | undefined {
    const key = SWITCH_KEYS[input - 1];
    if (key === undefined || this.#host.setting(key) !== SW_MODE_PROBE) return undefined;
    return this.active() ? 1 : 0;
  }

  /**
   * The switch interrupt (@cite EN switch.c:228-231): a leading edge on the probe input during the probe cycle
   * requests a feedhold, a normal hold. Any edge counts, whatever caused it. @behaviour EN-PROBE-CONTACT-HOLD
   */
  sense(): void {
    const now = this.active();
    if (now && !this.#last && this.#inCycle) this.#host.requestFeedhold();
    this.#last = now;
  }

  // ---- the cycle

  /** A cycle is queued or running: the main loop keeps running. */
  busy(): boolean {
    return this.#stage !== 'idle';
  }

  /** `cm.cycle_state == CYCLE_PROBE`. */
  inCycle(): boolean {
    return this.#inCycle;
  }

  /**
   * `cm_straight_probe()` (@cite EN cycle_probing.c:75-138): the checks, in the source's order, are reply-only
   * (no alarm, no motion); on success the cycle waits for the planner to empty and the line is answered 0 at once.
   * @behaviour EN-PROBE-COMMAND
   */
  command(c: ProbeCommand): number {
    const h = this.#host;
    if (!(c.feed > 0)) return h.status('GCODE_FEEDRATE_NOT_SPECIFIED');
    if (c.flags[3] === true || c.flags[4] === true || c.flags[5] === true) return h.status('GCODE_AXIS_CANNOT_BE_PRESENT');
    if (!(c.flags[0] === true || c.flags[1] === true || c.flags[2] === true)) return h.status('GCODE_AXIS_IS_MISSING');
    const sw = this.findProbeSwitch();
    if (sw === -1) return h.status('NO_PROBE_SWITCH_CONFIGURED');
    if (sw === -2) return h.status('MULTIPLE_PROBE_SWITCHES_CONFIGURED');
    if (sw === -3) return h.status('PROBE_SWITCH_ON_ABC_AXIS');
    if (c.travelMm < MINIMUM_PROBE_TRAVEL) return h.status('PROBE_TRAVEL_TOO_SMALL');
    this.#target = [...c.target] as Vec;
    this.#incremental = c.incremental;
    this.#stage = 'waiting';
    return 0;
  }

  /**
   * `cm_probe_callback()` (@cite EN cycle_probing.c:157-187), after the feedhold sequencing in the main loop
   * (@cite EN controller.c:191-194). `busy` and `stepped` are EAGAIN (data lines wait; control lines were already
   * read): `busy` waits for motion, `stepped` ran a stage. `done` lets the rest of the main loop run.
   * @behaviour EN-PROBE-CYCLE
   */
  callback(): 'done' | 'busy' | 'stepped' {
    if (this.#stage === 'idle') return 'done';
    const h = this.#host;
    const heldProbe = this.#inCycle && h.held();
    if (h.busy(heldProbe)) return 'busy';
    if (h.alarmed()) {
      // An alarm ends the probe without a report (^D, a limit): finalize only if the cycle had started.
      if (this.#inCycle) this.#finalize(false);
      this.#stage = 'idle';
      return 'done';
    }
    switch (this.#stage) {
      case 'waiting':
        h.enterCycle();
        this.#inCycle = true;
        this.#stage = 'start';
        return 'stepped';
      case 'start': {
        // @behaviour EN-PROBE-ALREADY-TRIPPED: an active input before the move fails the cycle (@cite EN cycle_probing.c:232-246)
        this.#alreadyTripped = this.active();
        this.#last = this.#alreadyTripped;
        if (!this.#alreadyTripped) {
          const status = h.feed(this.#target);
          if (status !== 0) {
            // _probing_error_exit(): the soft limit already alarmed in cm_straight_feed; no report (@cite EN cycle_probing.c:326-337)
            if (!h.alarmed()) h.alarm(status, 'Probe move failed');
            this.#finalize(false);
            this.#stage = 'idle';
            return 'done';
          }
        }
        this.#stage = 'finish';
        return 'stepped';
      }
      case 'finish': {
        // @behaviour EN-PROBE-REPORT: e is read after the stop, not latched at the trip (@cite EN cycle_probing.c:278-290)
        this.#e = this.active() && !this.#alreadyTripped ? 1 : 0;
        h.print({ e: this.#e, position: h.resultPosition() });
        this.#stage = 'finalize';
        return 'stepped';
      }
      default: {
        this.#finalize(true);
        this.#stage = 'idle';
        return 'done';
      }
    }
  }

  #finalize(alarmIfFailed: boolean): void {
    const h = this.#host;
    h.finalize(this.#incremental);
    this.#inCycle = false;
    if (!alarmIfFailed || h.alarmed()) return;
    // @behaviour EN-PROBE-MISS-ALARM: a probe that does not trip is ALARM 250 (@cite EN cycle_probing.c:315-320)
    if (this.#alreadyTripped) h.alarm(h.status('PROBE_CYCLE_FAILED'), 'Probe already tripped');
    else if (this.#e === 0) h.alarm(h.status('PROBE_CYCLE_FAILED'), 'Probe did not trip');
  }
}
