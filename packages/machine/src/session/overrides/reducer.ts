/** Workspace wrapper: the core remains the sole owner of replies, slots and stop paths. */
import type { Decision } from '@synthetos/safety';
import { reduce as core } from '../reducer.ts';
import type { SessionConfig, SessionEvent, SessionState, Transition } from '../types.ts';
import { overrideDecision } from './policy.ts';
import { OVERRIDE_TOKENS, overrideLine, supportsOverrides, validOverride, type OverrideMemory, type OverrideState } from './model.ts';
const idleEvent = (): SessionEvent => ({ type: 'lineModeMemory', epoch: -1, remembered: null });
function pending(s: SessionState, line: string): boolean {
  return [...s.queue, ...s.expected, ...(s.writing ? [s.writing] : [])].some(e => e.purpose === 'jobRuntime' && e.line === line);
}
function memory(s: OverrideState, at: number): OverrideMemory {
  return s.overrides ?? { epoch: s.epoch, since: at, nextRead: 0, pending: null, error: null };
}
function prepare(s: OverrideState, at: number, poll: boolean): OverrideState {
  if (!supportsOverrides(s) || s.base === 'IDENTIFYING' || s.base === 'READING' || s.base === 'ALARM' || s.classification?.mode !== 'full') return { ...s, overrides: undefined };
  let m = memory(s, at);
  if (m.epoch !== s.epoch) m = { epoch: s.epoch, since: at, nextRead: 0, pending: null, error: null };
  if (!poll || !needsRead(s, m) || at < m.nextRead || s.queue.length > 20) return { ...s, overrides: m };
  const existing = new Set([...s.queue, ...s.expected, ...(s.writing ? [s.writing] : [])].map(e => e.token));
  const reads = OVERRIDE_TOKENS.filter(token => !existing.has(token)).map(token => ({ token, purpose: 'request' as const }));
  return { ...s, overrides: { ...m, nextRead: at + 1000 }, queue: [...s.queue, ...reads] };
}
function request(config: SessionConfig, s: OverrideState, event: Extract<SessionEvent, { type: 'intent' }>, value: unknown): Transition {
  let decision: Decision = validOverride(value) ? overrideDecision(s, config.release, value) : { allowed: false, reason: 'Use 10–150% in 10% steps.', remedy: 'Choose a valid override.', citation: 'SAFETY live overrides' };
  if (s.overrides?.pending) decision = { allowed: false, reason: 'The controller is still answering the last override.', remedy: 'Wait for its answer.', citation: 'SAFETY live overrides' };
  if (!decision.allowed || !validOverride(value)) return { state: s, effects: [{ kind: 'decision', intent: 'jobRuntime', decision }] };
  const line = overrideLine(value);
  const state = { ...s, overrides: { ...memory(s, event.at), pending: line, error: null }, queue: [{ token: 'rt', purpose: 'jobRuntime' as const, line }, ...s.queue] };
  const result = core(config, state, idleEvent());
  return { ...result, effects: [{ kind: 'decision', intent: 'jobRuntime', decision }, ...result.effects] };
}
function answered(before: OverrideState, result: Transition, event: SessionEvent, at: number): Transition {
  const line = before.overrides?.pending;
  let state: OverrideState = result.state;
  if (!line || pending(state, line)) return result;
  const m = state.overrides;
  if (!m) return result;
  const status = event.type === 'inbound' && event.event.kind === 'Response' ? event.event.footer.status : -1;
  const error = status === 0 ? null : status === 110 ? 'Override refused: outside the controller’s range (110).' : status === 104 ? 'Override refused: read-only on this controller (104).' : 'The controller did not confirm the override.';
  state = Object.freeze({ ...state, overrides: Object.freeze({ ...m, pending: null, error, nextRead: at }) });
  return { ...result, state };
}
export function reduceOverrides(config: SessionConfig, state: OverrideState, event: SessionEvent): Transition {
  const at = 'at' in event && typeof event.at === 'number' ? event.at : state.live.lastRxAt ?? 0;
  const before = prepare(state, at, event.type !== 'intent');
  if (event.type === 'intent' && event.request.intent === 'jobRuntime' && 'override' in event.request) return request(config, before, event, event.request.override);
  const result = ended(before, answered(before, core(config, before, event), event, at), at);
  // Faulted controllers cannot be polled safely: hide the old value until fresh reads succeed.
  return result.state.base === 'ALARM' ? { ...result, state: Object.freeze({ ...result.state, overrides: undefined }) } : result;
}

function needsRead(s: OverrideState, m: OverrideMemory): boolean {
  if (s.job && ['running', 'draining', 'ending', 'paused', 'breakpoint', 'programStop'].includes(s.job.phase)) return true;
  return !OVERRIDE_TOKENS.every(key => (s.values[key]?.at ?? -1) >= m.since);
}
function ended(before: OverrideState, result: Transition, at: number): Transition {
  const s: OverrideState = result.state;
  if (!s.job || s.job.phase === before.job?.phase || !['done', 'stopped', 'failed'].includes(s.job.phase)) return result;
  return { ...result, state: Object.freeze({ ...s, overrides: { ...memory(s, at), since: at, nextRead: 0 } }) };
}
