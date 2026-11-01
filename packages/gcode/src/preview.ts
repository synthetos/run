/**
 * What the preview needs from an analysis (ROADMAP TB-03): the plain segment
 * list the viewer draws, and a safety verdict per line of the file.
 *
 * The segment list is a structural copy of the analysis' own arrays, so the
 * preview draws exactly the interpretation of the sanitised lines and nothing
 * else. Its shape is the `SegmentList` of `@synthetos/gcode-view`; this
 * package does not import the viewer, and the viewer never imports this one.
 */
import type { SanitizeResult } from '@synthetos/safety';
import { LINE_FLAG } from './types.ts';
import type { Finding, FindingSeverity, JobAnalysis } from './types.ts';

/** Segment list in the viewer's input shape (vertex kinds use the same codes as `KIND`). */
export interface PreviewSegments {
  readonly vertices: Float32Array;
  readonly kinds: Uint8Array;
  /** One entry per sent line plus the closing vertex count. */
  readonly lineToVertex: Uint32Array;
  /** Viewer line marks: 1 out of bounds (red), 2 uncertain (dimmed). */
  readonly lineMarks: Uint8Array;
}

/** Viewer mark bits, kept equal to `LINE_MARK` of gcode-view by a test in the app that uses both. */
export const PREVIEW_MARK = Object.freeze({ OUT_OF_BOUNDS: 1, UNCERTAIN: 2 });

export function previewSegments(analysis: JobAnalysis): PreviewSegments {
  const flags = analysis.lineFlags;
  const lineMarks = new Uint8Array(flags.length);
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i] as number;
    lineMarks[i] = (f & LINE_FLAG.OUT_OF_BOUNDS ? PREVIEW_MARK.OUT_OF_BOUNDS : 0) | (f & LINE_FLAG.UNCERTAIN ? PREVIEW_MARK.UNCERTAIN : 0);
  }
  return { vertices: analysis.vertices, kinds: analysis.kinds, lineToVertex: analysis.lineToVertex, lineMarks };
}

/** Per-line verdict, ordered so the worst finding on a line wins. */
export const VERDICT = Object.freeze({ OK: 0, INFO: 1, CHANGE: 2, WARN: 3, BLOCK: 4 });
export type VerdictCode = (typeof VERDICT)[keyof typeof VERDICT];

const RANK: Readonly<Record<FindingSeverity, VerdictCode>> = { info: VERDICT.INFO, change: VERDICT.CHANGE, warn: VERDICT.WARN, block: VERDICT.BLOCK };

/**
 * The verdict of every line of the file (index 0 is file line 1): the worst
 * severity among the sanitiser's and the analyser's findings on that line.
 * File-level findings (line 0) are not attached to a line; callers show them
 * in the summary.
 */
export function lineVerdicts(analysis: JobAnalysis, fileLines: number): Uint8Array {
  const out = new Uint8Array(fileLines);
  for (const f of analysis.findings) {
    if (f.line < 1 || f.line > fileLines) continue;
    const r = RANK[f.severity];
    if (r > (out[f.line - 1] as number)) out[f.line - 1] = r;
  }
  return out;
}

/** The file line of each sent line (index = sent line index). */
export function sentSourceLines(sanitized: SanitizeResult): Uint32Array {
  const out = new Uint32Array(sanitized.lines.length);
  sanitized.lines.forEach((l, i) => { out[i] = l.sourceLine; });
  return out;
}

/** Findings sorted by file line, queried by range without scanning them all. */
export interface FindingIndex {
  /** File-level findings (line 0). */
  readonly fileLevel: readonly Finding[];
  /** Findings on file lines [from, to] inclusive. */
  between(from: number, to: number): Finding[];
  /** Count per severity. */
  readonly counts: Readonly<Record<FindingSeverity, number>>;
}

export function indexFindings(findings: readonly Finding[]): FindingIndex {
  const sorted = findings.filter((f) => f.line > 0).sort((a, b) => a.line - b.line);
  const counts: Record<FindingSeverity, number> = { block: 0, warn: 0, change: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const lowerBound = (line: number): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((sorted[mid] as Finding).line < line) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return {
    fileLevel: findings.filter((f) => f.line <= 0),
    between(from, to) {
      const out: Finding[] = [];
      for (let i = lowerBound(from); i < sorted.length && (sorted[i] as Finding).line <= to; i++) out.push(sorted[i] as Finding);
      return out;
    },
    counts,
  };
}
