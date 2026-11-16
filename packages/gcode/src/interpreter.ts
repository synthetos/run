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
    WCS_CODES,
    blockFindingText,
    type Axis,
    type SanitizeResult,
    type SentLine
} from '@synthetos/safety';

import { DEFAULT_CHORD_MM } from './arcs.ts';

import { emptyTape } from './events.ts';

import { emptyFrames } from './frames.ts';

import { codeOf, parseLine } from './parser.ts';

import { g10, storedMove } from './interpreter/actions.ts';
import { interpretArc } from './interpreter/arcs.ts';
import { type Emitted, type Pos } from './interpreter/contract.ts';
import { axisMm, offset, offsetMm, unitScale, work, zero } from './interpreter/coordinates.ts';
import { emit } from './interpreter/emit.ts';
import { addFinding, addFindingOnce } from './interpreter/findings.ts';
import { initializeInterpreter } from './interpreter/initialize.ts';
import { jump, kindBits, linearMove } from './interpreter/linear.ts';
import { interpretMove } from './interpreter/moves.ts';
import { programEnd } from './interpreter/outputs.ts';
import { ruleBlocks } from './interpreter/rules.ts';
import { InterpreterState } from './interpreter/state.ts';
import { estimateTime } from './interpreter/timing.ts';
import { stepLine } from './interpreter/words.ts';
import { KIND, LINE_FLAG, type Finding, type InterpretOptions, type JobAnalysis } from './types.ts';
export { DEFAULT_VERTEX_CAP } from './interpreter/constants.ts';



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
/** One modal model per sanitizer invocation. */
class Interpreter extends InterpreterState {


  constructor(dialect: Dialect, job: DialectJobGcode, lines: readonly SentLine[], options: InterpretOptions) { super(); initializeInterpreter(this, dialect, job, lines, options); }


  add(line: number, n: number | null, severity: Finding['severity'], rule: string, message: string): void { return addFinding(this, line, n, severity, rule, message); }


  addOnce(key: string, line: number, n: number | null, severity: Finding['severity'], rule: string, message: string): void { return addFindingOnce(this, key, line, n, severity, rule, message); }


  /** Program units to mm. */
  get scale(): number { return unitScale(this); }


  /** The work offset on an axis. EN and TG apply the tool offset to X, Y and Z only (@cite EN canonical_machine.c:536-563). */
  offset(a: Axis): number { return offset(this, a); }


  work(a: Axis): number { return work(this, a); }


  /** Axis word → mm (rotary: degrees, as written). */
  axisMm(a: Axis, v: number): number { return axisMm(this, a, v); }


  /** An offset word → mm. Rotary offsets follow the dialect (`rotaryOffsetsUseUnits`). */
  offsetMm(a: Axis, v: number): number { return offsetMm(this, a, v); }


  /** The dialect's block rules, applied to one line (defence in depth behind the sanitiser). */
  ruleBlocks(codes: readonly string[], letters: ReadonlySet<string>): GcodeRule[] { return ruleBlocks(this, codes, letters); }


  step(line: SentLine, i: number, last: boolean): void { return stepLine(this, line, i, last); }


  /** M2/M30 (@cite EN canonical_machine.c:2174-2214): G92.1, default system, plane, units, G90, G80; outputs per dialect. */
  programEnd(): void { return programEnd(this); }


  g10(params: ReadonlyMap<string, number>, axisWords: ReadonlyMap<Axis, number>, src: number, n: number, i: number): void { return g10(this, params, axisWords, src, n, i); }


  /** G28/G30: an optional intermediate point, then the stored position on every axis (@cite EN canonical_machine.c:1390-1405). */
  storedMove(code: 'G28' | 'G30', axisWords: ReadonlyMap<Axis, number>, src: number, n: number, i: number): void { return storedMove(this, code, axisWords, src, n, i); }


  move(axisWords: ReadonlyMap<Axis, number>, params: ReadonlyMap<string, number>, g53: boolean, src: number, n: number, i: number): void { return interpretMove(this, axisWords, params, g53, src, n, i); }


  arc(to: Pos, axisWords: ReadonlyMap<Axis, number>, params: ReadonlyMap<string, number>, src: number, n: number, i: number): void { return interpretArc(this, to, axisWords, params, src, n, i); }


  kindBits(k: number): number { return kindBits(this, k); }


  linear(to: Pos, motion: 'G0' | 'G1', i: number): void { return linearMove(this, to, motion, i); }


  jump(to: Pos, i: number): void { return jump(this, to, i); }


  /** Adds a move's estimated duration (trapezoid, starting and ending at rest; an estimate only). */
  time(len: number, to: Pos, rapid: boolean): void { return estimateTime(this, len, to, rapid); }
}
