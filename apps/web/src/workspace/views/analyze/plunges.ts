/**
 * Plunge-heavy operations (docs/design/ANALYZE.md §3, slice 1): an operation whose straight-down feed moves take a
 * large share of its time. Each plunge is short, so no single stretch is "slow", but together they can take most of
 * the operation: worth saying, with what to check in CAM and a link to the first one. Pure.
 */
import type { FeedRegime, OperationSummary, ProgramReport } from '@synthetos/advisor';

/** Plunges count when they take at least this long and this share of their operation. */
export const PLUNGE_MIN_SECONDS = 60;
export const PLUNGE_MIN_SHARE = 0.2;

export interface PlungeFinding {
  readonly operation: OperationSummary;
  readonly regime: FeedRegime;
  /** The plunges' share of the operation's time, 0..1. */
  readonly share: number;
}

export function plungeFindings(report: ProgramReport): PlungeFinding[] {
  const out: PlungeFinding[] = [];
  for (const op of report.operations) {
    if (op.seconds === null || op.seconds <= 0) continue;
    for (const r of op.regimes) {
      if (r.kind !== 'plunge' || r.seconds === null) continue;
      const share = r.seconds / op.seconds;
      if (r.seconds >= PLUNGE_MIN_SECONDS && share >= PLUNGE_MIN_SHARE) out.push({ operation: op, regime: r, share });
    }
  }
  return out.sort((a, b) => (b.regime.seconds as number) - (a.regime.seconds as number));
}
