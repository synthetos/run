/**
 * The preview pipeline that runs inside `gcode.worker` (ROADMAP TB-03,
 * RUN_PLAN §7.6): file bytes -> the safety sanitiser -> the dialect-aware
 * interpreter -> a plain segment list, per-line verdicts and a summary.
 *
 * The preview draws exactly the interpretation of the sanitised lines: the
 * segment list is the analysis' own arrays (gcode `previewSegments`). Nothing
 * here can reach a machine; this module has no transport and sends nothing.
 */
import { DIALECTS, type Dialect, type DialectId } from '@synthetos/protocol';
import { sanitizeJob, type MotionModel, type StartState } from '@synthetos/safety';
import {
  indexFindings,
  interpretJob,
  lineVerdicts,
  previewSegments,
  sentSourceLines,
  type Box,
  type Finding,
  type FindingIndex,
  type FindingSeverity,
  type JobStats,
  type PreviewSegments,
} from '@synthetos/gcode';
import { latin1, lineSpans } from './lines.ts';

/** RUN_PLAN §4: a G-code file is at most 50 MB. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Above this many lines the preview opens in lite mode (no 3D). ChiliPeppr choked above 200,000. */
export const LITE_THRESHOLD_LINES = 300_000;
/** File-level findings carried in the summary; per-line findings are fetched for the rows in view. */
export const MAX_SUMMARY_FINDINGS = 50;

/** Dialects the preview offers: the two TinyG dialects that accept jobs. */
export const PREVIEW_DIALECTS: readonly DialectId[] = ['tinyg-en', 'tinyg-440'];

const ZERO = Object.freeze({ X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 });

/**
 * Offline, no board has been read: the preview assumes the machine at zero,
 * G54 with zero offsets, G21 G90 G17. The summary says so (`assumedStart`).
 */
export const OFFLINE_START: StartState = {
  units: 'G21',
  distance: 'G90',
  arcDistance: 'G91.1',
  plane: 'G17',
  motion: 'G0',
  wcs: 'G54',
  machine: ZERO,
  wcsOffsets: { G54: ZERO, G55: ZERO, G56: ZERO, G57: ZERO, G58: ZERO, G59: ZERO },
  g92: { offsets: ZERO, active: false },
  toolOffset: ZERO,
  g28: ZERO,
  g30: ZERO,
  defaults: { units: 'G21', distance: 'G90', plane: 'G17', wcs: 'G54' },
};

/**
 * Offline motion model: no board velocities are known, so moves are never
 * split and no time estimate is made. Sending always re-sanitises with the
 * live board's values (SAFETY §4.7).
 */
const FAST = Object.freeze({ X: 1e9, Y: 1e9, Z: 1e9, A: 1e9, B: 1e9, C: 1e9 });
export const OFFLINE_MOTION: MotionModel = {
  ceilingSeconds: 20,
  k: 1,
  maxVelocity: FAST,
  feedrateMax: FAST,
  rotary: { A: { mode: 1 }, B: { mode: 1 }, C: { mode: 1 } },
  linear: { X: 1, Y: 1, Z: 1 },
};

/** `auto`: lite above `LITE_THRESHOLD_LINES`; `lite`: always; `full`: 3D whatever the size (on request). */
export type PreviewMode = 'auto' | 'lite' | 'full';

export interface PreviewRequest {
  readonly dialect: DialectId;
  readonly mode: PreviewMode;
}

export interface PreviewSummary {
  readonly dialect: DialectId;
  readonly blocked: boolean;
  readonly counts: Readonly<Record<FindingSeverity, number>>;
  readonly fileLevel: readonly Finding[];
  readonly bounds: Box | null;
  readonly stats: JobStats;
  /** Always true offline: the start state is assumed, not read from a board. */
  readonly assumedStart: true;
  /** The envelope is known only from a live board (`tn`/`tm`); offline it is null. */
  readonly envelope: null;
  /** Origin of the active WCS in machine coordinates (the triad). */
  readonly wcsOrigin: readonly [number, number, number];
}

export interface PreviewResult {
  readonly lite: boolean;
  /** True when `auto` chose lite mode because of the file size. */
  readonly liteBySize: boolean;
  readonly fileLines: number;
  /** Null in lite mode: no 3D geometry is kept or sent. */
  readonly segments: PreviewSegments | null;
  /** Verdict per file line (gcode `VERDICT`). */
  readonly verdicts: Uint8Array;
  /** File line of each sent line (the scrubber steps over sent lines). */
  readonly sourceLines: Uint32Array;
  /** The file, and [start, end) spans per line, for the virtualised list. */
  readonly bytes: Uint8Array;
  readonly spans: Uint32Array;
  readonly summary: PreviewSummary;
}

export type PreviewProgress = { readonly phase: 'read'; readonly fraction: number } | { readonly phase: 'sanitise' | 'interpret' | 'pack' };

export class PreviewError extends Error {
  override readonly name = 'PreviewError';
}

export function previewDialect(id: DialectId): Dialect {
  const d = PREVIEW_DIALECTS.includes(id) ? DIALECTS.find((x) => x.id === id) : undefined;
  if (d === undefined) throw new PreviewError(`the preview does not offer the ${id} dialect`);
  return d;
}

/** Reads a blob in chunks into one buffer, reporting progress. */
export async function readBlob(blob: Blob, onProgress?: (p: PreviewProgress) => void): Promise<Uint8Array> {
  if (blob.size > MAX_FILE_BYTES) throw new PreviewError(`the file is ${String(blob.size)} bytes; the limit is ${String(MAX_FILE_BYTES)}`);
  const out = new Uint8Array(blob.size);
  const reader = blob.stream().getReader();
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > out.length) throw new PreviewError('the file grew while it was read');
    out.set(value, at);
    at += value.length;
    onProgress?.({ phase: 'read', fraction: out.length === 0 ? 1 : at / out.length });
  }
  return at === out.length ? out : out.slice(0, at);
}

export interface Analysed {
  readonly result: PreviewResult;
  readonly findings: FindingIndex;
}

/** Sanitises and interprets the file, then packs what the page needs. */
export function analyseBytes(bytes: Uint8Array, request: PreviewRequest, onProgress?: (p: PreviewProgress) => void): Analysed {
  const dialect = previewDialect(request.dialect);
  const spans = lineSpans(bytes);
  const fileLines = spans.length / 2;
  const liteBySize = request.mode === 'auto' && fileLines > LITE_THRESHOLD_LINES;
  const lite = request.mode === 'lite' || liteBySize;
  onProgress?.({ phase: 'sanitise' });
  const sanitized = sanitizeJob(latin1(bytes), dialect, { motion: OFFLINE_MOTION, start: OFFLINE_START });
  onProgress?.({ phase: 'interpret' });
  const analysis = interpretJob(sanitized, dialect, { start: OFFLINE_START });
  onProgress?.({ phase: 'pack' });
  const findings = indexFindings(analysis.findings);
  return {
    findings,
    result: {
      lite,
      liteBySize,
      fileLines,
      segments: lite ? null : previewSegments(analysis),
      verdicts: lineVerdicts(analysis, fileLines),
      sourceLines: sentSourceLines(sanitized),
      bytes,
      spans,
      summary: {
        dialect: dialect.id,
        blocked: analysis.blocked,
        counts: findings.counts,
        fileLevel: findings.fileLevel.slice(0, MAX_SUMMARY_FINDINGS),
        bounds: analysis.bounds,
        stats: analysis.stats,
        assumedStart: true,
        envelope: null,
        wcsOrigin: [ZERO.X, ZERO.Y, ZERO.Z],
      },
    },
  };
}

/** The buffers moved (not copied) to the page. */
export function transferablesOf(result: PreviewResult): ArrayBuffer[] {
  const views: ArrayBufferView[] = [result.verdicts, result.sourceLines, result.bytes, result.spans];
  if (result.segments !== null) views.push(result.segments.vertices, result.segments.kinds, result.segments.lineToVertex, result.segments.lineMarks);
  const seen = new Set<ArrayBuffer>();
  for (const v of views) if (v.buffer instanceof ArrayBuffer) seen.add(v.buffer);
  return [...seen];
}
