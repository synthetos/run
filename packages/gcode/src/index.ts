/**
 * @synthetos/gcode
 *
 * G-code lexer/parser (cncjs fork, MIT), dialect-aware modal interpreter, arcs and analyser.
 *
 * This package has no runtime npm dependencies (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export { codeOf, parseLine, parseLines, parseStream } from './parser.ts';
export type { ParseError, ParsedLine, Word } from './parser.ts';
export { DEFAULT_CHORD_MM, arcBox, arcPoint, arcSegments, tessellateArc } from './arcs.ts';
export { DEFAULT_VERTEX_CAP, interpretJob } from './interpreter.ts';
export { EVENT, EVENT_FLAG, NO_EVENT_TOOL, EventRecorder, emptyTape, tapeBuffers } from './events.ts';
export type { EventTape } from './events.ts';
export { emptyFrames, nextG92Line, programToPath } from './frames.ts';
export type { ProgramFrames } from './frames.ts';
export { KIND, LINE_FLAG } from './types.ts';
export type { Box, EndModal, Finding, FindingSeverity, InterpretOptions, JobAnalysis, JobStats, TimingModel } from './types.ts';
export { PREVIEW_MARK, VERDICT, indexFindings, lineVerdicts, previewSegments, sentSourceLines } from './preview.ts';
export type { FindingIndex, PreviewSegments, VerdictCode } from './preview.ts';
export { NO_TOOL, activeToolAt, changeAt, toolChanges } from './tools.ts';
export type { ToolChanges } from './tools.ts';
