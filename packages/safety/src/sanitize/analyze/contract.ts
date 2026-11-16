import { type MoveExtent } from '../extent.ts';
import {
  type Segment
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { ReportEntry, SanitizeRule } from '../types.ts';

/** A finding for the report, before its line number is attached. */
export interface Finding {
  readonly severity: ReportEntry['severity'];
  readonly rule: SanitizeRule;
  readonly message: string;
}

/** What one line does, as the sanitiser needs to know it. */
export interface LineAnalysis {
  readonly findings: readonly Finding[];
  /** False when a finding blocks the line. */
  readonly ok: boolean;
  /** The line as one move, or as sub-segment bodies replacing it. */
  readonly motion:
  | null
  | { readonly kind: 'single'; readonly plannerLength: number; readonly boundMm: number | null; readonly seconds: number }
  | { readonly kind: 'split'; readonly bodies: readonly string[]; readonly segments: readonly Segment[]; readonly seconds: number };
  readonly toolChange: boolean;
  /** M0 or M60. */
  readonly programStop: boolean;
  /** The M1 word, if any. */
  readonly optionalStop: Word | null;
  /** M2 or M30. */
  readonly programEnd: boolean;
  /** M3, M4, M7 or M8 on this line. */
  readonly outputsOn: boolean;
  /** OD-24: where the line takes the machine (machine coordinates), or null when it does not move (extent.ts). */
  readonly extent: MoveExtent | null;
}

export const block = (rule: SanitizeRule, message: string): Finding => ({ severity: 'block', rule, message });
