/**
 * Opening the report dialog (REPORT_A_PROBLEM §2). Every entry point (the
 * account menu, Safety, a notice's "Report this", a G-code line, the Board
 * view, the Console) calls `openReport` with what it knows; the shell shows
 * the one dialog. Opening a report reads nothing from the board and changes
 * nothing about the connection.
 */
import { signal } from '@preact/signals';
import type { ReportEvent } from './collect.ts';

export type ReportOrigin = 'menu' | 'safety' | 'notice' | 'line' | 'board' | 'console';

/** What the user is reporting, as the first triage step offers it (§3). */
export type ReportKind = 'run' | 'firmware' | 'question' | 'hardware';

export interface ReportRequest {
  readonly origin: ReportOrigin;
  /** A pre-chosen kind (the Board view starts at "firmware"). The user can still change it. */
  readonly kind?: ReportKind;
  readonly event?: ReportEvent;
  /** The G-code file line the report is about (1-based). */
  readonly line?: number;
  /** Set by `openReport`: a new report never inherits the last one's choices. */
  readonly seq?: number;
}

export const reportRequest = signal<ReportRequest | null>(null);

let seq = 0;

export function openReport(request: ReportRequest): void {
  seq += 1;
  reportRequest.value = Object.freeze({ ...request, seq });
}

export function closeReport(): void {
  reportRequest.value = null;
}
