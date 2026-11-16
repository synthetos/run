/** Shared executor queue: priority control goes ahead of queued data, never an active write. */
import type { QueuedLine } from './sessionRuntime.ts';
import type { SessionEffect, SessionState } from './types.ts';
const encoder = new TextEncoder();
export function enqueueLine(lines: QueuedLine[], effect: Extract<SessionEffect, { kind: 'writeLine' }>, state: SessionState): void {
  const item: QueuedLine = {
    epoch: effect.epoch,
    seq: effect.seq,
    bytes: encoder.encode(`${effect.line}\n`),
    emitted: state,
    ...(effect.motion === undefined ? {} : { motion: effect.motion.intent }),
    ...(effect.intent === 'settingsWrite' ? { setting: true as const } : {}),
    ...(effect.intent === 'configureReports' ? { report: true as const } : {}),
    ...(effect.intent === 'jobLine' ? { job: effect.index as number } : {}),
    ...(effect.intent === 'lineMode' ? { lineMode: true as const } : {}),
    ...(effect.intent === 'jobRuntime' ? { jobRuntime: true as const } : {}),
    ...(effect.intent === 'flash' ? { boot: true as const } : {}),
  };

  // Exact override aliases only. Their matrix and pending-request checks run at the transport.
  const priority = effect.intent === 'jobRuntime' && /^\{"rt":\{"(?:mfo|sso)":/.test(effect.line);
  const data = priority ? lines.findIndex(line => line.job !== undefined) : -1;
  if (data < 0) lines.push(item);
  else lines.splice(data, 0, item);
}
