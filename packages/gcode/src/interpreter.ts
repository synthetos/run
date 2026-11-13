/**
 * Dialect-aware modal interpreter and analyser (ROADMAP TB-02, old P1-03;
 * TOOLS_PLAN §6.2; SAFETY §4.7 "Single source of truth").
 *
 * The input is ALWAYS `sanitizeJob(...).lines` for the selected dialect,
 * with its report: the preview, the analyser and preflight interpret exactly
 * the lines that will be sent, never the original file (T-S1). Lines the
 * sanitiser rejected are not drawn; every line after the first one is
 * flagged uncertain.
 *
 * Every dialect difference is read from the dialect DATA (RUN_PLAN §5.1
 * rule 4): G10 L values (`gcode.lWords`), blocked arcs per plane
 * (`arcInPlane`), barriers (`barrierCodes`), the G28/G30 intermediate frame,
 * rotary offset units, arc coincidence, mid-file program end, program-end
 * outputs and arc soft limits (`caps.arcSoftLimits`). The interpreter applies
 * the dialect rules itself as well, so a line that reached it without the
 * sanitiser's check is still blocked, never drawn with another firmware's
 * semantics.
 */
import type { Dialect, DialectJobGcode, GcodeRule } from '@synthetos/protocol';
import {
  blockFindingText,
  AXES,
  PLANES,
  WCS_CODES,
  modelArc,
  type ArcModel,
  type Axis,
  type Plane,
  type SanitizeResult,
  type SentLine,
  type Wcs,
} from '@synthetos/safety';
import { DEFAULT_CHORD_MM, arcBox, arcSegments, tessellateArc } from './arcs.ts';
import { EventRecorder, emptyTape } from './events.ts';
import { FrameRecorder, emptyFrames } from './frames.ts';
import { codeOf, parseLine } from './parser.ts';
import { KIND, LINE_FLAG, type Box, type Finding, type InterpretOptions, type JobAnalysis, type TimingModel } from './types.ts';

/** TOOLS_PLAN §6.2: total vertex cap before arcs are coarsened. */
export const DEFAULT_VERTEX_CAP = 20_000_000;

const ROTARY: ReadonlySet<Axis> = new Set<Axis>(['A', 'B', 'C']);
/** The arc plane's index in the event tape (events.ts). */
const PLANE_INDEX: Readonly<Record<Plane, number>> = { G17: 0, G18: 1, G19: 2 };
const MM_PER_INCH = 25.4;

type Pos = Record<Axis, number>;
type Motion = 'G0' | 'G1' | 'G2' | 'G3' | 'G80';

const zero = (): Pos => ({ X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 });
const fill = (v: Partial<Record<Axis, number>> | undefined): { pos: Pos; complete: boolean } => {
  const pos = zero();
  let complete = v !== undefined;
  for (const a of AXES) {
    const x = v?.[a];
    if (x === undefined || !Number.isFinite(x)) complete = false;
    else pos[a] = x;
  }
  return { pos, complete };
};

/** One drawable piece of a line, collected before tessellation (so the vertex cap can coarsen arcs). */
type Piece =
  | { readonly kind: 'line'; readonly line: number; readonly to: Pos; readonly k: number }
  | { readonly kind: 'arc'; readonly line: number; readonly from: Pos; readonly to: Pos; readonly arc: ArcModel; readonly plane: Plane; readonly k: number }
  | { readonly kind: 'jump'; readonly line: number; readonly to: Pos; readonly k: number };

class Interpreter {
  readonly findings: Finding[] = [];
  readonly pieces: Piece[] = [];
  readonly flags: Uint8Array;
  readonly pausePoints: number[] = [];
  /** The analytic event tape (events.ts), recorded as the lines are stepped. */
  readonly events: EventRecorder;
  /** The program-to-path offset table (frames.ts), filled as the lines are stepped. */
  readonly frameTable: FrameRecorder;
  machine: Pos;
  units: 'G20' | 'G21';
  distance: 'G90' | 'G91';
  arcDistance: 'G90.1' | 'G91.1';
  plane: Plane;
  motion: Motion;
  feed: number | undefined;
  wcs: Wcs;
  wcsOffsets: Record<Wcs, Pos>;
  g92: { offsets: Pos; active: boolean };
  tool: Pos;
  g28: Pos | null;
  g30: Pos | null;
  spindle: 'off' | 'cw' | 'ccw';
  mist: boolean;
  flood: boolean;
  readonly defaults: { units: 'G20' | 'G21'; distance: 'G90' | 'G91'; plane: Plane; wcs: Wcs };
  /** Everything from here on is uncertain. */
  uncertain = false;
  seconds: number | null = 0;
  rapidMm = 0;
  feedMm = 0;
  arcs = 0;
  unitsSeen = false;
  distanceSeen = false;
  movedYet = false;
  readonly once = new Set<string>();

  readonly dialect: Dialect;
  readonly job: DialectJobGcode;
  readonly lines: readonly SentLine[];
  readonly options: InterpretOptions;

  constructor(dialect: Dialect, job: DialectJobGcode, lines: readonly SentLine[], options: InterpretOptions) {
    this.dialect = dialect;
    this.job = job;
    this.lines = lines;
    this.options = options;
    this.flags = new Uint8Array(lines.length);
    this.events = new EventRecorder(lines);
    const s = options.start ?? {};
    const m = fill(s.machine);
    this.machine = m.pos;
    this.units = s.units ?? 'G21';
    this.distance = s.distance ?? 'G90';
    this.arcDistance = s.arcDistance ?? 'G91.1';
    this.plane = s.plane ?? 'G17';
    this.motion = s.motion ?? 'G80';
    this.feed = s.feedMmPerMin;
    this.wcs = s.wcs ?? 'G54';
    const offsets = {} as Record<Wcs, Pos>;
    let offsetsKnown = true;
    for (const w of WCS_CODES) {
      const f = fill(s.wcsOffsets?.[w]);
      offsets[w] = f.pos;
      if (!f.complete) offsetsKnown = false;
    }
    this.wcsOffsets = offsets;
    const g = fill(s.g92?.offsets);
    this.g92 = { offsets: g.pos, active: s.g92?.active ?? false };
    const t = fill(s.toolOffset);
    this.tool = t.pos;
    this.frameTable = new FrameRecorder([this.offset('X'), this.offset('Y'), this.offset('Z')]);
    this.g28 = s.g28 === undefined ? null : fill(s.g28).pos;
    this.g30 = s.g30 === undefined ? null : fill(s.g30).pos;
    this.spindle = s.spindle ?? 'off';
    this.mist = s.mist ?? false;
    this.flood = s.flood ?? false;
    this.defaults = {
      units: s.defaults?.units ?? this.units,
      distance: s.defaults?.distance ?? 'G90',
      plane: s.defaults?.plane ?? 'G17',
      wcs: s.defaults?.wcs ?? 'G54',
    };
    const assumed: string[] = [];
    if (!m.complete) assumed.push('machine position');
    if (!offsetsKnown) assumed.push('work offsets');
    if (s.g92 === undefined || !g.complete) assumed.push('G92 offsets');
    if (!t.complete) assumed.push('tool offset');
    if (assumed.length > 0) {
      this.uncertain = !m.complete || !offsetsKnown || !g.complete;
      this.add(0, null, 'warn', 'start-assumed', `not read from the board, assumed zero: ${assumed.join(', ')}; positions are flagged uncertain`);
    }
  }

  add(line: number, n: number | null, severity: Finding['severity'], rule: string, message: string): void {
    this.findings.push({ line, n, severity, rule, message: severity === 'block' ? blockFindingText(rule, message, line) : message, source: 'analyser' });
  }

  addOnce(key: string, line: number, n: number | null, severity: Finding['severity'], rule: string, message: string): void {
    if (this.once.has(key)) return;
    this.once.add(key);
    this.add(line, n, severity, rule, message);
  }

  /** Program units to mm. */
  get scale(): number {
    return this.units === 'G20' ? MM_PER_INCH : 1;
  }

  /** The work offset on an axis. EN and TG apply the tool offset to X, Y and Z only (@cite EN canonical_machine.c:536-563). */
  offset(a: Axis): number {
    return this.wcsOffsets[this.wcs][a] + (this.g92.active ? this.g92.offsets[a] : 0) + (ROTARY.has(a) ? 0 : this.tool[a]);
  }

  work(a: Axis): number {
    return this.machine[a] - this.offset(a);
  }

  /** Axis word → mm (rotary: degrees, as written). */
  axisMm(a: Axis, v: number): number {
    return ROTARY.has(a) ? v : v * this.scale;
  }

  /** An offset word → mm. Rotary offsets follow the dialect (`rotaryOffsetsUseUnits`). */
  offsetMm(a: Axis, v: number): number {
    return ROTARY.has(a) && !this.job.rotaryOffsetsUseUnits ? v : v * this.scale;
  }

  /** The dialect's block rules, applied to one line (defence in depth behind the sanitiser). */
  ruleBlocks(codes: readonly string[], letters: ReadonlySet<string>): GcodeRule[] {
    const out: GcodeRule[] = [];
    for (const r of this.dialect.gcode.blocked) {
      switch (r.kind) {
        case 'code':
          if (codes.includes(r.code)) out.push(r);
          break;
        case 'word':
          if (letters.has(r.letter)) out.push(r);
          break;
        case 'codeUnderModal': {
          const modes = [this.units, this.distance, this.plane, this.arcDistance, this.motion];
          if (r.codes.some((c) => codes.includes(c)) && r.modes.some((m) => modes.includes(m as never))) out.push(r);
          break;
        }
        case 'queuedCommandsPerLine': {
          let count = 0;
          for (const c of codes) if (r.counted.includes(c)) count++;
          for (const l of letters) if (r.counted.includes(l)) count++;
          if (count > r.max) out.push(r);
          break;
        }
        case 'arcInPlane':
          // Applied at the arc itself, with the plane in force on that line.
          break;
        case 'textAfterComment':
          // Sent lines carry no comments (the sanitiser stripped or rejected them).
          break;
      }
    }
    return out;
  }

  step(line: SentLine, i: number, last: boolean): void {
    const src = line.sourceLine;
    const n = line.n;
    const parsed = parseLine(line.body, src);
    if (parsed.errors.length > 0 || parsed.cmds.length > 0) {
      this.add(src, n, 'block', 'parse-error', `the line cannot be read as G-code: ${parsed.errors.map((e) => e.message).join('; ') || 'controller command'}`);
      this.flags[i] = (this.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
      return;
    }
    const codes: string[] = [];
    const params = new Map<string, number>();
    const letters = new Set<string>();
    const axisWords = new Map<Axis, number>();
    for (const w of parsed.words) {
      const c = codeOf(w);
      if (c !== undefined) codes.push(c);
      else {
        letters.add(w.letter);
        if (!params.has(w.letter)) params.set(w.letter, w.value);
        if ((AXES as readonly string[]).includes(w.letter) && !axisWords.has(w.letter as Axis)) axisWords.set(w.letter as Axis, w.value);
      }
    }
    const has = (c: string): boolean => codes.includes(c);

    // Dialect data first: anything this dialect does not run as written is a block, never drawn.
    const unsupported = codes.filter((c) => !this.job.codes.includes(c) && !this.job.ignoredCodes.includes(c));
    for (const c of unsupported) this.add(src, n, 'block', 'unsupported-code', `${c} is not supported in a job on ${this.dialect.label}`);
    for (const c of codes) {
      if (this.job.ignoredCodes.includes(c)) this.addOnce(`ignored ${c}`, src, n, 'info', 'ignored-code', `${c} is accepted and ignored by ${this.dialect.label}`);
    }
    if (unsupported.length > 0) {
      this.flags[i] = (this.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
      return;
    }

    if (this.uncertain) this.flags[i] = (this.flags[i] as number) | LINE_FLAG.UNCERTAIN;

    // Outputs and dwell (NIST order of execution).
    if (has('M3')) this.spindle = 'cw';
    if (has('M4')) this.spindle = 'ccw';
    if (has('M5')) this.spindle = 'off';
    if (has('M7')) this.mist = true;
    if (has('M8')) this.flood = true;
    if (has('M9')) {
      this.mist = false;
      this.flood = false;
    }
    if (has('G4')) {
      const p = params.get('P');
      if (p !== undefined && this.seconds !== null) this.seconds += p;
      if (p !== undefined) this.events.dwell(p);
    }

    // Modal state.
    for (const p of ['G17', 'G18', 'G19'] as const) if (has(p)) this.plane = p;
    for (const u of ['G20', 'G21'] as const) {
      if (!has(u)) continue;
      if (this.movedYet && this.unitsSeen && u !== this.units) {
        this.addOnce('units-switched', src, n, 'warn', 'units-switched', `units switched to ${u} after motion: check that the rest of the file expects ${u === 'G20' ? 'inches' : 'millimetres'}`);
      }
      this.units = u;
      this.unitsSeen = true;
    }
    if (has('G49')) this.tool = zero();
    if (has('G43.1')) for (const [a, v] of axisWords) if (!ROTARY.has(a)) this.tool[a] = v * this.scale;
    for (const w of WCS_CODES) if (has(w)) this.wcs = w;
    for (const d of ['G90', 'G91'] as const) {
      if (has(d)) {
        this.distance = d;
        this.distanceSeen = true;
      }
    }
    if (has('G90.1')) this.arcDistance = 'G90.1';
    if (has('G91.1')) this.arcDistance = 'G91.1';
    // F is read in the units in force for this line.
    const f = params.get('F');
    if (f !== undefined) this.feed = f * this.scale;
    this.events.words(codes, params.get('S'), params.get('T'));

    // The dialect's block rules, with this line's modes (TG: G28/G30 under G20 or G91).
    const rules = this.ruleBlocks(codes, letters);
    for (const r of rules) this.add(src, n, 'block', r.id, r.reason);
    if (rules.length > 0) {
      this.flags[i] = (this.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
      return;
    }

    // Non-modal actions that consume the axis words.
    if (has('G10')) {
      this.g10(params, axisWords, src, n, i);
    } else if (has('G28.1')) {
      this.g28 = { ...this.machine };
    } else if (has('G30.1')) {
      this.g30 = { ...this.machine };
    } else if (has('G92')) {
      for (const [a, v] of axisWords) {
        this.g92.offsets[a] = this.machine[a] - this.wcsOffsets[this.wcs][a] - (ROTARY.has(a) ? 0 : this.tool[a]) - this.offsetMm(a, v);
      }
      this.g92.active = true;
      if (axisWords.size > 0) this.frameTable.g92(src);
    } else if (has('G92.1')) {
      this.g92 = { offsets: zero(), active: false };
    } else if (has('G92.2')) {
      this.g92.active = false;
    } else if (has('G92.3')) {
      this.g92.active = true;
    } else if (has('G28') || has('G30')) {
      this.storedMove(has('G28') ? 'G28' : 'G30', axisWords, src, n, i);
    } else if (!has('G43.1')) {
      for (const m of ['G0', 'G1', 'G2', 'G3', 'G80'] as const) if (has(m)) this.motion = m;
      if (axisWords.size > 0 || (this.motion === 'G2' || this.motion === 'G3') && (letters.has('I') || letters.has('J') || letters.has('K') || letters.has('R'))) {
        this.move(axisWords, params, has('G53'), src, n, i);
      }
    }

    // Pauses: the dialect's barrier codes (M1 only with optional stop on), or the C14 M0.
    const barrierCodes = this.dialect.gcode.barrierCodes.filter((c) => c !== 'M1' || this.options.optionalStop === true);
    const pause = codes.some((c) => barrierCodes.includes(c));
    if (pause !== line.barrier) {
      this.add(src, n, 'block', 'barrier-mismatch', pause
        ? 'this line pauses the job on this dialect, but the stream does not stop feeding after it'
        : 'the stream stops feeding after this line, but nothing on it pauses this dialect');
    }
    if (pause) {
      this.events.barrier();
      this.flags[i] = (this.flags[i] as number) | LINE_FLAG.PAUSE;
      this.pausePoints.push(n);
      if (this.spindle !== 'off' || this.mist || this.flood) {
        this.add(src, n, 'info', 'pause-outputs-on', 'the spindle and coolant stay on at this pause');
      }
    }

    // Program end.
    const end = this.dialect.gcode.holdbackEndCodes.some((c) => codes.includes(c));
    if (end) {
      if (!last) {
        const severity = this.job.midFileProgramEnd;
        this.add(src, n, severity, 'mid-file-program-end', severity === 'block'
          ? '' /* Shared H35 text is supplied by add. */
          : 'M2/M30 before the end of the file: the lines after it still run');
      }
      this.programEnd();
    }
    if (this.uncertain) this.flags[i] = (this.flags[i] as number) | LINE_FLAG.UNCERTAIN;
  }

  /** M2/M30 (@cite EN canonical_machine.c:2174-2214): G92.1, default system, plane, units, G90, G80; outputs per dialect. */
  programEnd(): void {
    this.g92 = { offsets: zero(), active: false };
    this.wcs = this.defaults.wcs;
    this.plane = this.defaults.plane;
    this.units = this.defaults.units;
    this.distance = 'G90';
    this.motion = 'G80';
    if (this.job.programEndStopsOutputs) {
      this.spindle = 'off';
      this.mist = false;
      this.flood = false;
    }
  }

  g10(params: ReadonlyMap<string, number>, axisWords: ReadonlyMap<Axis, number>, src: number, n: number, i: number): void {
    const l = params.get('L');
    const p = params.get('P');
    if (l === undefined || !this.dialect.gcode.lWords.includes(l)) {
      const allowed = this.dialect.gcode.lWords.map((v) => `L${String(v)}`).join(', ');
      this.add(src, n, 'block', 'l-word', l === 20
        ? `${this.dialect.label} has no G10 L20 (only ${allowed}): it would run as L2 and set the offset to the written value, not to the current position`
        : `G10 ${l === undefined ? 'without L' : `L${String(l)}`} is not supported on ${this.dialect.label} (only ${allowed})`);
      this.flags[i] = (this.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
      return;
    }
    const target = p !== undefined && Number.isInteger(p) && p >= 1 && p <= 6 ? (WCS_CODES[p - 1] as Wcs) : undefined;
    if (target === undefined) {
      this.add(src, n, 'block', 'bad-parameter', 'G10 needs P1 to P6');
      return;
    }
    for (const [a, v] of axisWords) {
      const mm = this.offsetMm(a, v);
      if (l === 2) this.wcsOffsets[target][a] = mm;
      else {
        // L20: the offset that makes the current position read `v` in that system (@cite EN canonical_machine.c:1055-1062).
        this.wcsOffsets[target][a] = this.machine[a] - mm - (this.g92.active ? this.g92.offsets[a] : 0) - (ROTARY.has(a) ? 0 : this.tool[a]);
      }
    }
  }

  /** G28/G30: an optional intermediate point, then the stored position on every axis (@cite EN canonical_machine.c:1390-1405). */
  storedMove(code: 'G28' | 'G30', axisWords: ReadonlyMap<Axis, number>, src: number, n: number, i: number): void {
    if (axisWords.size > 0) {
      const to = { ...this.machine };
      for (const [a, v] of axisWords) {
        const mm = this.axisMm(a, v);
        if (this.job.storedMoveIntermediate === 'machine') to[a] = mm;
        else to[a] = this.distance === 'G91' ? this.machine[a] + mm : mm + this.offset(a);
      }
      this.linear(to, 'G0', i);
    }
    const stored = code === 'G28' ? this.g28 : this.g30;
    if (stored === null) {
      this.uncertain = true;
      this.events.unmodelled(this.machine, this.machine);
      this.add(src, n, 'warn', 'stored-position-unknown', `the stored ${code} position was not read from the board: the preview cannot draw this move and every later position is uncertain`);
      return;
    }
    this.linear({ ...stored }, 'G0', i);
  }

  move(axisWords: ReadonlyMap<Axis, number>, params: ReadonlyMap<string, number>, g53: boolean, src: number, n: number, i: number): void {
    const to = { ...this.machine };
    for (const [a, v] of axisWords) {
      const mm = this.axisMm(a, v);
      // G53: machine coordinates, absolute for this line only.
      to[a] = g53 ? mm : this.distance === 'G91' ? this.machine[a] + mm : mm + this.offset(a);
    }
    if (this.motion === 'G80') return;
    if (this.motion !== 'G0' && this.feed === undefined) {
      this.add(src, n, 'block', 'feed-not-set', `${this.motion} before any F word: the board would use whatever feed rate it has (SAFETY §4.5)`);
    }
    if (this.motion !== 'G0' && this.spindle === 'off' && (to.X !== this.machine.X || to.Y !== this.machine.Y || to.Z !== this.machine.Z)) {
      this.flags[i] = (this.flags[i] as number) | LINE_FLAG.SPINDLE_OFF_CUT;
      this.addOnce('spindle-off', src, n, 'warn', 'spindle-off-cut', 'a cutting move with the spindle off');
    }
    if (this.motion === 'G0' || this.motion === 'G1') {
      this.linear(to, this.motion, i);
      if (this.motion === 'G0' && to.Z - this.offset('Z') < 0) {
        this.addOnce('rapid-below-z0', src, n, 'warn', 'rapid-below-z0', 'a rapid move ends below work Z0 (heuristic: check it clears the stock)');
      }
      return;
    }
    this.arc(to, axisWords, params, src, n, i);
  }

  arc(to: Pos, axisWords: ReadonlyMap<Axis, number>, params: ReadonlyMap<string, number>, src: number, n: number, i: number): void {
    const plane = this.plane;
    const ax = PLANES[plane];
    const blocked = this.dialect.gcode.blocked.find((r) => r.kind === 'arcInPlane' && r.plane === plane);
    if (blocked !== undefined) {
      // Never drawn with another firmware's direction: the jump is shown, the arc is not.
      this.add(src, n, 'block', blocked.id, blocked.reason);
      this.flags[i] = (this.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
      this.jump(to, i);
      return;
    }
    const a0 = ax.a0 as Axis;
    const a1 = ax.a1 as Axis;
    const lin = ax.lin as Axis;
    const r = params.get('R');
    const o0 = params.get(ax.o0);
    const o1 = params.get(ax.o1);
    let centre: { c0: number; c1: number } | null = null;
    if (r === undefined) {
      if (this.arcDistance === 'G90.1') {
        centre = {
          c0: (o0 === undefined ? this.work(a0) : o0 * this.scale) + this.offset(a0) - this.machine[a0],
          c1: (o1 === undefined ? this.work(a1) : o1 * this.scale) + this.offset(a1) - this.machine[a1],
        };
      } else centre = { c0: (o0 ?? 0) * this.scale, c1: (o1 ?? 0) * this.scale };
    }
    const p = params.get('P');
    const result = modelArc({
      clockwise: this.motion === 'G2',
      d0: to[a0] - this.machine[a0],
      d1: to[a1] - this.machine[a1],
      dLin: to[lin] - this.machine[lin],
      centre,
      radius: r === undefined ? null : r * this.scale,
      noPlaneEndpoint: !axisWords.has(a0) && !axisWords.has(a1),
      rotations: p ?? null,
      coincidence: this.job.arcCoincidence,
      magnitudeMm: Math.max(
        Math.abs(this.machine[a0]),
        Math.abs(this.machine[a1]),
        Math.abs(this.work(a0)),
        Math.abs(this.work(a1)),
        Math.abs(this.offset(a0)),
        Math.abs(this.offset(a1)),
      ),
      startUncertaintyMm: 0,
    });
    if (result.kind === 'invalid') {
      this.add(src, n, 'block', 'arc-rejected', `the firmware will reject this arc: ${result.detail} (plan_arc.h tolerances)`);
      this.flags[i] = (this.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
      return;
    }
    if (result.kind === 'ambiguous') {
      this.add(src, n, 'block', 'arc-ambiguous', `the firmware's decision for this arc cannot be predicted: ${result.detail}`);
      this.flags[i] = (this.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
      this.jump(to, i);
      return;
    }
    this.flags[i] = (this.flags[i] as number) | LINE_FLAG.ARC;
    this.events.arc(this.machine, to, result.arc.lengthMm, this.uncertain, this.feed, [PLANE_INDEX[plane], result.arc.radius, result.arc.theta, result.arc.travel, to[lin] - this.machine[lin]]);
    this.arcs++;
    this.feedMm += result.arc.lengthMm;
    this.time(result.arc.lengthMm, to, false);
    this.pieces.push({ kind: 'arc', line: i, from: { ...this.machine }, to, arc: result.arc, plane, k: this.kindBits(KIND.ARC) });
    this.machine = to;
    this.movedYet = true;
  }

  kindBits(k: number): number {
    return this.uncertain ? k | KIND.UNCERTAIN : k;
  }

  linear(to: Pos, motion: 'G0' | 'G1', i: number): void {
    let sq = 0;
    for (const a of AXES) sq += (to[a] - this.machine[a]) ** 2;
    const len = Math.sqrt(sq);
    if (motion === 'G0') this.rapidMm += len;
    else this.feedMm += len;
    this.events.line(this.machine, to, motion === 'G0', this.uncertain, this.feed);
    this.time(len, to, motion === 'G0');
    this.pieces.push({ kind: 'line', line: i, to, k: this.kindBits(motion === 'G0' ? KIND.RAPID : KIND.FEED) });
    this.machine = to;
    this.movedYet = true;
  }

  jump(to: Pos, i: number): void {
    this.events.unmodelled(this.machine, to);
    this.pieces.push({ kind: 'jump', line: i, to, k: this.kindBits(KIND.BREAK) });
    this.machine = to;
    this.movedYet = true;
  }

  /** Adds a move's estimated duration (trapezoid, starting and ending at rest; an estimate only). */
  time(len: number, to: Pos, rapid: boolean): void {
    if (len === 0 || this.seconds === null) return;
    const timing: TimingModel | undefined = this.options.timing;
    if (timing === undefined) {
      this.seconds = null;
      return;
    }
    const limits = rapid ? timing.maxVelocity : timing.feedrateMax;
    let v = rapid ? Infinity : this.feed ?? NaN;
    let j = Infinity;
    for (const a of AXES) {
      const d = Math.abs(to[a] - this.machine[a]);
      if (d === 0) continue;
      const lim = limits[a];
      if (lim === undefined) {
        this.seconds = null;
        return;
      }
      v = Math.min(v, (lim * len) / d);
      const jm = timing.jerk?.[a];
      if (jm !== undefined) j = Math.min(j, (jm * len) / d);
    }
    if (!(v > 0)) {
      this.seconds = null;
      return;
    }
    let minutes: number;
    if (j === Infinity) minutes = len / v;
    else {
      // Constant-jerk ramp from rest to v takes 2√(v/j) and covers v·√(v/j); two ramps per move.
      const ramp = v * Math.sqrt(v / j);
      if (2 * ramp <= len) minutes = 4 * Math.sqrt(v / j) + (len - 2 * ramp) / v;
      else {
        const peak = Math.cbrt(((len * Math.sqrt(j)) / 2) ** 2);
        minutes = 4 * Math.sqrt(peak / j);
      }
    }
    this.seconds += minutes * 60;
  }
}

/**
 * Interprets the sanitised lines of a job for `dialect` and analyses them.
 * `result` must come from `sanitizeJob` for the same dialect: a result for
 * another dialect is blocked, never drawn with the wrong semantics.
 */
export function interpretJob(result: SanitizeResult, dialect: Dialect, options: InterpretOptions = {}): JobAnalysis {
  const findings: Finding[] = result.report.entries.map((e) => ({
    line: e.line,
    n: null,
    severity: e.severity,
    rule: e.rule,
    message: e.message,
    source: 'sanitizer' as const,
  }));
  const job = dialect.gcode.job;
  const lines = result.lines;
  if (result.report.dialect !== dialect.id || job === null) {
    findings.push({
      line: 0,
      n: null,
      severity: 'block',
      rule: job === null ? 'read-only-dialect' : 'dialect-mismatch',
      message: blockFindingText(job === null ? 'read-only-dialect' : 'dialect-mismatch', job === null
        ? `${dialect.label} is read-only in this version: no job is ever interpreted for it`
        : `these lines were sanitised for ${result.report.dialect}, not ${dialect.id}: sanitise again for this dialect`, 0),
      source: 'analyser',
    });
    return emptyAnalysis(dialect, findings, lines.length, options);
  }

  const it = new Interpreter(dialect, job, lines, options);

  // Lines the sanitiser rejected were not sent: everything after the first one is uncertain.
  const sentSources = new Set(lines.map((l) => l.sourceLine));
  // A loop, not Math.min(...spread): a large file can reject more lines than the engine accepts as arguments.
  let firstRejected = Infinity;
  for (const e of result.report.entries) {
    if (e.severity === 'block' && e.line > 0 && e.line < firstRejected && !sentSources.has(e.line)) firstRejected = e.line;
  }
  const lastIndex = lines.length - 1;
  const lineFeeds = new Float32Array(lines.length);
  lines.forEach((line, i) => {
    if (!it.uncertain && line.sourceLine > firstRejected) {
      it.uncertain = true;
      it.add(line.sourceLine, line.n, 'info', 'after-rejected-line', `Line ${String(firstRejected)} is blocked, so it isn't sent: positions after it may not match what the file intends.`);
    }
    it.events.begin(i);
    it.step(line, i, i === lastIndex);
    it.events.end(((it.flags[i] as number) & LINE_FLAG.NOT_DRAWN) !== 0);
    // The feed after the line's own words: an F on the line applies to its move.
    lineFeeds[i] = it.feed ?? Number.NaN;
    it.frameTable.note(line.sourceLine, it.offset('X'), it.offset('Y'), it.offset('Z'));
  });

  // File-level findings.
  const anyCode = (set: readonly string[]): boolean =>
    lines.some((l) => parseLine(l.body).words.some((w) => set.includes(codeOf(w) ?? '')));
  if (lines.length > 0 && !anyCode(['G20', 'G21'])) it.add(0, null, 'warn', 'units-never-set', 'the file never sets G20 or G21: it runs in whatever units the board is in');
  if (lines.length > 0 && !anyCode(['G90', 'G91'])) it.add(0, null, 'warn', 'distance-never-set', 'the file never sets G90 or G91: it runs in whatever distance mode the board is in');
  if (it.distance === 'G91') it.add(lastIndex >= 0 ? (lines[lastIndex] as SentLine).sourceLine : 0, null, 'warn', 'g91-at-end', 'the file ends in G91 (incremental): the next job or jog may move further than expected');

  const emitted = emit(it, lines.length, options);
  checkEnvelope(it, emitted, dialect, options);

  // The analyser repeats some sanitiser checks on purpose; keep one finding per line and rule.
  const seen = new Set(findings.map((f) => `${String(f.line)}:${f.rule}`));
  for (const f of it.findings) {
    const key = `${String(f.line)}:${f.rule}`;
    if (f.line !== 0 && seen.has(key)) continue;
    seen.add(key);
    findings.push(f);
  }
  return {
    dialect: dialect.id,
    blocked: findings.some((f) => f.severity === 'block'),
    vertices: emitted.vertices,
    kinds: emitted.kinds,
    lineToVertex: emitted.lineToVertex,
    lineFlags: it.flags,
    lineFeeds,
    bounds: emitted.bounds,
    findings,
    pausePoints: it.pausePoints,
    frameTable: it.frameTable.finish(),
    events: it.events.finish(),
    stats: { lines: lines.length, rapidMm: it.rapidMm, feedMm: it.feedMm, arcs: it.arcs, estimatedSeconds: it.seconds, chordMm: emitted.chordMm },
    end: {
      machine: { ...it.machine },
      units: it.units,
      distance: it.distance,
      plane: it.plane,
      wcs: it.wcs,
      wcsOffsets: Object.fromEntries(WCS_CODES.map((w) => [w, { ...it.wcsOffsets[w] }])) as JobAnalysis['end']['wcsOffsets'],
      g92: { offsets: { ...it.g92.offsets }, active: it.g92.active },
      spindle: it.spindle,
      mist: it.mist,
      flood: it.flood,
    },
  };
}

interface Emitted {
  vertices: Float32Array;
  kinds: Uint8Array;
  lineToVertex: Uint32Array;
  bounds: Box | null;
  chordMm: number;
  /** Per vertex: the exact arc box for arc pieces is checked separately. */
  arcBoxes: Array<{ line: number; box: Box }>;
}

function emit(it: Interpreter, lineCount: number, options: InterpretOptions): Emitted {
  const cap = Math.max(2, options.vertexCap ?? DEFAULT_VERTEX_CAP);
  let chord = options.chordMm ?? DEFAULT_CHORD_MM;
  const fixed = 1 + it.pieces.filter((p) => p.kind !== 'arc').length;
  const arcs = it.pieces.filter((p): p is Extract<Piece, { kind: 'arc' }> => p.kind === 'arc');
  const count = (tol: number): number => arcs.reduce((s, p) => s + arcSegments(p.arc, tol), 0);
  // Coarsen arcs until the total fits (chord error grows with the square of the step).
  for (let guard = 0; guard < 64 && fixed + count(chord) > cap && count(chord) > arcs.length; guard++) {
    const ratio = count(chord) / Math.max(1, cap - fixed);
    chord *= Math.max(1.5, ratio * ratio);
  }
  const total = fixed + count(chord);
  const vertices = new Float32Array(total * 3);
  const kinds = new Uint8Array(total);
  const lineToVertex = new Uint32Array(lineCount + 1);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const arcBoxes: Emitted['arcBoxes'] = [];
  let v = 0;
  const push = (x: number, y: number, z: number, k: number): void => {
    vertices[v * 3] = x;
    vertices[v * 3 + 1] = y;
    vertices[v * 3 + 2] = z;
    kinds[v] = k;
    v++;
  };
  const grow = (x: number, y: number, z: number): void => {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  };
  const start = it.options.start?.machine ?? {};
  const s = { X: start.X ?? 0, Y: start.Y ?? 0, Z: start.Z ?? 0 };
  push(s.X, s.Y, s.Z, KIND.BREAK);
  let drawnAny = false;
  let line = 0;
  let prev = s;
  for (const p of it.pieces) {
    while (line <= p.line) lineToVertex[line++] = v;
    const from = prev;
    prev = { X: p.to.X, Y: p.to.Y, Z: p.to.Z };
    if (p.kind === 'line' || p.kind === 'jump') {
      if (p.kind === 'line') {
        grow(from.X, from.Y, from.Z);
        grow(p.to.X, p.to.Y, p.to.Z);
        drawnAny = true;
      }
      push(p.to.X, p.to.Y, p.to.Z, p.k);
      continue;
    }
    const ax = PLANES[p.plane];
    const a0 = ax.a0 as Axis;
    const a1 = ax.a1 as Axis;
    const lin = ax.lin as Axis;
    const pts = tessellateArc(p.arc, arcSegments(p.arc, chord));
    pts.forEach(([d0, d1, f], idx) => {
      const q = { ...p.from };
      if (idx === pts.length - 1) Object.assign(q, p.to);
      else {
        q[a0] = p.from[a0] + d0;
        q[a1] = p.from[a1] + d1;
        q[lin] = p.from[lin] + (p.to[lin] - p.from[lin]) * f;
      }
      push(q.X, q.Y, q.Z, p.k);
    });
    const b = arcBox(p.arc);
    const bmin = { ...p.from };
    const bmax = { ...p.from };
    bmin[a0] = p.from[a0] + Math.min(b.min[0], p.to[a0] - p.from[a0]);
    bmin[a1] = p.from[a1] + Math.min(b.min[1], p.to[a1] - p.from[a1]);
    bmax[a0] = p.from[a0] + Math.max(b.max[0], p.to[a0] - p.from[a0]);
    bmax[a1] = p.from[a1] + Math.max(b.max[1], p.to[a1] - p.from[a1]);
    bmin[lin] = Math.min(p.from[lin], p.to[lin]);
    bmax[lin] = Math.max(p.from[lin], p.to[lin]);
    const box: Box = { min: [bmin.X, bmin.Y, bmin.Z], max: [bmax.X, bmax.Y, bmax.Z] };
    arcBoxes.push({ line: p.line, box });
    grow(...box.min);
    grow(...box.max);
    drawnAny = true;
  }
  while (line <= lineCount) lineToVertex[line++] = v;
  return { vertices, kinds, lineToVertex, bounds: drawnAny ? { min, max } : null, chordMm: chord, arcBoxes };
}

function checkEnvelope(it: Interpreter, e: Emitted, dialect: Dialect, options: InterpretOptions): void {
  const env = options.envelope;
  if (env === undefined) return;
  const xyz: readonly Axis[] = ['X', 'Y', 'Z'];
  const outside = (c: readonly number[]): boolean =>
    xyz.some((a, k) => {
      const lim = env[a];
      const val = c[k] as number;
      return lim !== undefined && (val < lim.min || val > lim.max);
    });
  let firstLinear = -1;
  let firstArc = -1;
  for (let line = 0; line < e.lineToVertex.length - 1; line++) {
    const from = e.lineToVertex[line] as number;
    const to = e.lineToVertex[line + 1] as number;
    let out = false;
    for (let v = from; v < to; v++) {
      if (((e.kinds[v] as number) & 0x7f) === KIND.BREAK) continue;
      if (outside([e.vertices[v * 3] as number, e.vertices[v * 3 + 1] as number, e.vertices[v * 3 + 2] as number])) out = true;
    }
    const arcOut = e.arcBoxes.some((b) => b.line === line && (outside(b.box.min) || outside(b.box.max)));
    if (out || arcOut) {
      it.flags[line] = (it.flags[line] as number) | LINE_FLAG.OUT_OF_BOUNDS;
      if (arcOut && firstArc < 0) firstArc = line;
      else if (!arcOut && firstLinear < 0) firstLinear = line;
    }
  }
  const at = (i: number): SentLine => it.lines[i] as SentLine;
  if (firstLinear >= 0) {
    it.add(at(firstLinear).sourceLine, at(firstLinear).n, 'block', 'out-of-bounds', 'the path leaves the work envelope (first line shown)');
  }
  if (firstArc >= 0) {
    it.add(at(firstArc).sourceLine, at(firstArc).n, 'block', 'arc-out-of-bounds', dialect.caps.arcSoftLimits
      ? 'an arc leaves the work envelope (first line shown)'
      : `an arc leaves the work envelope (first line shown): ${dialect.label} does not soft-limit arcs, so only this check stops it`);
  }
}

function emptyAnalysis(dialect: Dialect, findings: Finding[], lineCount: number, options: InterpretOptions): JobAnalysis {
  const s = options.start?.machine ?? {};
  const machine = { X: s.X ?? 0, Y: s.Y ?? 0, Z: s.Z ?? 0, A: s.A ?? 0, B: s.B ?? 0, C: s.C ?? 0 };
  const offsets = Object.fromEntries(WCS_CODES.map((w) => [w, zero()])) as JobAnalysis['end']['wcsOffsets'];
  return {
    dialect: dialect.id,
    blocked: true,
    vertices: new Float32Array(0),
    kinds: new Uint8Array(0),
    lineToVertex: new Uint32Array(lineCount + 1),
    lineFlags: new Uint8Array(lineCount).fill(LINE_FLAG.NOT_DRAWN),
    lineFeeds: new Float32Array(lineCount).fill(Number.NaN),
    bounds: null,
    findings,
    pausePoints: [],
    frameTable: emptyFrames(),
    events: emptyTape(),
    stats: { lines: lineCount, rapidMm: 0, feedMm: 0, arcs: 0, estimatedSeconds: null, chordMm: options.chordMm ?? DEFAULT_CHORD_MM },
    end: {
      machine,
      units: options.start?.units ?? 'G21',
      distance: options.start?.distance ?? 'G90',
      plane: options.start?.plane ?? 'G17',
      wcs: options.start?.wcs ?? 'G54',
      wcsOffsets: offsets,
      g92: { offsets: zero(), active: false },
      spindle: 'off',
      mist: false,
      flood: false,
    },
  };
}
