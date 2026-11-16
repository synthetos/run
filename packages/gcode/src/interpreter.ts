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
import type { Dialect } from '@synthetos/protocol';
import {
  WCS_CODES,
  blockFindingText,
  type SanitizeResult
} from '@synthetos/safety';
import { fileFindings, interpretLines } from './interpreter/analysis.ts';
import { emit } from './interpreter/emit.ts';
import { emptyAnalysis } from './interpreter/empty.ts';
import { checkEnvelope } from './interpreter/envelope.ts';
import { type Finding, type InterpretOptions, type JobAnalysis } from './types.ts';

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
  const { it, lastIndex, lineFeeds } = interpretLines({ dialect, job, lines, options, result });
  fileFindings({ lines, it, lastIndex });

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

export { DEFAULT_VERTEX_CAP } from './interpreter/constants.ts';
