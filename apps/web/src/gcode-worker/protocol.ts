/** Messages between the page and `gcode.worker` (ROADMAP TB-03). */
import type { Finding } from '@synthetos/gcode';
import type { PreviewProgress, PreviewRequest, PreviewResult } from './pipeline.ts';

export type ToGcodeWorker =
  | { readonly type: 'load'; readonly id: number; readonly blob: Blob; readonly request: PreviewRequest }
  /** Findings on file lines [from, to] of the last loaded file. */
  | { readonly type: 'findings'; readonly id: number; readonly from: number; readonly to: number };

export type FromGcodeWorker =
  | { readonly type: 'progress'; readonly id: number; readonly progress: PreviewProgress }
  | { readonly type: 'result'; readonly id: number; readonly result: PreviewResult }
  | { readonly type: 'findings'; readonly id: number; readonly findings: readonly Finding[] }
  | { readonly type: 'error'; readonly id: number; readonly message: string };
