/** The job sanitiser (ROADMAP P0-10, SAFETY §4.7). */
export { sanitizeJob, CEILING_SECONDS, DEFAULT_K } from './sanitize.ts';
export { AXES, AXIS_MODE_DISABLED, AXIS_MODE_INHIBITED, AXIS_MODE_RADIUS, AXIS_MODE_STANDARD, LINE_TERMINATOR, WCS_CODES } from './types.ts';
export type {
  Axis,
  AxisMode,
  AxisValues,
  EndState,
  LinearAxis,
  LineMotion,
  LineOrigin,
  MotionModel,
  ReportEntry,
  RotaryAxis,
  RotaryAxisConfig,
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
// The firmware arc model, shared with the gcode interpreter so the preview draws the arc the sanitiser checked (T-S1).
export { PLANES, modelArc } from './geometry.ts';
export type { ArcInput, ArcModel, ArcModelResult, Plane } from './geometry.ts';
