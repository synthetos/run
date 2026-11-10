/** Messages between the page and `gcode.worker` (ROADMAP TB-03). */
import type { Estimate, PlannerProfile } from '@synthetos/advisor';
import type { Finding } from '@synthetos/gcode';
import type { PreviewProgress, PreviewRequest, PreviewResult } from './pipeline.ts';

export type ToGcodeWorker =
  | { readonly type: 'load'; readonly id: number; readonly blob: Blob; readonly request: PreviewRequest }
  /** Findings on file lines [from, to] of the last loaded file. */
  | { readonly type: 'findings'; readonly id: number; readonly from: number; readonly to: number }
  /** The planner model's time for the last loaded file on a machine with these settings. */
  | { readonly type: 'estimate'; readonly id: number; readonly profile: PlannerProfile };

export type FromGcodeWorker =
  | { readonly type: 'progress'; readonly id: number; readonly progress: PreviewProgress }
  | { readonly type: 'result'; readonly id: number; readonly result: PreviewResult }
  | { readonly type: 'findings'; readonly id: number; readonly findings: readonly Finding[] }
  | { readonly type: 'estimate'; readonly id: number; readonly estimate: Estimate }
  | { readonly type: 'error'; readonly id: number; readonly message: string };
