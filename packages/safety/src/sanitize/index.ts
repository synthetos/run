/** The job sanitiser (ROADMAP P0-10, SAFETY §4.7). */
export { sanitizeJob, CEILING_SECONDS, DEFAULT_K } from './sanitize.ts';
export { AXES, LINE_TERMINATOR, WCS_CODES } from './types.ts';
export type {
  Axis,
  AxisValues,
  EndState,
  LineMotion,
  LineOrigin,
  MotionModel,
  ReportEntry,
  SanitizeOptions,
  SanitizeReport,
  SanitizeResult,
  SanitizeRule,
  SentLine,
  Severity,
  SplitRecord,
  StartState,
  Wcs,
} from './types.ts';
