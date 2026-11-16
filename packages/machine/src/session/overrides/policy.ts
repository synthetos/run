/** Narrow byte gate, rechecked at the transport; no enable or persisted setting fits. */
import { allowed, type Decision, type Release } from '@synthetos/safety';
import { matrixSnapshot } from '../reducer.ts';
import type { QueuedLine, WriteCheck } from '../sessionRuntime.ts';
import { overrideView, parseOverrideLine, supportsOverrides, type OverrideRequest, type OverrideState } from './model.ts';
export function overrideDecision(s: OverrideState, release: Release, request: OverrideRequest): Decision {
  const matrix = allowed(matrixSnapshot(s), 'jobRuntime', release);
  if (!matrix.allowed) return matrix;
  let reason: string | null = null;
  if (!supportsOverrides(s) || s.classification?.mode !== 'full') reason = 'Overrides need supported TinyG 450.06 or later.';
  else if (!s.job || !['running', 'draining', 'ending', 'paused', 'breakpoint', 'programStop'].includes(s.job.phase) || s.job.stopping) reason = 'Overrides are available only during this tab’s running or held job.';
  else if (s.footerRev !== 3 || s.rxm.current !== 1) reason = 'Overrides need confirmed line mode.';
  else reason = readingReason(s, request);
  return reason === null ? { allowed: true } : { allowed: false, reason, remedy: 'Wait for the board or end the job.', citation: 'SAFETY live overrides (2026-11-15)' };
}
export function overrideWrite(current: OverrideState, emitted: OverrideState, release: Release, item: QueuedLine): WriteCheck {
  const text = new TextDecoder().decode(item.bytes);
  const request = text.endsWith('\n') ? parseOverrideLine(text.slice(0, -1)) : null;
  if (!request || item.jobRuntime !== true || emitted.overrides?.pending !== text.slice(0, -1)) return { kind: 'refused', reason: 'Not the bounded override requested by this session.' };
  const decision = overrideDecision(current, release, request);
  if (!decision.allowed) return { kind: 'denied', reason: decision.reason };
  return current.overrides?.pending === emitted.overrides.pending ? undefined : { kind: 'denied', reason: 'The override was cancelled.' };
}

function readingReason(s: OverrideState, request: OverrideRequest): string | null {
  const r = overrideView(s)?.[request.channel];
  if (!r || r.requested === null || r.effective === null || r.permitted === null) return 'Waiting for the board’s override values.';
  return r.permitted ? null : 'Locked by the program.';
}
